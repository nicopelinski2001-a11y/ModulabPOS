import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
const root = resolve('.');
const quote = (value: string) =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
const directory = process.argv.includes('--preview')
  ? resolve('.local/service-preview')
  : resolve(homedir(), '.config/systemd/user');
await mkdir(directory, { recursive: true, mode: 0o700 });
await mkdir('backups', { recursive: true, mode: 0o700 });
const service = (description: string, command: string, extra: string) => `[Unit]
Description=${description}
After=network.target
[Service]
WorkingDirectory=${quote(root)}
Environment=${quote(`PATH=${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`)}
ExecStart=${quote(process.execPath)} ${command}
UMask=0077
NoNewPrivileges=true
${extra}
`;
await writeFile(
  resolve(directory, 'modulab-pos.service'),
  service(
    'Modulab POS',
    'scripts/kiosk-start.mjs',
    'Restart=on-failure\nRestartSec=5\n[Install]\nWantedBy=default.target',
  ),
  { mode: 0o600 },
);
await writeFile(
  resolve(directory, 'modulab-backup.service'),
  service(
    'Backup de Modulab POS',
    '--env-file=.env --import tsx scripts/backup.ts',
    'Type=oneshot',
  ),
  { mode: 0o600 },
);
await writeFile(
  resolve(directory, 'modulab-backup.timer'),
  `[Unit]
Description=Backup diario de Modulab POS
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
`,
  { mode: 0o600 },
);
if (!process.argv.includes('--preview')) {
  for (const args of [
    ['--user', 'daemon-reload'],
    ['--user', 'enable', '--now', 'modulab-pos.service', 'modulab-backup.timer'],
  ]) {
    await new Promise<void>((done, fail) => {
      const child = spawn('systemctl', args, { stdio: 'inherit' });
      child.on('error', fail);
      child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`systemctl: ${code}`))));
    });
  }
}
console.log(
  `Unidades creadas en ${directory}. Para arrancar sin login, el administrador del host puede habilitar loginctl enable-linger para el usuario del kiosco.`,
);
