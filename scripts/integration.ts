import { withTestDatabase, run } from './test-database.js';
await withTestDatabase((env) =>
  run(
    ['node_modules/vitest/vitest.mjs', 'run', '--config', 'tests/integration/vitest.config.ts'],
    env,
  ),
);
