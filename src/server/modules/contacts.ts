import { command } from '../lib/commands.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auth } from '../lib/auth.js';
import { withUser, audit } from '../lib/db.js';
import { AppError, requireFound } from '../lib/errors.js';
import { cents, text, uuid } from '../../shared/domain.js';
import { lockOwnShift, cashMovement } from './cash.js';
const contactSchema = z
  .object({
    name: text,
    contact: z.string().trim().max(200).default(''),
    tax_id: z.string().trim().max(30).default(''),
  })
  .strict();
export async function contactRoutes(app: FastifyInstance) {
  app.get('/api/suppliers', async (req) =>
    withUser(
      auth(req, 'suppliers'),
      async (db) =>
        (
          await db.query(
            "SELECT s.*,coalesce((SELECT sum(p.total_cents) FROM purchases p WHERE p.supplier_id=s.id AND p.status='received'),0)::bigint-coalesce((SELECT sum(sp.amount_cents) FROM supplier_payments sp JOIN purchases p ON p.id=sp.purchase_id WHERE p.supplier_id=s.id),0)::bigint AS balance_cents FROM suppliers s ORDER BY s.name",
          )
        ).rows,
    ),
  );
  app.post('/api/suppliers', async (req) => {
    const user = auth(req, 'suppliers');
    const b = contactSchema.parse(req.body);
    return withUser(user, async (db) => {
      const {
        rows: [row],
      } = await db.query(
        'INSERT INTO suppliers(tenant_id,name,contact,tax_id) VALUES($1,$2,$3,$4) RETURNING *',
        [user.tenant_id, b.name, b.contact, b.tax_id],
      );
      await audit(db, user, 'supplier.create', row.id);
      return row;
    });
  });
  app.get('/api/customers', async (req) => {
    const user = auth(req, 'customers');
    return withUser(
      user,
      async (db) =>
        (
          await db.query(
            'SELECT c.*,coalesce((SELECT sum(m.amount_cents) FROM customer_movements m WHERE m.customer_id=c.id),0)::bigint AS balance_cents FROM customers c ORDER BY c.name',
          )
        ).rows,
    );
  });
  app.post('/api/customers', async (req) => {
    const user = auth(req, 'customers');
    const b = contactSchema.extend({ credit_limit_cents: cents.default(0) }).parse(req.body);
    if (b.credit_limit_cents && !['owner', 'admin'].includes(user.role))
      throw new AppError(403, 'Sólo administración puede habilitar crédito.');
    return withUser(user, async (db) => {
      const {
        rows: [row],
      } = await db.query(
        'INSERT INTO customers(tenant_id,name,contact,tax_id,credit_limit_cents) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [user.tenant_id, b.name, b.contact, b.tax_id, b.credit_limit_cents],
      );
      await audit(db, user, 'customer.create', row.id, {
        credit_limit_cents: b.credit_limit_cents,
      });
      return row;
    });
  });
  app.get('/api/customers/:id/movements', async (req) => {
    const user = auth(req, 'customers');
    const id = uuid.parse((req.params as { id: string }).id);
    return withUser(user, async (db) => {
      requireFound((await db.query('SELECT id FROM customers WHERE id=$1', [id])).rows[0]);
      return (
        await db.query(
          'SELECT * FROM customer_movements WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 500',
          [id],
        )
      ).rows;
    });
  });
  app.post('/api/customers/:id/payments', async (req) => {
    const user = auth(req, 'cash');
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
        'customer.payment',
        { ...b, customer_id: id },
        async () => {
          await lockOwnShift(db, user, b.shift_id);
          requireFound(
            (await db.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [id])).rows[0],
          );
          const old = (
            await db.query('SELECT * FROM customer_movements WHERE idempotency_key=$1', [
              b.idempotency_key,
            ])
          ).rows[0];
          if (old) {
            if (
              old.customer_id !== id ||
              old.amount_cents !== -b.amount_cents ||
              old.method !== b.method
            )
              throw new AppError(409, 'La clave de reintento tiene otros datos.');
            return old;
          }
          const balance = (
            await db.query(
              'SELECT coalesce(sum(amount_cents),0)::bigint AS n FROM customer_movements WHERE customer_id=$1',
              [id],
            )
          ).rows[0].n;
          if (b.amount_cents > balance)
            throw new AppError(409, 'El pago supera la deuda del cliente.');
          const {
            rows: [row],
          } = await db.query(
            "INSERT INTO customer_movements(tenant_id,customer_id,user_id,amount_cents,kind,idempotency_key,method,reason) VALUES($1,$2,$3,$4,'payment',$5,$6,'Cobranza de cuenta corriente') RETURNING *",
            [user.tenant_id, id, user.user_id, -b.amount_cents, b.idempotency_key, b.method],
          );
          if (b.method === 'cash')
            await cashMovement(
              db,
              user,
              b.shift_id,
              b.amount_cents,
              'collection',
              row.id,
              'Cobranza de cuenta corriente',
            );
          await audit(db, user, 'customer.payment', row.id, b);
          return row;
        },
      ),
    );
  });
}
