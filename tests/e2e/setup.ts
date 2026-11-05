import pg from 'pg';
import { createTenant } from '../../scripts/create-tenant';
export default async function setup() {
  if (!process.env.ADMIN_DATABASE_URL?.includes('modulab_test_'))
    throw new Error('E2E sólo se ejecuta en la base temporal. Usá npm run test:e2e.');
  const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await db.connect();
  try {
    await createTenant(db, {
      slug: 'e2e-comercio',
      name: 'Comercio de pruebas',
      email: 'e2e@test.local',
      password: 'E2E-Test-Password-2026',
    });
    await createTenant(db, {
      slug: 'e2e-operations',
      name: 'Kiosco integral',
      email: 'operations@test.local',
      password: 'E2E-Test-Password-2026',
    });
  } finally {
    await db.end();
  }
}
