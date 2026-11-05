import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auth } from '../lib/auth.js';
import { withUser } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
const cost =
  '(SELECT coalesce(sum((l.cost_cents*l.qty_milli+500)/1000),0)::bigint FROM sale_lines l WHERE l.sale_id=s.id)';
const events = `WITH events AS (
 SELECT s.id,s.created_at,s.user_id,s.subtotal_cents AS gross,s.discount_cents AS discount,s.total_cents AS net,${cost} AS cost,1 AS sign FROM sales s
 UNION ALL SELECT s.id,r.created_at,s.user_id,0,0,-s.total_cents,-${cost},-1 FROM sale_returns r JOIN sales s ON s.id=r.sale_id
), filtered AS (SELECT * FROM events WHERE (created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date)`;
export async function reportRoutes(app: FastifyInstance) {
  app.get('/api/reports', async (req) => {
    const user = auth(req, 'reports');
    const q = z
      .object({ from: z.string().date().optional(), to: z.string().date().optional() })
      .parse(req.query);
    return withUser(user, async (db) => {
      const {
        rows: [tenant],
      } = await db.query(
        "SELECT timezone,to_char(now() AT TIME ZONE timezone,'YYYY-MM-DD') AS today FROM tenants",
      );
      const from = q.from ?? tenant.today;
      const to = q.to ?? tenant.today;
      if (from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000)
        throw new AppError(400, 'Elegí un período de hasta 367 días.');
      const args = [from, to, tenant.timezone];
      const {
        rows: [totals],
      } = await db.query(
        `${events} SELECT coalesce(sum(gross),0)::bigint AS gross_cents,coalesce(sum(discount),0)::bigint AS discount_cents,coalesce(sum(net) FILTER(WHERE sign=-1),0)::bigint AS refunds_cents,coalesce(sum(net),0)::bigint AS net_cents,coalesce(sum(cost),0)::bigint AS cost_cents,count(*) FILTER(WHERE sign=1)::int AS operations,count(*) FILTER(WHERE sign=-1)::int AS returns FROM filtered`,
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
          `${events} SELECT p.method,sum(p.amount_cents*f.sign)::bigint AS amount_cents,sum(CASE WHEN p.status='pending' THEN p.amount_cents*f.sign ELSE 0 END)::bigint AS pending_cents FROM filtered f JOIN sale_payments p ON p.sale_id=f.id GROUP BY p.method ORDER BY amount_cents DESC`,
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
        from,
        to,
        totals: { ...totals, estimated_profit_cents: totals.net_cents - totals.cost_cents },
        daily,
        top,
        payments,
        stock,
        low,
      };
    });
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
