import pg from 'pg';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { run } from './test-database.js';
const file = process.argv[2];
if (!file || !process.env.ADMIN_DATABASE_URL)
  throw new Error('Uso: npm run backup:verify -- backups/archivo.dump');
await access(file);
const expectedHash = (await readFile(`${file}.sha256`, 'utf8')).split(/\s/)[0];
if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash))
  throw new Error('Checksum SHA256 faltante o inválido.');
const hash = createHash('sha256');
for await (const chunk of createReadStream(file)) hash.update(chunk);
if (hash.digest('hex') !== expectedHash)
  throw new Error('El backup no coincide con su checksum SHA256. No se restauró.');
const sourceUrl = new URL(process.env.ADMIN_DATABASE_URL);
const name = `modulab_restore_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: sourceUrl.toString() });
await admin.connect();
const targetUrl = new URL(sourceUrl);
targetUrl.pathname = `/${name}`;
const runtimeUrl = new URL(process.env.DATABASE_URL!);
runtimeUrl.pathname = `/${name}`;
const env = {
  ...process.env,
  PGHOST: sourceUrl.hostname,
  PGPORT: sourceUrl.port || '5432',
  PGUSER: decodeURIComponent(sourceUrl.username),
  PGPASSWORD: decodeURIComponent(sourceUrl.password),
  PGDATABASE: name,
  PGSSLMODE: sourceUrl.searchParams.get('sslmode') ?? process.env.PGSSLMODE,
};
try {
  await admin.query(`CREATE DATABASE ${name}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'pg_restore',
      ['--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '--dbname', name, file],
      { env, stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pg_restore: ${code}`))));
  });
  await run(['node_modules/tsx/dist/cli.mjs', 'scripts/migrate.ts'], {
    ...process.env,
    ADMIN_DATABASE_URL: targetUrl.toString(),
    DATABASE_URL: runtimeUrl.toString(),
  });
  const restored = new pg.Client({ connectionString: targetUrl.toString() });
  await restored.connect();
  try {
    const {
      rows: [result],
    } = await restored.query(
      'SELECT (SELECT count(*)::int FROM tenants) AS tenants,(SELECT count(*)::int FROM products) AS products,(SELECT count(*)::int FROM sales) AS sales,(SELECT count(*)::int FROM products p WHERE p.stock_milli<>coalesce((SELECT sum(m.qty_milli) FROM inventory_movements m WHERE m.tenant_id=p.tenant_id AND m.product_id=p.id),0)) AS inconsistent_stock',
    );
    if (result.inconsistent_stock !== 0)
      throw new Error('El stock restaurado no coincide con el libro de movimientos.');
    const runtime = new pg.Client({ connectionString: runtimeUrl.toString() });
    await runtime.connect();
    try {
      if ((await runtime.query('SELECT id FROM products')).rows.length)
        throw new Error('RLS no aisló el contexto vacío.');
    } finally {
      await runtime.end();
    }
    console.log('Restauración verificada en una base temporal:', result);
  } finally {
    await restored.end();
  }
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}
