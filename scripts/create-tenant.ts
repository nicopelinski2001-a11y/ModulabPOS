import pg from 'pg';
import { z } from 'zod';
import { hashPassword } from '../src/server/lib/password.js';
export async function createTenant(
  db: pg.Client,
  input: { slug: string; name: string; email: string; password: string; ownerName?: string },
) {
  const b = z
    .object({
      slug: z.string().regex(/^[a-z0-9-]{3,50}$/),
      name: z.string().min(1).max(160),
      email: z
        .string()
        .email()
        .transform((v) => v.toLowerCase()),
      password: z.string().min(12).max(128),
      ownerName: z.string().default('Propietario'),
    })
    .parse(input);
  const hash = await hashPassword(b.password);
  await db.query('BEGIN');
  try {
    const {
      rows: [tenant],
    } = await db.query('INSERT INTO tenants(slug,name) VALUES($1,$2) RETURNING *', [
      b.slug,
      b.name,
    ]);
    await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenant.id]);
    const {
      rows: [owner],
    } = await db.query(
      "INSERT INTO users(tenant_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'owner') RETURNING id",
      [tenant.id, b.ownerName, b.email, hash],
    );
    const {
      rows: [branch],
    } = await db.query(
      "INSERT INTO branches(tenant_id,name) VALUES($1,'Casa central') RETURNING id",
      [tenant.id],
    );
    await db.query(
      "INSERT INTO cash_registers(tenant_id,branch_id,name) VALUES($1,$2,'Caja 01'),($1,$2,'Caja 02')",
      [tenant.id, branch.id],
    );
    await db.query(
      "INSERT INTO audit_events(tenant_id,user_id,action) VALUES($1,$2,'tenant.create')",
      [tenant.id, owner.id],
    );
    await db.query('COMMIT');
    return { tenant, owner };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}
if (process.argv[1]?.endsWith('create-tenant.ts')) {
  if (!process.env.ADMIN_DATABASE_URL) throw new Error('Falta ADMIN_DATABASE_URL');
  const [slug, name, email] = process.argv.slice(2);
  if (!slug || !name || !email || !process.env.OWNER_PASSWORD)
    throw new Error('Uso: OWNER_PASSWORD=... npm run tenant:create -- slug "Nombre" correo');
  const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await db.connect();
  try {
    await createTenant(db, { slug, name, email, password: process.env.OWNER_PASSWORD });
    console.log(`Comercio creado: ${slug}. Ingresá con el correo y la contraseña indicados.`);
  } finally {
    await db.end();
  }
}
