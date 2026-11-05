import { tokenHash } from './auth.js';
import { AppError } from './errors.js';
import type { DB } from './db.js';
import type { User } from '../../shared/domain.js';
export async function command<T>(
  db: DB,
  user: User,
  key: string,
  kind: string,
  input: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${user.tenant_id}:command:${key}`,
  ]);
  const hash = tokenHash(JSON.stringify(input));
  const old = (await db.query('SELECT * FROM commands WHERE idempotency_key=$1', [key])).rows[0];
  if (old) {
    if (old.kind !== kind || old.request_hash !== hash || old.user_id !== user.user_id)
      throw new AppError(409, 'La clave de reintento tiene otros datos.');
    return old.result as T;
  }
  const result = await fn();
  await db.query(
    'INSERT INTO commands(tenant_id,user_id,idempotency_key,kind,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)',
    [user.tenant_id, user.user_id, key, kind, hash, JSON.stringify(result)],
  );
  return result;
}
