import pg, { type PoolClient } from 'pg';
import { config } from './config.js';
import type { User } from '../../shared/domain.js';
pg.types.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('BIGINT fuera de precisión segura');
  return n;
});
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 12,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 10000,
});
export type DB = PoolClient;
export async function transaction<T>(
  tenantId: string,
  userId: string | null,
  fn: (db: DB) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)", [
      tenantId,
      userId ?? '',
    ]);
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export const withUser = <T>(user: User, fn: (db: DB) => Promise<T>) =>
  transaction(user.tenant_id, user.user_id, fn);
export async function assertDatabaseRole() {
  const {
    rows: [role],
  } = await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  const {
    rows: [owned],
  } = await pool.query(
    "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tableowner=current_user",
  );
  if (role.rolsuper || role.rolbypassrls || owned.n > 0)
    throw new Error('DATABASE_URL debe usar un rol sin propiedad, SUPERUSER o BYPASSRLS.');
  const { rows } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'login_attempts' AND NOT (rowsecurity AND (SELECT relforcerowsecurity FROM pg_class WHERE oid=(quote_ident(schemaname)||'.'||quote_ident(tablename))::regclass))",
  );
  if (rows.length) throw new Error('Falta RLS forzado en tablas del comercio.');
}
export async function audit(
  db: DB,
  user: User,
  action: string,
  entityId: string | null,
  detail: unknown = {},
) {
  await db.query(
    'INSERT INTO audit_events(tenant_id,user_id,action,entity_id,detail) VALUES($1,$2,$3,$4,$5)',
    [user.tenant_id, user.user_id, action, entityId, JSON.stringify(detail)],
  );
}
