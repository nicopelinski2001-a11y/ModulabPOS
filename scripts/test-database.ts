import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
export const run = (args: string[], env: NodeJS.ProcessEnv) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Proceso finalizó con ${code}`)),
    );
  });
export async function withTestDatabase(fn: (env: NodeJS.ProcessEnv) => Promise<void>) {
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  if (!adminUrl || !process.env.APP_DATABASE_PASSWORD || !process.env.DATABASE_URL)
    throw new Error(
      'Definí ADMIN_DATABASE_URL, DATABASE_URL y APP_DATABASE_PASSWORD. Se creará y eliminará únicamente una base temporal de tests.',
    );
  const name = `modulab_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const runtimeUrl = new URL(process.env.DATABASE_URL);
  runtimeUrl.pathname = `/${name}`;
  const env = {
    ...process.env,
    ADMIN_DATABASE_URL: url.toString(),
    DATABASE_URL: runtimeUrl.toString(),
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://localhost:5173',
    SESSION_SECRET: process.env.SESSION_SECRET ?? randomUUID().repeat(2),
  };
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    await run(['node_modules/tsx/dist/cli.mjs', 'scripts/migrate.ts'], env);
    await fn(env);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
}
