import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, access, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { createTenant } from './create-tenant.js';

const root = resolve('.');
const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const run = (command: string, args: string[], env = process.env) =>
  new Promise<void>((done, fail) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`${command} terminó con código ${code}`)),
    );
  });
if (Number(process.versions.node.split('.')[0]) !== 24)
  throw new Error('La instalación requiere Node.js 24 LTS.');
await mkdir('.local', { recursive: true, mode: 0o700 });
await chmod('.local', 0o700);
let managed = false;
if (!(await exists('.env'))) {
  const port = Number(process.env.SETUP_PG_PORT ?? 55438);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('SETUP_PG_PORT inválido.');
  for (const binary of ['initdb', 'pg_ctl', 'pg_dump', 'pg_restore'])
    await run(binary, ['--version']);
  if (await exists('.local/pgdata'))
    throw new Error(
      'Ya hay datos PostgreSQL locales. Recuperá el .env original antes de continuar.',
    );
  const adminPassword = randomBytes(32).toString('hex');
  const appPassword = randomBytes(32).toString('hex');
  const ownerPassword = process.env.OWNER_PASSWORD ?? randomBytes(18).toString('base64url');
  const slug = process.env.SHOP_SLUG ?? 'mi-kiosco';
  const name = process.env.SHOP_NAME ?? 'Mi Kiosco';
  const email = process.env.OWNER_EMAIL ?? 'propietario@kiosco.local';
  const credentials = { slug, name, email, password: ownerPassword };
  const env = [
    '# managed-by-modulab-setup',
    `ADMIN_DATABASE_URL=postgresql://modulab_admin:${adminPassword}@127.0.0.1:${port}/modulab`,
    `DATABASE_URL=postgresql://modulab_app:${appPassword}@127.0.0.1:${port}/modulab`,
    `APP_DATABASE_PASSWORD=${appPassword}`,
    `SESSION_SECRET=${randomBytes(32).toString('hex')}`,
    'APP_ORIGIN=http://localhost:3001',
    'HOST=127.0.0.1',
    'PORT=3001',
    'NODE_ENV=production',
    `SEED_PASSWORD=${randomBytes(20).toString('hex')}`,
    'PAYMENT_PROVIDER=manual',
    'FISCAL_PROVIDER=commercial',
    '',
  ].join('\n');
  await writeFile('.local/pg-init-password', adminPassword, { mode: 0o600 });
  try {
    await run('initdb', [
      '-D',
      '.local/pgdata',
      '-U',
      'modulab_admin',
      '--pwfile=.local/pg-init-password',
      '--auth-host=scram-sha-256',
      '--auth-local=scram-sha-256',
      '--encoding=UTF8',
    ]);
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm('.local/pg-init-password', { force: true });
  }
  await mkdir('.local/pgsocket', { mode: 0o700 });
  await writeFile(
    '.local/pgdata/postgresql.auto.conf',
    `listen_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${resolve('.local/pgsocket').replaceAll("'", "''")}'\n`,
  );
  await writeFile('.local/installation.json', JSON.stringify(credentials, null, 2), {
    mode: 0o600,
  });
  await writeFile('.env', env, { mode: 0o600, flag: 'wx' });
  managed = true;
}
loadEnvFile('.env');
managed ||= (await readFile('.env', 'utf8')).includes('# managed-by-modulab-setup');
if (managed) {
  const status = await new Promise<boolean>((done, fail) => {
    const child = spawn('pg_ctl', ['-D', '.local/pgdata', 'status'], { stdio: 'ignore' });
    child.on('error', fail);
    child.on('exit', (code) => done(code === 0));
  });
  if (!status) await run('pg_ctl', ['-D', '.local/pgdata', '-l', '.local/postgres.log', 'start']);
  const adminUrl = new URL(process.env.ADMIN_DATABASE_URL!);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='modulab'")).rowCount)
      await admin.query('CREATE DATABASE modulab');
  } finally {
    await admin.end();
  }
}
await run('npm', ['run', 'db:migrate']);
if (process.argv.includes('--demo')) {
  await run('npm', ['run', 'db:seed'], { ...process.env, NODE_ENV: 'development' });
} else if (managed) {
  const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await db.connect();
  try {
    const credentials = JSON.parse(await readFile('.local/installation.json', 'utf8'));
    if (!(await db.query('SELECT 1 FROM tenants WHERE slug=$1', [credentials.slug])).rowCount)
      await createTenant(db, credentials);
  } finally {
    await db.end();
  }
}
await run('npm', ['run', 'build']);
console.log(`Instalación preparada en ${root}. Ejecutá npm run kiosk:start.`);
if (process.argv.includes('--demo'))
  console.log('Demo: modulab / admin@modulab.local. Contraseña: SEED_PASSWORD del .env privado.');
else if (managed)
  console.log(
    'Credenciales locales: .local/installation.json (modo 600). No se muestran contraseñas en consola.',
  );
else
  console.log(
    'Se respetó .env y no se creó un comercio. Usá tenant:create si necesitás dar uno de alta.',
  );
