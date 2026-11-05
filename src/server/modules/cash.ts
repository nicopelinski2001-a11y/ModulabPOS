import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auth } from '../lib/auth.js';
import { withUser, audit, type DB } from '../lib/db.js';
import { AppError, requireFound } from '../lib/errors.js';
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
  app.post('/api/cash/open', async (req) => {
    const user = auth(req, 'cash');
    const b = z.object({ register_id: uuid, opening_cents: cents }).strict().parse(req.body);
    return withUser(user, async (db) => {
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
    return withUser(user, async (db) => {
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
    });
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
