import { loadEnvFile } from 'node:process';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
loadEnvFile('.env');
if ((await readFile('.env', 'utf8')).includes('# managed-by-modulab-setup')) {
  const status = await new Promise((done, fail) => {
    const child = spawn('pg_ctl', ['-D', '.local/pgdata', 'status'], { stdio: 'ignore' });
    child.on('error', fail);
    child.on('exit', done);
  });
  if (status !== 0)
    await new Promise((done, fail) => {
      const child = spawn('pg_ctl', ['-D', '.local/pgdata', '-l', '.local/postgres.log', 'start'], {
        stdio: 'inherit',
      });
      child.on('error', fail);
      child.on('exit', (code) =>
        code === 0 ? done() : fail(new Error('No se pudo iniciar PostgreSQL')),
      );
    });
}
await import('../dist/server/server/index.js');
