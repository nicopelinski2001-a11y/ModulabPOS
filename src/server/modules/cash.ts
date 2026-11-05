import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { command } from '../lib/commands.js';
import { auth } from '../lib/auth.js';
import { withUser, audit, type DB } from '../lib/db.js';
import { AppError, requireFound } from '../lib/errors.js';
import { createPdf } from '../lib/pdf.js';
import { serializeCsv } from '../../shared/csv.js';
import { decimalInput } from '../../shared/money.js';
import { paymentNames } from '../../shared/payments.js';
import { uuid, cents, type User } from '../../shared/domain.js';
export async function lockOwnShift(db: DB, user: User, id: string) {
  const shift = requireFound(
    (await db.query('SELECT * FROM cash_shifts WHERE id=$1 FOR UPDATE', [id])).rows[0],
  );
  if (shift.closed_at) throw new AppError(409, 'La caja ya está cerrada.');
  if (shift.user_id !== user.user_id) throw new AppError(403, 'La caja pertenece a otro empleado.');
  return shift;
}
export async function cashMovement(
  db: DB,
  user: User,
  shiftId: string,
  amount: number,
  kind: string,
  reference: string,
  reason: string,
) {
  if (amount)
    await db.query(
      'INSERT INTO cash_movements(tenant_id,shift_id,user_id,amount_cents,kind,reference_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [user.tenant_id, shiftId, user.user_id, amount, kind, reference, reason],
    );
}
export async function cashRoutes(app: FastifyInstance) {
  app.get('/api/cash/registers', async (req) =>
    withUser(
      auth(req, 'cash'),
      async (db) =>
        (
          await db.query(
            'SELECT r.*,b.name AS branch_name FROM cash_registers r JOIN branches b ON b.id=r.branch_id ORDER BY r.name',
          )
        ).rows,
    ),
  );
  app.get('/api/cash/shifts', async (req) => {
    const user = auth(req, 'cash');
    return withUser(
      user,
      async (db) =>
        (
          await db.query(
            'SELECT s.*,r.name AS register_name,u.name AS user_name,coalesce(s.expected_cents,s.opening_cents+coalesce((SELECT sum(m.amount_cents) FROM cash_movements m WHERE m.shift_id=s.id),0))::bigint AS expected_cents FROM cash_shifts s JOIN cash_registers r ON r.id=s.register_id JOIN users u ON u.id=s.user_id WHERE ($1 OR s.user_id=$2) ORDER BY s.opened_at DESC LIMIT 100',
            [user.role === 'owner' || user.role === 'admin', user.user_id],
          )
        ).rows,
    );
  });
  app.get('/api/cash/shifts/:id/movements', async (req) => {
    const user = auth(req, 'cash');
    const id = uuid.parse((req.params as { id: string }).id);
    return withUser(user, async (db) => {
      const shift = requireFound(
        (await db.query('SELECT user_id FROM cash_shifts WHERE id=$1', [id])).rows[0],
      );
      if (shift.user_id !== user.user_id && !['owner', 'admin'].includes(user.role))
        throw new AppError(403, 'No tenés acceso a esta caja.');
      return (
        await db.query('SELECT * FROM cash_movements WHERE shift_id=$1 ORDER BY created_at DESC', [
          id,
        ])
      ).rows;
    });
  });
  app.get('/api/cash/shifts/:id/report', async (req, reply) => {
    const user = auth(req, 'cash');
    const id = uuid.parse((req.params as { id: string }).id);
    const { format } = z
      .object({ format: z.enum(['json', 'csv', 'pdf']).default('json') })
      .parse(req.query);
    const data = await withUser(
      user,
      async (db) => {
        const shift = requireFound(
          (
            await db.query(
              'SELECT s.*,r.name AS register_name,u.name AS user_name,t.name AS store_name,t.timezone FROM cash_shifts s JOIN cash_registers r ON r.id=s.register_id JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=s.tenant_id WHERE s.id=$1',
              [id],
            )
          ).rows[0],
        );
        if (shift.user_id !== user.user_id && !['owner', 'admin'].includes(user.role))
          throw new AppError(403, 'No tenés acceso a esta caja.');
        const balance = (
          await db.query(
            'SELECT coalesce(sum(amount_cents),0)::bigint AS amount FROM cash_movements WHERE shift_id=$1',
            [id],
          )
        ).rows[0].amount;
        const payments = (
          await db.query(
            `WITH payments AS (
        SELECT p.method,p.amount_cents AS amount FROM sale_payments p JOIN sales s ON s.id=p.sale_id WHERE s.shift_id=$1
        UNION ALL SELECT p.method,-p.amount_cents FROM sale_payments p JOIN sale_returns r ON r.sale_id=p.sale_id WHERE r.shift_id=$1
      ) SELECT method,sum(amount)::bigint AS amount_cents FROM payments GROUP BY method ORDER BY method`,
            [id],
          )
        ).rows;
        const movements = (
          await db.query(
            'SELECT created_at,kind,reason,amount_cents FROM cash_movements WHERE shift_id=$1 ORDER BY created_at LIMIT 10000',
            [id],
          )
        ).rows;
        const expected = shift.opening_cents + balance;
        return {
          shift,
          expected_cents: expected,
          difference_cents: shift.counted_cents === null ? null : shift.counted_cents - expected,
          payments,
          movements,
        };
      },
      { readOnly: true },
    );
    if (format === 'json') return data;
    const at = (value: string) =>
      new Date(value).toLocaleString('es-AR', { timeZone: data.shift.timezone });
    const rows: unknown[][] = [
      [data.shift.store_name, data.shift.register_name, data.shift.user_name],
      ['Turno', data.shift.id],
      ['Apertura', at(data.shift.opened_at)],
      ['Cierre', data.shift.closed_at ? at(data.shift.closed_at) : 'Abierto'],
      ['Fondo inicial ARS', decimalInput(data.shift.opening_cents)],
      ['Efectivo esperado ARS', decimalInput(data.expected_cents)],
      [
        'Efectivo contado ARS',
        data.shift.counted_cents === null ? 'Sin arqueo' : decimalInput(data.shift.counted_cents),
      ],
      [
        'Diferencia ARS',
        data.difference_cents === null ? 'Sin arqueo' : decimalInput(data.difference_cents),
      ],
      ['Motivo', data.shift.close_reason ?? ''],
      [],
      ['Ventas menos devoluciones por medio', 'Importe ARS'],
      ...data.payments.map((p) => [
        paymentNames[p.method as keyof typeof paymentNames],
        decimalInput(p.amount_cents),
      ]),
      [],
      ['Movimientos de efectivo (hasta 10000)', 'Concepto', 'Importe ARS'],
      ...data.movements.map((m) => [at(m.created_at), m.reason, decimalInput(m.amount_cents)]),
    ];
    reply.header('Content-Disposition', `attachment; filename="cierre-${id}.${format}"`);
    if (format === 'csv') return reply.type('text/csv; charset=utf-8').send(serializeCsv(rows));
    return reply.type('application/pdf').send(
      await createPdf(
        `${data.shift.store_name} · Arqueo de caja`,
        rows.map((r) => r.join(' | ')),
      ),
    );
  });
  app.post('/api/cash/open', async (req) => {
    const user = auth(req, 'cash');
    const b = z
      .object({ register_id: uuid, opening_cents: cents, idempotency_key: uuid.optional() })
      .strict()
      .parse(req.body);
    return withUser(user, (db) => {
      const open = async () => {
        requireFound(
          (await db.query('SELECT id FROM cash_registers WHERE id=$1', [b.register_id])).rows[0],
        );
        const {
          rows: [row],
        } = await db.query(
          'INSERT INTO cash_shifts(tenant_id,register_id,user_id,opening_cents) VALUES($1,$2,$3,$4) RETURNING *',
          [user.tenant_id, b.register_id, user.user_id, b.opening_cents],
        );
        await audit(db, user, 'cash.open', row.id, b);
        return row;
      };
      return b.idempotency_key
        ? command(db, user, b.idempotency_key, 'cash.open', b, open)
        : open();
    });
  });
  app.post('/api/cash/movement', async (req) => {
    const user = auth(req, 'cash');
    const b = z
      .object({
        shift_id: uuid,
        kind: z.enum(['in', 'out']),
        amount_cents: cents.min(1),
        reason: z.string().trim().min(5).max(300),
        idempotency_key: uuid,
      })
      .strict()
      .parse(req.body);
    return withUser(user, (db) =>
      command(db, user, b.idempotency_key, 'cash.movement', { ...b }, async () => {
        await lockOwnShift(db, user, b.shift_id);
        const old = (
          await db.query('SELECT * FROM cash_movements WHERE reference_id=$1 AND kind=$2', [
            b.idempotency_key,
            b.kind,
          ])
        ).rows[0];
        const amount = b.kind === 'out' ? -b.amount_cents : b.amount_cents;
        if (old) {
          if (old.amount_cents !== amount || old.shift_id !== b.shift_id || old.reason !== b.reason)
            throw new AppError(409, 'La clave de reintento tiene otros datos.');
          return old;
        }
        await cashMovement(db, user, b.shift_id, amount, b.kind, b.idempotency_key, b.reason);
        await audit(db, user, 'cash.movement', b.idempotency_key, b);
        return { ok: true };
      }),
    );
  });
  app.post('/api/cash/close', async (req) => {
    const user = auth(req, 'cash');
    const b = z
      .object({ shift_id: uuid, counted_cents: cents, reason: z.string().trim().min(5).max(300) })
      .strict()
      .parse(req.body);
    return withUser(user, async (db) => {
      const shift = requireFound(
        (await db.query('SELECT * FROM cash_shifts WHERE id=$1 FOR UPDATE', [b.shift_id])).rows[0],
      );
      if (shift.user_id !== user.user_id && !['owner', 'admin'].includes(user.role))
        throw new AppError(403, 'No podés cerrar esta caja.');
      if (shift.closed_at) {
        if (shift.counted_cents !== b.counted_cents || shift.close_reason !== b.reason)
          throw new AppError(409, 'La caja ya tiene otro cierre.');
        return shift;
      }
      const expected =
        shift.opening_cents +
        (
          await db.query(
            'SELECT coalesce(sum(amount_cents),0)::bigint AS n FROM cash_movements WHERE shift_id=$1',
            [b.shift_id],
          )
        ).rows[0].n;
      const {
        rows: [row],
      } = await db.query(
        'UPDATE cash_shifts SET closed_at=now(),counted_cents=$1,expected_cents=$2,close_reason=$3 WHERE id=$4 RETURNING *',
        [b.counted_cents, expected, b.reason, b.shift_id],
      );
      await audit(db, user, 'cash.close', row.id, {
        expected,
        counted: b.counted_cents,
        difference: b.counted_cents - expected,
        reason: b.reason,
      });
      return row;
    });
  });
}
