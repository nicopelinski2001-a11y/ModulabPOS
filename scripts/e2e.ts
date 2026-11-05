import { withTestDatabase, run } from './test-database.js';
await withTestDatabase((env) =>
  run(['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], {
    ...env,
    PORT: '3041',
    APP_ORIGIN: 'http://localhost:5179',
    VITE_PORT: '5179',
    API_PROXY: 'http://127.0.0.1:3041',
  }),
);
