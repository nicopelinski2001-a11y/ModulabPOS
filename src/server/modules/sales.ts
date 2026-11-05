import { paymentRecorder, fiscalProvider } from '../lib/providers.js';
import { createPdf } from '../lib/pdf.js';
import { money, qty } from '../../shared/money.js';
import { paymentNames } from '../../shared/payments.js';
import { saleTotals } from '../../shared/totals.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auth, tokenHash } from '../lib/auth.js';
import { withUser, audit, type DB } from '../lib/db.js';
import { AppError, requireFound } from '../lib/errors.js';
import { lockOwnShift, cashMovement } from './cash.js';
import {
  saleSchema,
  uuid,
  lineTotal,
  sumMoney,
  can,
  type SaleInput,
  type User,
  type Product,
} from '../../shared/domain.js';
async function saleDetail(db: DB, id: string, user: User) {
  const sale = requireFound(
    (
      await db.query(
        'SELECT s.*,u.name AS user_name,EXISTS(SELECT 1 FROM sale_returns r WHERE r.sale_id=s.id) AS returned FROM sales s JOIN users u ON u.id=s.user_id WHERE s.id=$1',
        [id],
      )
    ).rows[0],
  );
  delete sale.request_hash;
  delete sale.idempotency_key;
  const lines = (await db.query('SELECT * FROM sale_lines WHERE sale_id=$1 ORDER BY name', [id]))
    .rows;
  if (!can(user.role, 'reports')) lines.forEach((l) => delete l.cost_cents);
  return {
    ...sale,
    lines,
    payments: (
      await db.query(
        "SELECT p.method,p.amount_cents,p.tendered_cents,CASE WHEN c.id IS NOT NULL THEN 'manual' ELSE p.status END AS status,c.reference AS confirmation_reference FROM sale_payments p LEFT JOIN payment_confirmations c ON c.sale_id=p.sale_id AND c.method=p.method WHERE p.sale_id=$1",
        [id],
      )
    ).rows,
  };
}
export async function completeSale(db: DB, user: User, b: SaleInput) {
  const requestHash = tokenHash(JSON.stringify(b));
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${user.tenant_id}:sale:${b.idempotency_key}`,
  ]);
  const existing = (
    await db.query('SELECT id,request_hash,user_id FROM sales WHERE idempotency_key=$1', [
      b.idempotency_key,
    ])
  ).rows[0];
  if (existing) {
    if (existing.request_hash !== requestHash || existing.user_id !== user.user_id)
      throw new AppError(409, 'Esta clave de operación ya se utilizó con otros datos.');
    return saleDetail(db, existing.id, user);
  }
  await lockOwnShift(db, user, b.shift_id);
  if (new Set(b.items.map((x) => x.product_id)).size !== b.items.length)
    throw new AppError(400, 'Consolidá las cantidades de productos repetidos.');
  if (new Set(b.payments.map((x) => x.method)).size !== b.payments.length)
    throw new AppError(400, 'No repitas un mismo medio de pago.');
  if (b.discount_cents && !can(user.role, 'discount'))
    throw new AppError(403, 'No tenés permiso para aplicar descuentos.');
  const products = (
    await db.query<Product>(
      'SELECT * FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [b.items.map((i) => i.product_id)],
    )
  ).rows;
  if (products.length !== b.items.length)
    throw new AppError(404, 'Uno de los productos no existe.');
  const lines = products.map((p) => {
    const item = b.items.find((x) => x.product_id === p.id)!;
    if (!p.active) throw new AppError(409, `${p.name} está desactivado.`);
    if (p.unit === 'unit' && item.qty_milli % 1000 !== 0)
      throw new AppError(400, `${p.name} se vende por unidad.`);
    return { product: p, qty: item.qty_milli, total: lineTotal(p.price_cents, item.qty_milli) };
  });
  const tenant = (await db.query('SELECT tax_rate_bps FROM tenants')).rows[0];
  const totals = saleTotals(
    lines.map((l) => ({
      id: l.product.id,
      price_cents: l.product.price_cents,
      qty_milli: l.qty,
      tax_rate_bps: l.product.tax_rate_bps ?? tenant.tax_rate_bps,
    })),
    b.discount_cents,
  );
  const subtotal = totals.subtotal_cents;
  const total = totals.total_cents;
  if (total <= 0) throw new AppError(400, 'El total de la venta debe ser mayor a cero.');
  if (sumMoney(b.payments.map((p) => p.amount_cents)) !== total)
    throw new AppError(
      409,
      'Los pagos no coinciden con el total actual. Revisá los precios y volvé a cobrar.',
    );
  for (const p of paymentRecorder.record(b.payments).payments) {
    if (p.tendered_cents < p.amount_cents)
      throw new AppError(400, 'El importe recibido es insuficiente.');
    if (p.method !== 'cash' && p.tendered_cents !== p.amount_cents)
      throw new AppError(400, 'Sólo efectivo puede generar vuelto.');
    if (['cash', 'account'].includes(p.method) && p.status !== 'manual')
      throw new AppError(400, 'Efectivo y cuenta corriente se registran manualmente.');
  }
  const credit = b.payments.find((p) => p.method === 'account');
  if (credit && !b.customer_id)
    throw new AppError(400, 'Seleccioná un cliente para usar cuenta corriente.');
  if (b.customer_id) {
    const customer = requireFound(
      (await db.query('SELECT * FROM customers WHERE id=$1 FOR UPDATE', [b.customer_id])).rows[0],
    );
    if (credit) {
      const balance = (
        await db.query(
          'SELECT coalesce(sum(amount_cents),0)::bigint AS n FROM customer_movements WHERE customer_id=$1',
          [b.customer_id],
        )
      ).rows[0].n;
      if (balance + credit.amount_cents > customer.credit_limit_cents)
        throw new AppError(409, 'El cliente supera su límite de crédito.');
    }
  }
  const settings = requireFound(
    (
      await db.query(
        'UPDATE tenants SET next_sale_number=next_sale_number+1 RETURNING id,name,address,tax_id,timezone,paper_width,currency,tax_rate_bps,receipt_footer,next_sale_number',
      )
    ).rows[0],
  );
  const change = sumMoney(b.payments.map((p) => p.tendered_cents - p.amount_cents));
  const {
    rows: [sale],
  } = await db.query(
    'INSERT INTO sales(tenant_id,number,shift_id,user_id,customer_id,idempotency_key,request_hash,subtotal_cents,discount_cents,total_cents,change_cents,receipt_settings,tax_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
    [
      user.tenant_id,
      settings.next_sale_number,
      b.shift_id,
      user.user_id,
      b.customer_id,
      b.idempotency_key,
      requestHash,
      subtotal,
      b.discount_cents,
      total,
      change,
      JSON.stringify({ ...settings, document: fiscalProvider.issue() }),
      totals.tax_cents,
    ],
  );
  for (const l of lines) {
    const calculated = totals.lines.find((x) => x.id === l.product.id)!;
    await db.query(
      'INSERT INTO sale_lines(tenant_id,sale_id,product_id,name,sku,unit,qty_milli,price_cents,cost_cents,total_cents,tax_rate_bps,discount_cents,tax_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [
        user.tenant_id,
        sale.id,
        l.product.id,
        l.product.name,
        l.product.sku,
        l.product.unit,
        l.qty,
        l.product.price_cents,
        l.product.cost_cents,
        l.total,
        calculated.tax_rate_bps,
        calculated.discount_cents,
        calculated.tax_cents,
      ],
    );
    await db.query(
      "INSERT INTO inventory_movements(tenant_id,product_id,user_id,qty_milli,kind,reference_id,reason) VALUES($1,$2,$3,$4,'sale',$5,'Venta')",
      [user.tenant_id, l.product.id, user.user_id, -l.qty, sale.id],
    );
  }
  for (const p of paymentRecorder.record(b.payments).payments) {
    await db.query(
      'INSERT INTO sale_payments(tenant_id,sale_id,method,status,amount_cents,tendered_cents) VALUES($1,$2,$3,$4,$5,$6)',
      [user.tenant_id, sale.id, p.method, p.status, p.amount_cents, p.tendered_cents],
    );
    if (p.method === 'cash')
      await cashMovement(
        db,
        user,
        b.shift_id,
        p.amount_cents,
        'sale',
        sale.id,
        'Venta en efectivo',
      );
    if (p.method === 'account')
      await db.query(
        "INSERT INTO customer_movements(tenant_id,customer_id,user_id,amount_cents,kind,reference_id,reason) VALUES($1,$2,$3,$4,'sale',$5,'Venta a cuenta')",
        [user.tenant_id, b.customer_id, user.user_id, p.amount_cents, sale.id],
      );
  }
  await audit(db, user, 'sale.complete', sale.id, { total_cents: total });
  return saleDetail(db, sale.id, user);
}
export async function salesRoutes(app: FastifyInstance) {
  app.post('/api/sales', async (req) => {
    const user = auth(req, 'sell');
    const b = saleSchema.parse(req.body);
    return withUser(user, (db) => completeSale(db, user, b));
  });
  app.get('/api/sales', async (req) => {
    const user = auth(req, 'sell');
    const q = z
      .object({
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    return withUser(
      user,
      async (db) =>
        (
          await db.query(
            "SELECT s.id,s.number,s.total_cents,s.discount_cents,s.created_at,u.name AS user_name,c.name AS customer_name,EXISTS(SELECT 1 FROM sale_returns r WHERE r.sale_id=s.id) AS returned,(SELECT string_agg(p.method,',') FROM sale_payments p WHERE p.sale_id=s.id) AS methods,EXISTS(SELECT 1 FROM sale_payments p WHERE p.sale_id=s.id AND p.status='pending' AND NOT EXISTS(SELECT 1 FROM payment_confirmations c WHERE c.sale_id=p.sale_id AND c.method=p.method)) AS pending_payment FROM sales s JOIN users u ON u.id=s.user_id LEFT JOIN customers c ON c.id=s.customer_id WHERE ($1::date IS NULL OR s.created_at>=($1::date::timestamp AT TIME ZONE (SELECT timezone FROM tenants))) AND ($2::date IS NULL OR s.created_at<(($2::date+1)::timestamp AT TIME ZONE (SELECT timezone FROM tenants))) ORDER BY s.created_at DESC LIMIT $3 OFFSET $4",
            [q.from ?? null, q.to ?? null, q.limit, q.offset],
          )
        ).rows,
    );
  });
  app.get('/api/sales/:id/ticket.pdf', async (req, reply) => {
    const user = auth(req, 'sell');
    const id = uuid.parse((req.params as { id: string }).id);
    const sale = await withUser(user, (db) => saleDetail(db, id, user));
    const settings = sale.receipt_settings;
    const rows = [
      settings.address,
      settings.tax_id ? `CUIT: ${settings.tax_id}` : '',
      'TICKET COMERCIAL - NO VÁLIDO COMO FACTURA',
      `Operación #${sale.number} · ${new Date(sale.created_at).toLocaleString('es-AR', { timeZone: settings.timezone })}`,
      `Atendió: ${sale.user_name}`,
      ...(sale.returned ? ['DEVOLUCIÓN TOTAL REGISTRADA'] : []),
      ...sale.lines.map(
        (l: { name: string; qty_milli: number; price_cents: number; total_cents: number }) =>
          `${l.name} · ${qty(l.qty_milli)} x ${money(l.price_cents)} = ${money(l.total_cents)}`,
      ),
      `Subtotal: ${money(sale.subtotal_cents)}`,
      `Descuento: ${money(sale.discount_cents)}`,
      `TOTAL: ${money(sale.total_cents)}`,
      `Impuestos incluidos: ${money(sale.tax_cents)}`,
      ...sale.payments.map(
        (p: { method: keyof typeof paymentNames; amount_cents: number; status: string }) =>
          `${paymentNames[p.method]}: ${money(p.amount_cents)}${p.status === 'pending' ? ' (pendiente)' : ''}`,
      ),
      `Vuelto: ${money(sale.change_cents)}`,
      settings.receipt_footer ?? '¡Gracias por tu compra!',
    ];
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="ticket-${sale.number}.pdf"`)
      .send(await createPdf(settings.name, rows));
  });
  app.get('/api/sales/:id', async (req) => {
    const user = auth(req, 'sell');
    const id = uuid.parse((req.params as { id: string }).id);
    return withUser(user, (db) => saleDetail(db, id, user));
  });
  app.post('/api/sales/:id/confirm-payment', async (req) => {
    const user = auth(req, 'sell');
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z
      .object({
        method: z.enum(['debit', 'credit', 'wallet', 'transfer']),
        reference: z.string().trim().min(5).max(160),
      })
      .strict()
      .parse(req.body);
    return withUser(user, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${user.tenant_id}:return:${id}`,
      ]);
      const sale = requireFound(
        (await db.query('SELECT user_id FROM sales WHERE id=$1', [id])).rows[0],
      );
      if (sale.user_id !== user.user_id && !can(user.role, 'reports'))
        throw new AppError(403, 'Sólo podés confirmar pagos de tus ventas.');
      if ((await db.query('SELECT id FROM sale_returns WHERE sale_id=$1', [id])).rowCount)
        throw new AppError(409, 'La venta fue devuelta.');
      const payment = requireFound(
        (
          await db.query('SELECT status FROM sale_payments WHERE sale_id=$1 AND method=$2', [
            id,
            b.method,
          ])
        ).rows[0],
      );
      const old = (
        await db.query(
          'SELECT reference FROM payment_confirmations WHERE sale_id=$1 AND method=$2',
          [id, b.method],
        )
      ).rows[0];
      if (old) {
        if (old.reference !== b.reference)
          throw new AppError(409, 'Este pago ya tiene otra confirmación.');
        return saleDetail(db, id, user);
      }
      if (payment.status !== 'pending')
        throw new AppError(409, 'El pago ya fue registrado manualmente.');
      await db.query(
        'INSERT INTO payment_confirmations(tenant_id,sale_id,method,user_id,reference) VALUES($1,$2,$3,$4,$5)',
        [user.tenant_id, id, b.method, user.user_id, b.reference],
      );
      await audit(db, user, 'payment.confirm_manual', id, b);
      return saleDetail(db, id, user);
    });
  });
  app.post('/api/sales/:id/return', async (req) => {
    const user = auth(req, 'refund');
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z
      .object({ shift_id: uuid, reason: z.string().trim().min(5).max(300) })
      .strict()
      .parse(req.body);
    return withUser(user, async (db) => {
      await lockOwnShift(db, user, b.shift_id);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${user.tenant_id}:return:${id}`,
      ]);
      const sale = requireFound((await db.query('SELECT * FROM sales WHERE id=$1', [id])).rows[0]);
      const old = (await db.query('SELECT * FROM sale_returns WHERE sale_id=$1', [id])).rows[0];
      if (old) {
        if (old.reason !== b.reason || old.shift_id !== b.shift_id)
          throw new AppError(409, 'La venta ya tiene una devolución.');
        return saleDetail(db, id, user);
      }
      const lines = (
        await db.query('SELECT * FROM sale_lines WHERE sale_id=$1 ORDER BY product_id', [id])
      ).rows;
      await db.query('SELECT id FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
        lines.map((l) => l.product_id),
      ]);
      if (sale.customer_id)
        await db.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [sale.customer_id]);
      await db.query(
        'INSERT INTO sale_returns(tenant_id,sale_id,shift_id,user_id,reason) VALUES($1,$2,$3,$4,$5)',
        [user.tenant_id, id, b.shift_id, user.user_id, b.reason],
      );
      for (const l of lines)
        await db.query(
          "INSERT INTO inventory_movements(tenant_id,product_id,user_id,qty_milli,kind,reference_id,reason) VALUES($1,$2,$3,$4,'return',$5,$6)",
          [user.tenant_id, l.product_id, user.user_id, l.qty_milli, id, b.reason],
        );
      const payments = (await db.query('SELECT * FROM sale_payments WHERE sale_id=$1', [id])).rows;
      for (const p of payments) {
        if (p.method === 'cash')
          await cashMovement(db, user, b.shift_id, -p.amount_cents, 'return', id, b.reason);
        if (p.method === 'account')
          await db.query(
            "INSERT INTO customer_movements(tenant_id,customer_id,user_id,amount_cents,kind,reference_id,reason) VALUES($1,$2,$3,$4,'return',$5,$6)",
            [user.tenant_id, sale.customer_id, user.user_id, -p.amount_cents, id, b.reason],
          );
      }
      await audit(db, user, 'sale.return', id, { reason: b.reason });
      return saleDetail(db, id, user);
    });
  });
  app.get('/api/held-sales', async (req) => {
    const user = auth(req, 'sell');
    return withUser(
      user,
      async (db) =>
        (
          await db.query('SELECT * FROM held_sales WHERE user_id=$1 ORDER BY created_at DESC', [
            user.user_id,
          ])
        ).rows,
    );
  });
  app.post('/api/held-sales', async (req) => {
    const user = auth(req, 'sell');
    const b = z
      .object({
        label: z.string().trim().min(1).max(80),
        items: z
          .array(
            z
              .object({ product_id: uuid, qty_milli: z.number().int().min(1).max(1_000_000_000) })
              .strict(),
          )
          .min(1)
          .max(200),
      })
      .strict()
      .parse(req.body);
    return withUser(
      user,
      async (db) =>
        (
          await db.query(
            'INSERT INTO held_sales(tenant_id,user_id,label,items) VALUES($1,$2,$3,$4) RETURNING *',
            [user.tenant_id, user.user_id, b.label, JSON.stringify(b.items)],
          )
        ).rows[0],
    );
  });
  app.delete('/api/held-sales/:id', async (req) => {
    const user = auth(req, 'sell');
    const id = uuid.parse((req.params as { id: string }).id);
    return withUser(user, async (db) => {
      const result = await db.query('DELETE FROM held_sales WHERE id=$1 AND user_id=$2', [
        id,
        user.user_id,
      ]);
      if (!result.rowCount) throw new AppError(404, 'No se encontró la venta suspendida.');
      return { ok: true };
    });
  });
}
