import { buildApp } from './app.js';
import { config } from './lib/config.js';
import { assertDatabaseRole, pool } from './lib/db.js';
await assertDatabaseRole();
const app = await buildApp();
await app.listen({ host: config.HOST, port: config.PORT });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void app
      .close()
      .then(() => pool.end())
      .catch((err) => {
        console.error(err);
        process.exitCode = 1;
      });
  });
