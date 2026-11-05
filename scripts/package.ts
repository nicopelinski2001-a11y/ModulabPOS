import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function run(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command}: ${code}`))));
  });
}
await run('npm', ['run', 'check']);
await run('npm', ['run', 'build']);
await mkdir('releases', { recursive: true });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const filename = `releases/modulab-pos-${version}.tar.gz`;
// Explicit allowlist: never package credentials, databases, backups or browser data.
await run('tar', [
  '-czf',
  filename,
  'dist',
  'src',
  'db',
  'scripts',
  'public',
  'docs',
  'tests',
  'README.md',
  'package.json',
  'package-lock.json',
  '.env.example',
  '.env.docker.example',
  'Dockerfile',
  '.dockerignore',
  'compose.yaml',
  'Caddyfile',
  'index.html',
  'tsconfig.json',
  'tsconfig.server.json',
  'vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'eslint.config.js',
  '.prettierrc.json',
  '.prettierignore',
  '.gitignore',
]);
const hash = createHash('sha256')
  .update(await readFile(filename))
  .digest('hex');
await writeFile(`${filename}.sha256`, `${hash}  ${filename.split('/').pop()}\n`);
console.log(`Paquete creado: ${filename}. Instalar con npm ci && npm run setup.`);
