import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// A completely separate installation: no workspace .env, database or credentials.
const engine = process.env.CONTAINER_ENGINE ?? 'docker';
if (!['docker', 'podman'].includes(engine)) throw new Error('CONTAINER_ENGINE: docker o podman');
const port = Number(process.env.CONTAINER_SMOKE_PORT ?? '3181');
assert(Number.isInteger(port) && port > 1024 && port < 65536);
const runFile = promisify(execFile);
const run = async (...args: string[]) => {
  const result = await runFile(engine, args, { maxBuffer: 8 * 1024 * 1024 });
  return result.stdout.trim();
};
const prefix = `modulab-smoke-${randomBytes(5).toString('hex')}`;
const directory = await mkdtemp(join(tmpdir(), `${prefix}-`));
const envfile = join(directory, 'installation.env');
const adminPassword = randomBytes(32).toString('hex');
const appPassword = randomBytes(32).toString('hex');
const ownerPassword = randomBytes(24).toString('hex');
const network = `${prefix}-network`;
const database = `${prefix}-db`;
const application = `${prefix}-app`;
const tooling = 'localhost/modulab-pos-smoke-tooling:latest';
const runtime = 'localhost/modulab-pos-smoke-runtime:latest';
await writeFile(
  envfile,
  [
    `POSTGRES_USER=modulab_admin`,
    `POSTGRES_DB=modulab`,
    `POSTGRES_PASSWORD=${adminPassword}`,
    `ADMIN_DATABASE_URL=postgresql://modulab_admin:${adminPassword}@db:5432/modulab`,
    `DATABASE_URL=postgresql://modulab_app:${appPassword}@db:5432/modulab`,
    `APP_DATABASE_PASSWORD=${appPassword}`,
    `SESSION_SECRET=${randomBytes(32).toString('hex')}`,
    `OWNER_PASSWORD=${ownerPassword}`,
    `APP_ORIGIN=https://pos.test`,
    `NODE_ENV=production`,
    `HOST=0.0.0.0`,
    `PORT=3001`,
  ].join('\n'),
  { mode: 0o600 },
);
async function waitFor(check: () => Promise<unknown>, name: string) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      await check();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`No inició ${name}`);
}
try {
  console.log(`Construyendo imágenes finales con ${engine}…`);
  await run(
    'build',
    ...(engine === 'podman' ? ['--format', 'docker'] : []),
    '--target',
    'tooling',
    '-t',
    tooling,
    '.',
  );
  const build = [
    'build',
    ...(engine === 'podman' ? ['--format', 'docker'] : []),
    '--target',
    'runtime',
    '-t',
    runtime,
    '.',
  ];
  await run(...build);
  await run('network', 'create', '--internal', network);
  await run(
    'run',
    '-d',
    '--name',
    database,
    '--network',
    network,
    '--network-alias',
    'db',
    '--env-file',
    envfile,
    'docker.io/library/postgres:18-bookworm',
  );
  await waitFor(
    () =>
      run(
        'exec',
        database,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'modulab_admin',
        '-d',
        'modulab',
      ),
    'PostgreSQL',
  );
  const tool = (...args: string[]) =>
    run('run', '--rm', '--network', network, '--env-file', envfile, tooling, ...args);
  await tool('scripts/migrate.ts');
  await tool('scripts/migrate.ts');
  await tool('scripts/create-tenant.ts', 'smoke-kiosco', 'Kiosco de prueba', 'owner@test.local');
  // Runtime gets only runtime credentials, never the administrator URL.
  const runtimeEnv = join(directory, 'runtime.env');
  await writeFile(
    runtimeEnv,
    [
      `DATABASE_URL=postgresql://modulab_app:${appPassword}@db:5432/modulab`,
      `SESSION_SECRET=${randomBytes(32).toString('hex')}`,
      'APP_ORIGIN=https://pos.test',
      'NODE_ENV=production',
      'HOST=0.0.0.0',
      'PORT=3001',
    ].join('\n'),
    { mode: 0o600 },
  );
  await run(
    'run',
    '-d',
    '--name',
    application,
    '--network',
    network,
    '--env-file',
    runtimeEnv,
    '-p',
    `127.0.0.1:${port}:3001`,
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    runtime,
  );
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(
    async () => assert.equal((await fetch(`${origin}/api/health`)).status, 200),
    'aplicación',
  );
  assert.match(await (await fetch(origin)).text(), /<html/);
  let cookie = '',
    csrf = '';
  const call = async (path: string, body?: unknown) => {
    const res = await fetch(`${origin}/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        origin: 'https://pos.test',
        'content-type': 'application/json',
        'x-requested-with': 'ModulabPOS',
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(res.status, 200, `${path}: ${res.status}`);
    if (res.headers.has('set-cookie')) cookie = res.headers.get('set-cookie')!.split(';')[0];
    return res;
  };
  await call('/auth/login', {
    tenant: 'smoke-kiosco',
    email: 'owner@test.local',
    password: ownerPassword,
  });
  csrf = (await (await call('/auth/me')).json()).csrf;
  const product = await (
    await call('/products', {
      sku: 'SMOKE',
      name: 'Producto',
      price_cents: 12100,
      tax_rate_bps: 2100,
      initial_stock_milli: 10000,
    })
  ).json();
  const registers = await (await call('/cash/registers')).json();
  const shift = await (
    await call('/cash/open', {
      register_id: registers[0].id,
      opening_cents: 100000,
      idempotency_key: randomUUID(),
    })
  ).json();
  let cashSale = '';
  for (const method of ['cash', 'debit', 'credit', 'wallet', 'transfer']) {
    const intent = {
      idempotency_key: randomUUID(),
      shift_id: shift.id,
      items: [{ product_id: product.id, qty_milli: 1000 }],
      payments: [
        {
          method,
          amount_cents: 12100,
          tendered_cents: method === 'cash' ? 20000 : 12100,
          status: 'manual',
        },
      ],
    };
    const sale = await (await call('/sales', intent)).json();
    assert.equal(sale.operation_key, intent.idempotency_key);
    assert.equal((await (await call('/sales', intent)).json()).id, sale.id);
    if (method === 'cash') cashSale = sale.id;
  }
  const mixed = await (
    await call('/sales', {
      idempotency_key: randomUUID(),
      shift_id: shift.id,
      items: [{ product_id: product.id, qty_milli: 1000 }],
      payments: [
        { method: 'cash', amount_cents: 2100, tendered_cents: 2100 },
        { method: 'transfer', amount_cents: 10000, tendered_cents: 10000 },
      ],
    })
  ).json();
  const pdf = Buffer.from(await (await call(`/sales/${mixed.id}/ticket.pdf`)).arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  await call(`/sales/${cashSale}/return`, { shift_id: shift.id, reason: 'Devolución de prueba' });
  assert.equal((await (await call(`/products/${product.id}`)).json()).stock_milli, 5000);
  const closed = await (
    await call('/cash/close', {
      shift_id: shift.id,
      counted_cents: 102000,
      reason: 'Cierre de prueba',
    })
  ).json();
  assert.equal(closed.expected_cents, 102100);
  const report = await (await call('/reports')).json();
  assert.equal(report.totals.net_cents, 60500);
  for (const path of ['/reports?format=pdf', `/cash/shifts/${shift.id}/report?format=pdf`])
    assert.equal(
      Buffer.from(await (await call(path)).arrayBuffer())
        .subarray(0, 5)
        .toString(),
      '%PDF-',
    );
  assert.match(await (await call('/reports?format=csv')).text(), /Impuestos incluidos/);
  await run(
    'exec',
    '--env',
    'BACKUP_DIR=/tmp/smoke-backup',
    database,
    'bash',
    '-c',
    'export PGHOST=127.0.0.1 PGUSER="$POSTGRES_USER" PGDATABASE="$POSTGRES_DB" PGPASSWORD="$POSTGRES_PASSWORD"; pg_dump -Fc -f /tmp/smoke.dump; createdb smoke_restore; pg_restore --exit-on-error --single-transaction --no-owner --no-acl -d smoke_restore /tmp/smoke.dump',
  );
  console.log(
    'Contenedores: migración repetible, login, cinco medios, mixto, reintento, ticket, devolución, stock, cierre, reportes y backup/restauración APROBADOS.',
  );
  console.log(
    'Runtime sin root, filesystem de sólo lectura y red interna. HTTPS del proxy y hardware se verifican en destino.',
  );
} finally {
  await run('rm', '-f', '-v', application, database).catch(() => {});
  await run('network', 'rm', network).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
