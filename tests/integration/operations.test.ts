import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTenant } from '../../scripts/create-tenant';
import { buildApp } from '../../src/server/app';
import { pool, assertDatabaseRole, transaction } from '../../src/server/lib/db';
import { hashPassword } from '../../src/server/lib/password';
import type { FastifyInstance } from 'fastify';
let app: FastifyInstance;
let admin: pg.Client;
type Actor = { cookie: string; csrf: string; user_id: string; tenant_id: string };
let owner: Actor;
let other: Actor;
let cashier: Actor;
let stock: Actor;
let second: Actor;
let shiftId: string;
let secondShiftId: string;
let productId: string;
const password = 'Testing-Secure-Password-2026';
const headers = (a: Actor) => ({
  cookie: a.cookie,
  origin: 'http://localhost:5173',
  'x-requested-with': 'ModulabPOS',
  'x-csrf-token': a.csrf,
});
async function login(tenant: string, email: string): Promise<Actor> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: 'http://localhost:5173', 'x-requested-with': 'ModulabPOS' },
    payload: { tenant, email, password },
  });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = res.headers['set-cookie']!.toString().split(';')[0]!;
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  expect(me.statusCode).toBe(200);
  return { cookie, csrf: me.json().csrf, ...me.json().user };
}
const post = (a: Actor, url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: headers(a), payload });
const get = (a: Actor, url: string) => app.inject({ method: 'GET', url, headers: headers(a) });
const makeProduct = async (
  actor: Actor,
  sku: string,
  stock = 10000,
  price = 10000,
  unit = 'unit',
) => {
  const r = await post(actor, '/api/products', {
    sku,
    name: sku,
    price_cents: price,
    cost_cents: 5000,
    initial_stock_milli: stock,
    unit,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
};
const saleBody = (product = productId, shift = shiftId, amount = 10000) => ({
  idempotency_key: randomUUID(),
  shift_id: shift,
  items: [{ product_id: product, qty_milli: 1000 }],
  payments: [{ method: 'cash', amount_cents: amount, tendered_cents: amount, status: 'manual' }],
});
beforeAll(async () => {
  admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await admin.connect();
  await createTenant(admin, {
    slug: 'comercio-a',
    name: 'Comercio A',
    email: 'owner-a@test.local',
    password,
  });
  await createTenant(admin, {
    slug: 'comercio-b',
    name: 'Comercio B',
    email: 'owner-b@test.local',
    password,
  });
  await assertDatabaseRole();
  app = await buildApp(false);
  owner = await login('comercio-a', 'owner-a@test.local');
  other = await login('comercio-b', 'owner-b@test.local');
  for (const [email, role] of [
    ['cash@test.local', 'cashier'],
    ['stock@test.local', 'stock'],
    ['second@test.local', 'cashier'],
  ]) {
    const res = await post(owner, '/api/users', { name: email, email, password, role });
    expect(res.statusCode, res.body).toBe(200);
  }
  cashier = await login('comercio-a', 'cash@test.local');
  stock = await login('comercio-a', 'stock@test.local');
  second = await login('comercio-a', 'second@test.local');
  const registers = (await get(owner, '/api/cash/registers')).json();
  shiftId = (
    await post(owner, '/api/cash/open', { register_id: registers[0].id, opening_cents: 100000 })
  ).json().id;
  secondShiftId = (
    await post(second, '/api/cash/open', { register_id: registers[1].id, opening_cents: 0 })
  ).json().id;
  productId = (await makeProduct(owner, 'BASE', 20000)).id;
});
afterAll(async () => {
  await app?.close();
  await pool.end();
  await admin?.end();
});
describe('Aislamiento y autorización', () => {
  it('impide lectura y modificación de productos de otro comercio', async () => {
    expect((await get(other, `/api/products/${productId}`)).statusCode).toBe(404);
    const p = (await get(owner, `/api/products/${productId}`)).json();
    const { id, tenant_id, stock_milli, created_at, updated_at, ...fields } = p;
    const r = await app.inject({
      method: 'PUT',
      url: `/api/products/${productId}`,
      headers: headers(other),
      payload: fields,
    });
    expect(r.statusCode).toBe(404);
  });
  it('niega acceso SQL sin contexto y protege referencias cruzadas', async () => {
    expect((await pool.query('SELECT * FROM products')).rows).toHaveLength(0);
    await expect(
      transaction(other.tenant_id, other.user_id, (db) =>
        db.query(
          "INSERT INTO inventory_movements(tenant_id,product_id,user_id,qty_milli,kind,reason) VALUES($1,$2,$3,1000,'adjustment','ataque')",
          [other.tenant_id, productId, other.user_id],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      pool.query("SELECT * FROM users WHERE email='owner-a@test.local'"),
    ).rejects.toThrow();
  });
  it('aplica permisos aunque se manipule HTTP', async () => {
    expect(
      (await post(cashier, '/api/products', { sku: 'ATTACK', name: 'ATTACK', price_cents: 100 }))
        .statusCode,
    ).toBe(403);
    expect((await post(stock, '/api/sales', saleBody())).statusCode).toBe(403);
    expect(
      (
        await post(cashier, '/api/users', {
          name: 'Admin',
          email: 'a@test.local',
          password,
          role: 'owner',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await post(cashier, '/api/sales', { ...saleBody(), discount_cents: 100 })).statusCode,
    ).toBe(403);
  });
  it('rechaza CSRF, origen ajeno y sesión ausente', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/cash/open',
          headers: { ...headers(owner), 'x-csrf-token': 'bad' },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin: 'https://evil.example', 'x-requested-with': 'ModulabPOS' },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/products' })).statusCode).toBe(401);
  });
  it('oculta costos al cajero', async () => {
    expect((await get(cashier, `/api/products/${productId}`)).json()).not.toHaveProperty(
      'cost_cents',
    );
    expect((await get(cashier, '/api/products')).json().items[0]).not.toHaveProperty('cost_cents');
  });
  it('no permite operar sobre un turno de otro empleado', async () => {
    expect((await post(cashier, '/api/sales', saleBody())).statusCode).toBe(403);
  });
});
describe('Atomicidad, concurrencia e idempotencia de venta', () => {
  it('confirma una sola venta bajo diez reintentos simultáneos', async () => {
    const b = saleBody();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => post(owner, '/api/sales', b)),
    );
    for (const r of results) expect(r.statusCode, r.body).toBe(200);
    expect(new Set(results.map((r) => r.json().id)).size).toBe(1);
    expect((await get(owner, `/api/products/${productId}`)).json().stock_milli).toBe(19000);
    const id = results[0]!.json().id;
    const totals = await transaction(owner.tenant_id, owner.user_id, async (db) => ({
      sales: (await db.query('SELECT count(*)::int AS n FROM sales WHERE id=$1', [id])).rows[0].n,
      stock: (
        await db.query('SELECT count(*)::int AS n FROM inventory_movements WHERE reference_id=$1', [
          id,
        ])
      ).rows[0].n,
      cash: (
        await db.query('SELECT count(*)::int AS n FROM cash_movements WHERE reference_id=$1', [id])
      ).rows[0].n,
    }));
    expect(totals).toEqual({ sales: 1, stock: 1, cash: 1 });
    expect((await get(other, `/api/sales/${id}`)).statusCode).toBe(404);
    const changed = structuredClone(b);
    changed.items[0]!.qty_milli = 2000;
    expect((await post(owner, '/api/sales', changed)).statusCode).toBe(409);
  });
  it('evita vender dos veces la última unidad desde cajas diferentes', async () => {
    const p = await makeProduct(owner, 'LAST', 1000);
    const results = await Promise.all([
      post(owner, '/api/sales', saleBody(p.id)),
      post(second, '/api/sales', saleBody(p.id, secondShiftId)),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await get(owner, `/api/products/${p.id}`)).json().stock_milli).toBe(0);
  });
  it('revierte venta, pagos, numeración y movimientos cuando falla stock', async () => {
    const p = await makeProduct(owner, 'EMPTY', 0);
    const before = (await get(owner, '/api/sales')).json().length;
    const b = saleBody(p.id);
    const r = await post(owner, '/api/sales', b);
    expect(r.statusCode, r.body).toBe(409);
    expect((await get(owner, '/api/sales')).json()).toHaveLength(before);
    const rows = await transaction(owner.tenant_id, owner.user_id, (db) =>
      db.query('SELECT id FROM sales WHERE idempotency_key=$1', [b.idempotency_key]),
    );
    expect(rows.rowCount).toBe(0);
  });
  it('valida cantidades por unidad, duplicados, importes y estados de pago', async () => {
    const fractional = saleBody();
    fractional.items[0]!.qty_milli = 500;
    expect((await post(owner, '/api/sales', fractional)).statusCode).toBe(400);
    const duplicate = saleBody();
    duplicate.items.push({ ...duplicate.items[0]! });
    expect((await post(owner, '/api/sales', duplicate)).statusCode).toBe(400);
    const mismatch = saleBody();
    mismatch.payments[0]!.amount_cents = 1;
    expect((await post(owner, '/api/sales', mismatch)).statusCode).toBe(409);
    const forged = saleBody();
    forged.payments[0]!.status = 'verified';
    expect((await post(owner, '/api/sales', forged)).statusCode).toBe(400);
  });
  it('registra pagos mixtos y sólo suma efectivo aplicado al turno', async () => {
    const before = (await get(owner, '/api/cash/shifts'))
      .json()
      .find((s: { id: string }) => s.id === shiftId).expected_cents;
    const b = {
      ...saleBody(),
      payments: [
        { method: 'cash', amount_cents: 4000, tendered_cents: 5000, status: 'manual' },
        { method: 'transfer', amount_cents: 6000, tendered_cents: 6000, status: 'pending' },
      ],
    };
    const r = await post(owner, '/api/sales', b);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().change_cents).toBe(1000);
    expect(
      (await get(owner, '/api/cash/shifts')).json().find((s: { id: string }) => s.id === shiftId)
        .expected_cents,
    ).toBe(before + 4000);
  });
  it('devuelve una vez, repone stock y crea movimientos compensatorios', async () => {
    const p = await makeProduct(owner, 'RETURN', 1000);
    const sale = (await post(owner, '/api/sales', saleBody(p.id))).json();
    const body = { shift_id: shiftId, reason: 'Devolución de prueba' };
    const [a, b] = await Promise.all([
      post(owner, `/api/sales/${sale.id}/return`, body),
      post(owner, `/api/sales/${sale.id}/return`, body),
    ]);
    expect(a.statusCode, a.body).toBe(200);
    expect(b.statusCode, b.body).toBe(200);
    expect(a.json().returned).toBe(true);
    expect((await get(owner, `/api/products/${p.id}`)).json().stock_milli).toBe(1000);
    await expect(
      transaction(owner.tenant_id, owner.user_id, (db) =>
        db.query('UPDATE sales SET total_cents=1 WHERE id=$1', [sale.id]),
      ),
    ).rejects.toThrow();
    await expect(
      admin.query('DELETE FROM inventory_movements WHERE product_id=$1', [p.id]),
    ).rejects.toThrow();
  });
});
describe('Operación de kiosco completa', () => {
  it('vende con cada medio, devuelve y exporta reportes reales', async () => {
    const p = await makeProduct(owner, 'ALL-PAYMENTS', 20000, 12100);
    const initial = (await get(owner, '/api/reports')).json().totals.net_cents;
    const ids: string[] = [];
    for (const method of ['cash', 'debit', 'credit', 'wallet', 'transfer']) {
      const b = {
        ...saleBody(p.id, shiftId, 12100),
        payments: [
          {
            method,
            amount_cents: 12100,
            tendered_cents: method === 'cash' ? 12500 : 12100,
            status: 'manual',
          },
        ],
      };
      const r = await post(owner, '/api/sales', b);
      expect(r.statusCode, r.body).toBe(200);
      ids.push(r.json().id);
    }
    const mixed = {
      ...saleBody(p.id, shiftId, 12100),
      payments: [
        { method: 'cash', amount_cents: 2100, tendered_cents: 3000, status: 'manual' },
        { method: 'transfer', amount_cents: 10000, tendered_cents: 10000, status: 'manual' },
      ],
    };
    const result = await post(owner, '/api/sales', mixed);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().change_cents).toBe(900);
    expect(
      (
        await post(owner, `/api/sales/${ids[0]}/return`, {
          shift_id: shiftId,
          reason: 'Cliente devuelve producto',
        })
      ).statusCode,
    ).toBe(200);
    expect((await get(owner, `/api/products/${p.id}`)).json().stock_milli).toBe(15000);
    expect((await get(owner, '/api/reports')).json().totals.net_cents - initial).toBe(5 * 12100);
    for (const path of [
      '/api/reports?format=pdf',
      `/api/cash/shifts/${shiftId}/report?format=pdf`,
      `/api/sales/${ids[0]}/ticket.pdf`,
    ]) {
      const pdf = await get(owner, path);
      expect(pdf.statusCode, pdf.body).toBe(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.rawPayload.length).toBeGreaterThan(1000);
    }
    const csv = await get(owner, '/api/reports?format=csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('Ventas netas');
    expect(csv.body).toContain('Más vendidos');
    expect((await get(other, `/api/sales/${ids[0]}/ticket.pdf`)).statusCode).toBe(404);
    expect((await get(cashier, '/api/reports?format=pdf')).statusCode).toBe(403);
    expect((await get(owner, '/api/reports?from=2026-11-05&to=2026-01-01')).statusCode).toBe(400);
  });
  it('conserva impuestos históricos y descuentos por línea', async () => {
    await admin.query('UPDATE tenants SET tax_rate_bps=2100 WHERE id=$1', [owner.tenant_id]);
    try {
      const a = await makeProduct(owner, 'TAX-21', 2000, 12100);
      const response = await post(owner, '/api/products', {
        sku: 'TAX-10',
        name: 'Tasa particular',
        price_cents: 11050,
        tax_rate_bps: 1050,
        initial_stock_milli: 1000,
      });
      expect(response.statusCode, response.body).toBe(200);
      const b = response.json();
      const sale = await post(owner, '/api/sales', {
        ...saleBody(a.id),
        discount_cents: 2315,
        items: [
          { product_id: a.id, qty_milli: 1000 },
          { product_id: b.id, qty_milli: 1000 },
        ],
        payments: [
          { method: 'debit', amount_cents: 20835, tendered_cents: 20835, status: 'manual' },
        ],
      });
      expect(sale.statusCode, sale.body).toBe(200);
      expect(sale.json()).toMatchObject({ total_cents: 20835, tax_cents: 2835 });
      expect(
        sale
          .json()
          .lines.reduce((n: number, l: { discount_cents: number }) => n + l.discount_cents, 0),
      ).toBe(2315);
      await admin.query('UPDATE tenants SET tax_rate_bps=0 WHERE id=$1', [owner.tenant_id]);
      const historical = (await get(owner, `/api/sales/${sale.json().id}`)).json();
      expect(historical.tax_cents).toBe(2835);
      expect(historical.receipt_settings.tax_rate_bps).toBe(2100);
    } finally {
      await admin.query('UPDATE tenants SET tax_rate_bps=0 WHERE id=$1', [owner.tenant_id]);
    }
  });
  it('concilia pagos pendientes con evidencia e idempotencia sin modificar el libro original', async () => {
    const pendingSale = await post(owner, '/api/sales', {
      ...saleBody(),
      payments: [
        { method: 'wallet', amount_cents: 10000, tendered_cents: 10000, status: 'pending' },
      ],
    });
    expect(pendingSale.statusCode, pendingSale.body).toBe(200);
    const id = pendingSale.json().id;
    expect(pendingSale.json().payments[0].status).toBe('pending');
    const before = (await get(owner, '/api/reports'))
      .json()
      .payments.find((p: { method: string }) => p.method === 'wallet').pending_cents;
    expect(
      (
        await post(other, `/api/sales/${id}/confirm-payment`, {
          method: 'wallet',
          reference: 'Banco 123456',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await post(cashier, `/api/sales/${id}/confirm-payment`, {
          method: 'wallet',
          reference: 'Banco 123456',
        })
      ).statusCode,
    ).toBe(403);
    const requests = await Promise.all(
      Array.from({ length: 3 }, () =>
        post(owner, `/api/sales/${id}/confirm-payment`, {
          method: 'wallet',
          reference: 'Banco 123456',
        }),
      ),
    );
    requests.forEach((r) => expect(r.statusCode, r.body).toBe(200));
    expect(requests[0]!.json().payments[0].status).toBe('manual');
    expect(
      (
        await post(owner, `/api/sales/${id}/confirm-payment`, {
          method: 'wallet',
          reference: 'Otra referencia',
        })
      ).statusCode,
    ).toBe(409);
    const after = (await get(owner, '/api/reports'))
      .json()
      .payments.find((p: { method: string }) => p.method === 'wallet').pending_cents;
    expect(before - after).toBe(10000);
    expect(
      (await admin.query('SELECT status FROM sale_payments WHERE sale_id=$1', [id])).rows[0].status,
    ).toBe('pending');
  });
  it('impide retiros que exceden el efectivo y mantiene toda la transacción', async () => {
    const shifts = (await get(owner, '/api/cash/shifts')).json();
    const before = shifts.find((s: { id: string }) => s.id === shiftId).expected_cents;
    const r = await post(owner, '/api/cash/movement', {
      shift_id: shiftId,
      kind: 'out',
      amount_cents: before + 1,
      reason: 'Retiro que supera el saldo',
      idempotency_key: randomUUID(),
    });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().message).toContain('Efectivo insuficiente');
    expect(
      (await get(owner, '/api/cash/shifts')).json().find((s: { id: string }) => s.id === shiftId)
        .expected_cents,
    ).toBe(before);
  });
  it('expira sesiones inactivas en el servidor y renueva sólo por actividad explícita', async () => {
    const actor = await login('comercio-a', 'stock@test.local');
    await admin.query(
      "UPDATE sessions SET last_active_at=now()-interval '14 minutes' WHERE user_id=$1",
      [actor.user_id],
    );
    expect((await get(actor, '/api/products')).statusCode).toBe(200);
    const before = (
      await admin.query('SELECT last_active_at FROM sessions WHERE user_id=$1', [actor.user_id])
    ).rows[0].last_active_at;
    await get(actor, '/api/health');
    expect(
      (await admin.query('SELECT last_active_at FROM sessions WHERE user_id=$1', [actor.user_id]))
        .rows[0].last_active_at,
    ).toEqual(before);
    expect((await post(actor, '/api/auth/activity', {})).statusCode).toBe(200);
    await admin.query(
      "UPDATE sessions SET last_active_at=now()-interval '16 minutes' WHERE user_id=$1",
      [actor.user_id],
    );
    expect((await get(actor, '/api/products')).statusCode).toBe(401);
    expect((await post(actor, '/api/auth/activity', {})).statusCode).toBe(401);
  });
});
describe('Autenticación operativa y comprobantes', () => {
  it('el reset administrativo revoca sesiones y libera el bloqueo de intentos', async () => {
    const email = 'reset-access@test.local';
    expect(
      (
        await post(owner, '/api/users', {
          name: 'Acceso recuperado',
          email,
          password,
          role: 'cashier',
        })
      ).statusCode,
    ).toBe(200);
    const actor = await login('comercio-a', email);
    const key = createHash('sha256').update(`comercio-a:${email}`).digest('hex');
    await pool.query('SELECT login_gate($1) FROM generate_series(1,10)', [key]);
    const signIn = (value: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: 'http://localhost:5173', 'x-requested-with': 'ModulabPOS' },
        payload: { tenant: 'comercio-a', email, password: value },
      });
    expect((await signIn(password)).statusCode).toBe(429);
    const replacement = 'Recovered-Access-Password-2026';
    await promisify(execFile)(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/reset-password.ts', 'comercio-a', email],
      { env: { ...process.env, NEW_PASSWORD: replacement } },
    );
    expect((await get(actor, '/api/products')).statusCode).toBe(401);
    expect((await signIn(password)).statusCode).toBe(401);
    expect((await signIn(replacement)).statusCode).toBe(200);
  });
  it('un reset simultáneo impide crear una sesión con la contraseña anterior', async () => {
    const created = await post(owner, '/api/users', {
      name: 'Acceso concurrente',
      email: 'race@test.local',
      password,
      role: 'cashier',
    });
    expect(created.statusCode).toBe(200);
    const hash = await hashPassword('A-New-Secure-Password-2026');
    await admin.query('BEGIN');
    let attempt;
    try {
      await admin.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [created.json().id]);
      attempt = app
        .inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin: 'http://localhost:5173', 'x-requested-with': 'ModulabPOS' },
          payload: { tenant: 'comercio-a', email: 'race@test.local', password },
        })
        .then((r) => r);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const state = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE usename='modulab_app' AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM users%FOR UPDATE'",
        );
        if (state.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(waiting).toBe(true);
      await admin.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, created.json().id]);
      await admin.query('COMMIT');
      expect((await attempt).statusCode).toBe(401);
    } finally {
      await admin.query('ROLLBACK');
      await attempt;
    }
  });
  it('admite reingresos legítimos sin acumular intentos fallidos', async () => {
    for (let i = 0; i < 12; i++) {
      const actor = await login('comercio-a', 'owner-a@test.local');
      expect((await post(actor, '/api/auth/logout', {})).statusCode).toBe(200);
    }
  });
  it('mantiene el bloqueo por intentos fallidos consecutivos de una cuenta', async () => {
    for (let i = 0; i < 11; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '127.0.0.11',
        headers: { origin: 'http://localhost:5173', 'x-requested-with': 'ModulabPOS' },
        payload: {
          tenant: 'comercio-b',
          email: 'unknown@test.local',
          password: 'incorrect-password',
        },
      });
      expect(response.statusCode, response.body).toBe(i < 10 ? 401 : 429);
    }
  });
  it('guarda caja/empleado en el ticket y preserva 58 mm tras cambiar la configuración', async () => {
    const p = await makeProduct(owner, 'PDF-SNAPSHOT', 2000, 12100);
    await transaction(owner.tenant_id, owner.user_id, (db) =>
      db.query('UPDATE tenants SET paper_width=58'),
    );
    const response = await post(owner, '/api/sales', saleBody(p.id, shiftId, 12100));
    expect(response.statusCode, response.body).toBe(200);
    const receipt = response.json();
    expect(receipt.operation_key).toBeTruthy();
    expect(receipt.receipt_settings.register_name).toBeTruthy();
    expect(receipt.receipt_settings.operator_name).toBeTruthy();
    await transaction(owner.tenant_id, owner.user_id, (db) =>
      db.query('UPDATE tenants SET paper_width=80'),
    );
    const pdf = await get(owner, `/api/sales/${receipt.id}/ticket.pdf`);
    expect(pdf.statusCode, pdf.body).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const box = pdf.rawPayload.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)/);
    expect(Number(box?.[1])).toBeCloseTo((58 * 72) / 25.4, 3);
  });
});
describe('Compras, cuentas y cierre', () => {
  it('no toca stock al comprar y recibe una sola vez ante concurrencia', async () => {
    const supplier = (await post(owner, '/api/suppliers', { name: 'Proveedor de prueba' })).json();
    const p = await makeProduct(owner, 'PURCHASE', 0);
    const r = await post(owner, '/api/purchases', {
      supplier_id: supplier.id,
      reference: 'F-123',
      items: [{ product_id: p.id, qty_milli: 3000, cost_cents: 3000 }],
    });
    expect(r.statusCode, r.body).toBe(200);
    expect((await get(owner, `/api/products/${p.id}`)).json().stock_milli).toBe(0);
    const received = await Promise.all([
      post(owner, `/api/purchases/${r.json().id}/receive`, {}),
      post(owner, `/api/purchases/${r.json().id}/receive`, {}),
    ]);
    received.forEach((x) => expect(x.statusCode, x.body).toBe(200));
    expect((await get(owner, `/api/products/${p.id}`)).json().stock_milli).toBe(3000);
    const payment = {
      amount_cents: 2000,
      method: 'cash',
      shift_id: shiftId,
      idempotency_key: randomUUID(),
    };
    const paid = await post(owner, `/api/purchases/${r.json().id}/payments`, payment);
    expect(paid.statusCode, paid.body).toBe(200);
    expect((await post(owner, `/api/purchases/${r.json().id}/payments`, payment)).json().id).toBe(
      paid.json().id,
    );
  });
  it('limita crédito y no duplica cobranzas concurrentes', async () => {
    const customer = (
      await post(owner, '/api/customers', { name: 'Cliente test', credit_limit_cents: 10000 })
    ).json();
    const b = {
      ...saleBody(),
      customer_id: customer.id,
      payments: [
        { method: 'account', amount_cents: 10000, tendered_cents: 10000, status: 'manual' },
      ],
    };
    expect((await post(owner, '/api/sales', b)).statusCode).toBe(200);
    expect(
      (await post(owner, '/api/sales', { ...b, idempotency_key: randomUUID() })).statusCode,
    ).toBe(409);
    const payment = {
      amount_cents: 7000,
      method: 'cash',
      shift_id: shiftId,
      idempotency_key: randomUUID(),
    };
    const results = await Promise.all([
      post(owner, `/api/customers/${customer.id}/payments`, payment),
      post(owner, `/api/customers/${customer.id}/payments`, payment),
    ]);
    expect(results[0]!.statusCode, results[0]!.body).toBe(200);
    expect(results[1]!.json().id).toBe(results[0]!.json().id);
    expect(
      (await get(owner, '/api/customers')).json().find((c: { id: string }) => c.id === customer.id)
        .balance_cents,
    ).toBe(3000);
  });
  it('importa todo o nada cuando encuentra un SKU duplicado', async () => {
    const r = await post(owner, '/api/products/import', {
      products: [
        { sku: 'NEW-IMPORT', name: 'Nuevo', price_cents: 10, initial_stock_milli: 1000 },
        { sku: 'BASE', name: 'Duplicado', price_cents: 10 },
      ],
    });
    expect(r.statusCode).toBe(409);
    expect((await get(owner, '/api/products?q=NEW-IMPORT')).json().total).toBe(0);
  });
  it('protege ajustes idempotentes y el saldo de stock contra edición directa', async () => {
    const b = {
      product_id: productId,
      qty_milli: -1000,
      reason: 'Ajuste prueba',
      idempotency_key: randomUUID(),
    };
    const before = (await get(owner, `/api/products/${productId}`)).json().stock_milli;
    expect((await post(owner, '/api/inventory/adjust', b)).statusCode).toBe(200);
    expect((await post(owner, '/api/inventory/adjust', b)).statusCode).toBe(200);
    expect((await get(owner, `/api/products/${productId}`)).json().stock_milli).toBe(before - 1000);
    await expect(
      transaction(owner.tenant_id, owner.user_id, (db) =>
        db.query('UPDATE products SET stock_milli=999 WHERE id=$1', [productId]),
      ),
    ).rejects.toThrow();
  });
  it('no duplica aumentos masivos cuando se reintenta la misma orden', async () => {
    const p = await makeProduct(owner, 'PRICE', 1000, 10000);
    const b = { category: 'General', increase_basis_points: 1000, idempotency_key: randomUUID() };
    const [a, c] = await Promise.all([
      post(owner, '/api/products/prices', b),
      post(owner, '/api/products/prices', b),
    ]);
    expect(a.statusCode, a.body).toBe(200);
    expect(c.statusCode, c.body).toBe(200);
    expect((await get(owner, `/api/products/${p.id}`)).json().price_cents).toBe(11000);
    expect(
      (await post(owner, '/api/products/prices', { ...b, increase_basis_points: 2000 })).statusCode,
    ).toBe(409);
  });
  it('rechaza asientos SQL parciales incluso al confirmar la transacción', async () => {
    await expect(
      transaction(owner.tenant_id, owner.user_id, (db) =>
        db.query(
          "INSERT INTO sales(tenant_id,number,shift_id,user_id,idempotency_key,request_hash,subtotal_cents,discount_cents,total_cents,change_cents,receipt_settings) VALUES($1,999999,$2,$3,$4,'bad',100,0,100,0,'{}')",
          [owner.tenant_id, shiftId, owner.user_id, randomUUID()],
        ),
      ),
    ).rejects.toThrow('Asiento de venta incompleto');
  });
  it('recupera conexiones inactivas cortadas por un reinicio sin caer el proceso', async () => {
    const connection = await pool.connect();
    const pid = (await connection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    connection.release();
    const disconnected = new Promise<void>((resolve) => pool.once('error', () => resolve()));
    await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    await disconnected;
    expect((await get(owner, '/api/reports')).statusCode).toBe(200);
  });
  it('concilia todos los saldos de stock contra el libro', async () => {
    const r = await transaction(owner.tenant_id, owner.user_id, (db) =>
      db.query(
        'SELECT p.id FROM products p WHERE p.stock_milli<>coalesce((SELECT sum(m.qty_milli) FROM inventory_movements m WHERE m.product_id=p.id),0)',
      ),
    );
    expect(r.rows).toHaveLength(0);
  });
  it('calcula reportes y bloquea ventas después del cierre', async () => {
    const report = await get(owner, '/api/reports');
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().totals.net_cents).toBeGreaterThan(0);
    expect(report.json().daily.length).toBeGreaterThan(0);
    const current = (await get(owner, '/api/cash/shifts'))
      .json()
      .find((s: { id: string }) => s.id === shiftId);
    const close = {
      shift_id: shiftId,
      counted_cents: current.expected_cents - 100,
      reason: 'Cierre de prueba',
    };
    const result = await post(owner, '/api/cash/close', close);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().expected_cents - result.json().counted_cents).toBe(100);
    expect((await post(owner, '/api/cash/close', close)).statusCode).toBe(200);
    expect((await post(owner, '/api/sales', saleBody())).statusCode).toBe(409);
  });
});
