import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
if (
  !process.env.ADMIN_DATABASE_URL ||
  !process.env.APP_DATABASE_PASSWORD ||
  process.env.APP_DATABASE_PASSWORD.length < 16
)
  throw new Error('Definí ADMIN_DATABASE_URL y APP_DATABASE_PASSWORD (mínimo 16 caracteres).');
const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
await db.connect();
try {
  await db.query("SELECT pg_advisory_lock(hashtext('modulab-migrations'))");
  await db.query('CREATE SCHEMA IF NOT EXISTS modulab_meta');
  await db.query(
    'CREATE TABLE IF NOT EXISTS modulab_meta.migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const file of (await readdir('db/migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = await readFile(`db/migrations/${file}`, 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    const {
      rows: [old],
    } = await db.query('SELECT sha256 FROM modulab_meta.migrations WHERE name=$1', [file]);
    if (old) {
      if (old.sha256 !== hash) throw new Error(`Migración ya aplicada fue modificada: ${file}`);
      continue;
    }
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO modulab_meta.migrations(name,sha256) VALUES($1,$2)', [
        file,
        hash,
      ]);
      await db.query('COMMIT');
      console.log(`Aplicada ${file}`);
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  }
  const {
    rows: [existing],
  } = await db.query("SELECT rolname FROM pg_roles WHERE rolname='modulab_app'");
  // quote_literal runs inside PostgreSQL, never string-interpolate an unescaped secret.
  const {
    rows: [quoted],
  } = await db.query('SELECT quote_literal($1) AS password', [process.env.APP_DATABASE_PASSWORD]);
  if (!existing)
    await db.query(
      `CREATE ROLE modulab_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${quoted.password}`,
    );
  else
    await db.query(
      `ALTER ROLE modulab_app WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${quoted.password}`,
    );
  await db.query(
    'REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO modulab_app; REVOKE ALL ON ALL TABLES IN SCHEMA public FROM modulab_app; REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC',
  );
  const tables = [
    'tenants',
    'users',
    'sessions',
    'branches',
    'cash_registers',
    'cash_shifts',
    'suppliers',
    'products',
    'customers',
    'sales',
    'sale_lines',
    'sale_payments',
    'sale_returns',
    'cash_movements',
    'purchases',
    'purchase_lines',
    'supplier_payments',
    'inventory_movements',
    'customer_movements',
    'held_sales',
    'audit_events',
    'commands',
    'payment_confirmations',
  ];
  for (const table of tables) await db.query(`GRANT SELECT ON ${table} TO modulab_app`);
  await db.query(
    'REVOKE SELECT ON users FROM modulab_app; GRANT SELECT(id,tenant_id,name,email,role,active,created_at) ON users TO modulab_app',
  );
  for (const table of tables.filter((t) => !['tenants', 'branches', 'cash_registers'].includes(t)))
    await db.query(`GRANT INSERT ON ${table} TO modulab_app`);
  await db.query(
    'REVOKE INSERT ON products FROM modulab_app; GRANT INSERT(tenant_id,sku,barcode,name,description,category,brand,supplier_id,unit,price_cents,cost_cents,min_stock_milli,active,tax_rate_bps) ON products TO modulab_app',
  );
  await db.query(
    'GRANT UPDATE(name,address,tax_id,timezone,allow_negative_stock,paper_width,next_sale_number,currency,tax_rate_bps,receipt_footer,session_idle_minutes) ON tenants TO modulab_app',
  );
  await db.query(
    'GRANT UPDATE(sku,barcode,name,description,category,brand,supplier_id,unit,price_cents,cost_cents,min_stock_milli,active,updated_at,tax_rate_bps) ON products TO modulab_app',
  );
  await db.query(
    'GRANT UPDATE ON customers,suppliers,cash_shifts,purchases,users TO modulab_app; GRANT UPDATE(last_active_at) ON sessions TO modulab_app; GRANT DELETE ON sessions,held_sales TO modulab_app',
  );
  await db.query(
    'GRANT EXECUTE ON FUNCTION auth_lookup(text,text),session_lookup(text),login_gate(text) TO modulab_app',
  );
  console.log('Migraciones y permisos listos.');
} finally {
  await db.end();
}
