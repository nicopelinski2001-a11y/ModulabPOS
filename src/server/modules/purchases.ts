import { command } from '../lib/commands.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auth } from '../lib/auth.js';
import { withUser, audit } from '../lib/db.js';
import { AppError, requireFound } from '../lib/errors.js';
import { uuid, text, cents, quantity, lineTotal, sumMoney } from '../../shared/domain.js';
import { lockOwnShift, cashMovement } from './cash.js';
export async function purchaseRoutes(app: FastifyInstance) {
  app.get('/api/purchases', async (req) =>
    withUser(
      auth(req, 'purchases'),
      async (db) =>
        (
          await db.query(
            'SELECT p.*,s.name AS supplier_name,coalesce((SELECT sum(sp.amount_cents) FROM supplier_payments sp WHERE sp.purchase_id=p.id),0)::bigint AS paid_cents FROM purchases p JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.created_at DESC LIMIT 300',
          )
        ).rows,
    ),
  );
  app.post('/api/purchases', async (req) => {
    const user = auth(req, 'purchases');
    const b = z
      .object({
        supplier_id: uuid,
        reference: text,
        items: z
          .array(
            z
              .object({
                product_id: uuid,
                qty_milli: quantity,
                cost_cents: cents.min(1).max(1_000_000_000),
              })
              .strict(),
          )
          .min(1)
          .max(200),
      })
      .strict()
      .parse(req.body);
    return withUser(user, async (db) => {
      requireFound(
        (await db.query('SELECT id FROM suppliers WHERE id=$1', [b.supplier_id])).rows[0],
      );
      if (new Set(b.items.map((i) => i.product_id)).size !== b.items.length)
        throw new AppError(400, 'No repitas productos en la compra.');
      const products = (
        await db.query('SELECT id,unit FROM products WHERE id=ANY($1::uuid[])', [
          b.items.map((i) => i.product_id),
        ])
      ).rows;
      if (products.length !== b.items.length) throw new AppError(404, 'Un producto no existe.');
      for (const i of b.items)
        if (products.find((p) => p.id === i.product_id).unit === 'unit' && i.qty_milli % 1000 !== 0)
          throw new AppError(400, 'Ingresá unidades enteras.');
      const totals = b.items.map((i) => lineTotal(i.cost_cents, i.qty_milli));
      const {
        rows: [row],
      } = await db.query(
        'INSERT INTO purchases(tenant_id,supplier_id,user_id,reference,total_cents) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [user.tenant_id, b.supplier_id, user.user_id, b.reference, sumMoney(totals)],
      );
      for (const [index, i] of b.items.entries())
        await db.query(
          'INSERT INTO purchase_lines(tenant_id,purchase_id,product_id,qty_milli,cost_cents,total_cents) VALUES($1,$2,$3,$4,$5,$6)',
          [user.tenant_id, row.id, i.product_id, i.qty_milli, i.cost_cents, totals[index]],
        );
      await audit(db, user, 'purchase.create', row.id, b);
      return row;
    });
  });
  app.post('/api/purchases/:id/receive', async (req) => {
    const user = auth(req, 'purchases');
    const id = uuid.parse((req.params as { id: string }).id);
    return withUser(user, async (db) => {
      const purchase = requireFound(
        (await db.query('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [id])).rows[0],
      );
      if (purchase.status === 'received') return purchase;
      const lines = (
        await db.query('SELECT * FROM purchase_lines WHERE purchase_id=$1 ORDER BY product_id', [
          id,
        ])
      ).rows;
      await db.query('SELECT id FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
        lines.map((l) => l.product_id),
      ]);
      for (const l of lines) {
        await db.query(
          "INSERT INTO inventory_movements(tenant_id,product_id,user_id,qty_milli,kind,reference_id,reason) VALUES($1,$2,$3,$4,'purchase',$5,'Recepción de compra')",
          [user.tenant_id, l.product_id, user.user_id, l.qty_milli, id],
        );
        await db.query('UPDATE products SET cost_cents=$1,updated_at=now() WHERE id=$2', [
          l.cost_cents,
          l.product_id,
        ]);
      }
      const {
        rows: [row],
      } = await db.query(
        "UPDATE purchases SET status='received',received_at=now() WHERE id=$1 RETURNING *",
        [id],
      );
      await audit(db, user, 'purchase.receive', id);
      return row;
    });
  });
  app.post('/api/purchases/:id/payments', async (req) => {
    const user = auth(req, 'cash');
    if (!['owner', 'admin'].includes(user.role))
      throw new AppError(403, 'Sólo administración puede pagar compras.');
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z
      .object({
        amount_cents: cents.min(1),
        method: z.enum(['cash', 'transfer']),
        shift_id: uuid,
        idempotency_key: uuid,
      })
      .strict()
      .parse(req.body);
    return withUser(user, (db) =>
      command(
        db,
        user,
        b.idempotency_key,
        'purchase.payment',
        { ...b, purchase_id: id },
        async () => {
          await lockOwnShift(db, user, b.shift_id);
          const purchase = requireFound(
            (await db.query('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [id])).rows[0],
          );
          if (purchase.status !== 'received')
            throw new AppError(409, 'Primero confirmá la recepción.');
          const old = (
            await db.query('SELECT * FROM supplier_payments WHERE idempotency_key=$1', [
              b.idempotency_key,
            ])
          ).rows[0];
          if (old) {
            if (
              old.purchase_id !== id ||
              old.amount_cents !== b.amount_cents ||
              old.method !== b.method
            )
              throw new AppError(409, 'La clave de reintento tiene otros datos.');
            return old;
          }
          const paid = (
            await db.query(
              'SELECT coalesce(sum(amount_cents),0)::bigint AS n FROM supplier_payments WHERE purchase_id=$1',
              [id],
            )
          ).rows[0].n;
          if (paid + b.amount_cents > purchase.total_cents)
            throw new AppError(409, 'El pago supera el saldo pendiente.');
          const {
            rows: [row],
          } = await db.query(
            'INSERT INTO supplier_payments(tenant_id,purchase_id,user_id,idempotency_key,amount_cents,method) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
            [user.tenant_id, id, user.user_id, b.idempotency_key, b.amount_cents, b.method],
          );
          if (b.method === 'cash')
            await cashMovement(
              db,
              user,
              b.shift_id,
              -b.amount_cents,
              'supplier_payment',
              row.id,
              'Pago a proveedor',
            );
          await audit(db, user, 'purchase.payment', row.id, b);
          return row;
        },
      ),
    );
  });
}
