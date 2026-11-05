import pg from 'pg';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { hashPassword } from '../src/server/lib/password.js';
const input = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{3,50}$/),
    email: z.string().email(),
    password: z.string().min(12).max(128),
    url: z.string().startsWith('postgres'),
  })
  .parse({
    slug: process.argv[2],
    email: process.argv[3],
    password: process.env.NEW_PASSWORD,
    url: process.env.ADMIN_DATABASE_URL,
  });
const hash = await hashPassword(input.password);
const db = new pg.Client({ connectionString: input.url });
await db.connect();
try {
  await db.query('BEGIN');
  const account = (
    await db.query(
      'SELECT u.id,u.tenant_id FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE t.slug=$1 AND u.email=$2 FOR UPDATE OF u',
      [input.slug, input.email.toLowerCase()],
    )
  ).rows[0];
  if (!account) throw new Error('No existe ese usuario en el comercio indicado.');
  await db.query("SELECT set_config('app.tenant_id',$1,true)", [account.tenant_id]);
  await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, account.id]);
  await db.query('DELETE FROM sessions WHERE user_id=$1', [account.id]);
  const accountKey = createHash('sha256')
    .update(`${input.slug}:${input.email.toLowerCase()}`)
    .digest('hex');
  await db.query('SELECT login_succeeded($1)', [accountKey]);
  await db.query(
    "INSERT INTO audit_events(tenant_id,user_id,action,entity_id) VALUES($1,NULL,'user.password_reset',$2)",
    [account.tenant_id, account.id],
  );
  await db.query('COMMIT');
  console.log('Contraseña restablecida y sesiones revocadas.');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  await db.end();
}
