import { spawn } from 'node:child_process';
if (!process.env.ADMIN_DATABASE_URL)
  throw new Error('Definí ADMIN_DATABASE_URL para realizar la copia completa.');
const url = new URL(process.env.ADMIN_DATABASE_URL);
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: url.pathname.slice(1),
  PGSSLMODE: url.searchParams.get('sslmode') ?? process.env.PGSSLMODE,
};
const child = spawn('bash', ['scripts/backup.sh'], { env, stdio: 'inherit' });
child.on('error', (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
