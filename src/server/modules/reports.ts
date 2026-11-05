import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auth } from '../lib/auth.js';
import { withUser } from '../lib/db.js';
import { createPdf } from '../lib/pdf.js';
import { serializeCsv } from '../../shared/csv.js';
import { qty, decimalInput } from '../../shared/money.js';
import { paymentNames } from '../../shared/payments.js';
import { AppError } from '../lib/errors.js';
const cost =
  '(SELECT coalesce(sum((l.cost_cents*l.qty_milli+500)/1000),0)::bigint FROM sale_lines l WHERE l.sale_id=s.id)';
const events = `WITH events AS (
 SELECT s.id,s.created_at,s.user_id,s.subtotal_cents AS gross,s.discount_cents AS discount,s.total_cents AS net,${cost} AS cost,s.tax_cents AS tax,1 AS sign FROM sales s
 UNION ALL SELECT s.id,r.created_at,s.user_id,0,0,-s.total_cents,-${cost},-s.tax_cents,-1 FROM sale_returns r JOIN sales s ON s.id=r.sale_id
), filtered AS (SELECT * FROM events WHERE created_at>=($1::date::timestamp AT TIME ZONE $3) AND created_at<(($2::date+1)::timestamp AT TIME ZONE $3))`;
export async function reportRoutes(app: FastifyInstance) {
  app.get('/api/reports', async (req, reply) => {
    const user = auth(req, 'reports');
    const q = z
      .object({
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        format: z.enum(['json', 'csv', 'pdf']).default('json'),
      })
      .parse(req.query);
    const report = await withUser(
      user,
      async (db) => {
        const {
          rows: [tenant],
        } = await db.query(
          "SELECT name,timezone,to_char(now() AT TIME ZONE timezone,'YYYY-MM-DD') AS today FROM tenants",
        );
        const from = q.from ?? tenant.today;
        const to = q.to ?? tenant.today;
        if (from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000)
          throw new AppError(400, 'Elegí un período de hasta 367 días.');
        const args = [from, to, tenant.timezone];
        const {
          rows: [totals],
        } = await db.query(
          `${events} SELECT coalesce(sum(gross),0)::bigint AS gross_cents,coalesce(sum(discount),0)::bigint AS discount_cents,coalesce(sum(net) FILTER(WHERE sign=-1),0)::bigint AS refunds_cents,coalesce(sum(net),0)::bigint AS net_cents,coalesce(sum(cost),0)::bigint AS cost_cents,coalesce(sum(tax),0)::bigint AS tax_cents,count(*) FILTER(WHERE sign=1)::int AS operations,count(*) FILTER(WHERE sign=-1)::int AS returns FROM filtered`,
          args,
        );
        const daily = (
          await db.query(
            `${events} SELECT to_char(d,'DD/MM') AS label,to_char(d,'YYYY-MM-DD') AS date,coalesce(sum(f.net),0)::bigint AS net_cents FROM generate_series($1::date,$2::date,interval '1 day') d LEFT JOIN filtered f ON (f.created_at AT TIME ZONE $3)::date=d::date GROUP BY d ORDER BY d`,
            args,
          )
        ).rows;
        const top = (
          await db.query(
            `${events} SELECT l.product_id,l.name,sum(l.qty_milli*f.sign)::bigint AS qty_milli,sum(l.total_cents*f.sign)::bigint AS gross_cents FROM filtered f JOIN sale_lines l ON l.sale_id=f.id GROUP BY l.product_id,l.name ORDER BY qty_milli DESC LIMIT 8`,
            args,
          )
        ).rows;
        const payments = (
          await db.query(
            `${events} SELECT p.method,sum(p.amount_cents*f.sign)::bigint AS amount_cents,sum(CASE WHEN p.status='pending' AND NOT EXISTS(SELECT 1 FROM payment_confirmations c WHERE c.sale_id=p.sale_id AND c.method=p.method) THEN p.amount_cents*f.sign ELSE 0 END)::bigint AS pending_cents FROM filtered f JOIN sale_payments p ON p.sale_id=f.id GROUP BY p.method ORDER BY amount_cents DESC`,
            args,
          )
        ).rows;
        const stock = (
          await db.query(
            'SELECT count(*) FILTER(WHERE stock_milli<=min_stock_milli)::int AS low_count,coalesce(sum(round(cost_cents::numeric*stock_milli/1000)),0)::bigint AS value_cents FROM products WHERE active',
          )
        ).rows[0];
        const low = (
          await db.query(
            'SELECT id,name,sku,stock_milli,min_stock_milli,unit FROM products WHERE active AND stock_milli<=min_stock_milli ORDER BY stock_milli LIMIT 8',
          )
        ).rows;
        return {
          name: tenant.name,
          from,
          to,
          totals: { ...totals, estimated_profit_cents: totals.net_cents - totals.cost_cents },
          daily,
          top,
          payments,
          stock,
          low,
        };
      },
      { readOnly: true },
    );
    if (q.format === 'json') return report;
    const rows: unknown[][] = [
      [report.name, `${report.from} / ${report.to}`],
      ['Concepto', 'Importe ARS'],
      ['Ventas brutas', decimalInput(report.totals.gross_cents)],
      ['Descuentos', decimalInput(report.totals.discount_cents)],
      ['Devoluciones', decimalInput(-report.totals.refunds_cents)],
      ['Ventas netas (impuestos incluidos)', decimalInput(report.totals.net_cents)],
      ['Impuestos incluidos', decimalInput(report.totals.tax_cents)],
      ['Costo estimado', decimalInput(report.totals.cost_cents)],
      [
        'Resultado estimado (sin separar impuestos de costos)',
        decimalInput(report.totals.estimated_profit_cents),
      ],
      ['Operaciones', report.totals.operations],
      ['Devoluciones', report.totals.returns],
      [],
      ['Fecha', 'Ventas netas ARS'],
      ...report.daily.map((d) => [d.date, decimalInput(d.net_cents)]),
      [],
      ['Más vendidos (8)', 'Cantidad', 'Importe bruto ARS'],
      ...report.top.map((p) => [p.name, qty(p.qty_milli), decimalInput(p.gross_cents)]),
      [],
      ['Medio de pago', 'Importe ARS', 'Pendiente ARS'],
      ...report.payments.map((p) => [
        paymentNames[p.method as keyof typeof paymentNames],
        decimalInput(p.amount_cents),
        decimalInput(p.pending_cents),
      ]),
    ];
    reply.header(
      'Content-Disposition',
      `attachment; filename="reporte-${report.from}-${report.to}.${q.format}"`,
    );
    if (q.format === 'csv') return reply.type('text/csv; charset=utf-8').send(serializeCsv(rows));
    return reply.type('application/pdf').send(
      await createPdf(
        `${report.name} · Reporte de ventas`,
        rows.map((r) => r.join(' | ')),
      ),
    );
  });
  app.get('/api/audit', async (req) =>
    withUser(
      auth(req, 'audit'),
      async (db) =>
        (
          await db.query(
            'SELECT a.*,u.name AS user_name FROM audit_events a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 300',
          )
        ).rows,
    ),
  );
}
