import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Identificador del comercio').fill('e2e-operations');
  await page.getByLabel('Correo electrónico').fill('operations@test.local');
  await page.getByLabel('Contraseña', { exact: true }).fill('E2E-Test-Password-2026');
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Propietario.' })).toBeVisible();
}
async function scan(page: Page) {
  const field = page.getByRole('textbox', { name: 'Escanear o buscar productos' });
  await field.fill('KIOSCO-001');
  await field.press('Enter');
  await expect(page.locator('.cart-item')).toHaveCount(1);
  await page.keyboard.press('F8');
  await expect(page.getByRole('heading', { name: 'Cobrar venta', exact: true })).toBeVisible();
}
test('smoke: todos los medios, mixto, acreditación, devolución, arqueo y PDF sin servicios de internet', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const external: string[] = [];
  await page.route('**/*', (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (!['localhost', '127.0.0.1'].includes(hostname)) {
      external.push(hostname);
      return route.abort();
    }
    return route.continue();
  });
  await login(page);
  await page.getByRole('button', { name: 'Productos', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await page.getByLabel('Nombre del producto').fill('Producto kiosco');
  await page.getByLabel('SKU interno').fill('KIOSCO-001');
  await page.getByLabel('Precio de venta (ARS)').fill('121');
  await page.getByLabel('Impuesto incluido (%)', { exact: true }).fill('21');
  await page.getByLabel('Stock inicial').fill('10');
  await page.getByRole('button', { name: 'Crear producto', exact: true }).click();
  await expect(page.getByRole('cell', { name: '10 un.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Caja y turnos', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir mi caja', exact: true }).click();
  await page.getByLabel('Caja física').selectOption({ label: 'Caja 01 · Casa central' });
  await page.getByLabel('Fondo inicial (ARS)').fill('1000');
  await page.getByRole('button', { name: 'Abrir caja', exact: true }).click();
  await expect(page.getByText('Tu turno está abierto')).toBeVisible();
  await page.getByRole('button', { name: 'Punto de venta', exact: true }).click();
  for (const method of ['cash', 'debit', 'credit', 'wallet', 'transfer']) {
    await scan(page);
    await page.getByLabel('Medio de pago 1').selectOption(method);
    if (method === 'cash') await page.getByLabel('Efectivo recibido (opcional)').fill('200');
    if (method === 'transfer') await page.getByLabel('Estado del pago 1').selectOption('pending');
    await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Venta completada' })).toBeVisible();
    await expect(page.locator('#print-receipt')).toContainText('Impuestos incluidos');
    if (method === 'transfer') {
      await page.getByLabel('Referencia de acreditación · Transferencia').fill('ACR-E2E-0001');
      await page.getByRole('button', { name: 'Confirmar acreditación manual' }).click();
      await expect(page.getByLabel('Referencia de acreditación · Transferencia')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(page.locator('.cart-item')).toHaveCount(0);
  }
  await scan(page);
  await page.getByLabel('Importe del pago 1').fill('21');
  await page.getByRole('button', { name: 'Combinar' }).click();
  await expect(page.getByLabel('Importe del pago 2')).toHaveValue('100.00');
  await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Venta completada' })).toBeVisible();
  const ticketDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar PDF', exact: true }).click();
  const ticket = await ticketDownload;
  expect((await readFile((await ticket.path())!)).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Ventas', exact: true }).click();
  const first = page.locator('tbody tr').filter({ hasText: '#000001' });
  await first.getByRole('button', { name: 'Devolver' }).click();
  await page.getByLabel('Motivo de la devolución').fill('Cliente devuelve mercadería');
  await page.getByRole('button', { name: 'Confirmar devolución completa' }).click();
  await expect(first).toContainText('Devuelta');
  await page.getByRole('button', { name: 'Productos', exact: true }).click();
  await expect(page.getByRole('cell', { name: '5 un.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Caja y turnos', exact: true }).click();
  await expect(page.locator('.cash-expected')).toContainText('1.021,00');
  await page.getByRole('button', { name: 'Cerrar mi caja' }).click();
  await page.getByLabel('Efectivo contado (ARS)').fill('1020');
  await page.getByRole('button', { name: 'Confirmar cierre' }).click();
  await expect(page.getByRole('button', { name: 'Abrir mi caja', exact: true })).toBeVisible();
  const cashDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  expect((await cashDownload).suggestedFilename()).toMatch(/^cierre-.*\.pdf$/);
  await page.getByRole('button', { name: 'Reportes', exact: true }).click();
  await expect(page.locator('.metric-card').first()).toContainText('605,00');
  const reportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar PDF', exact: true }).click();
  expect((await reportDownload).suggestedFilename()).toMatch(/^reporte-.*\.pdf$/);
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar reporte' }).click();
  const csv = await csvDownload;
  expect(await readFile((await csv.path())!, 'utf8')).toContain('Impuestos incluidos');
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
test('bloqueo por inactividad conserva el carrito y exige volver a ingresar', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByLabel('Bloquear por inactividad (minutos)').fill('1');
  await page.getByRole('button', { name: 'Guardar configuración' }).click();
  await expect(page.getByText('Configuración guardada.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Punto de venta', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Escanear o buscar productos' });
  await field.fill('KIOSCO-001');
  await field.press('Enter');
  await expect(page.locator('.cart-item')).toHaveCount(1);
  await page.clock.install();
  await page.clock.fastForward(62000);
  await expect(page.getByRole('heading', { name: 'Ingresá a tu comercio' })).toBeVisible();
  await login(page);
  await page.getByRole('button', { name: 'Punto de venta', exact: true }).click();
  await expect(page.locator('.cart-item')).toHaveCount(1);
});
test('dos pestañas del mismo operador no cobran dos veces el mismo carrito', async ({
  page,
  context,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Caja y turnos', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir mi caja', exact: true }).click();
  await page.getByLabel('Caja física').selectOption({ label: 'Caja 01 · Casa central' });
  await page.getByLabel('Fondo inicial (ARS)').fill('0');
  await page.getByRole('button', { name: 'Abrir caja', exact: true }).click();
  await expect(page.getByText('Tu turno está abierto')).toBeVisible();
  await page.getByRole('button', { name: 'Punto de venta', exact: true }).click();
  await scan(page);
  const second = await context.newPage();
  await second.goto('/#pos');
  await expect(second.locator('.cart-item')).toHaveCount(1);
  await second.keyboard.press('F8');
  await expect(second.getByRole('heading', { name: 'Cobrar venta', exact: true })).toBeVisible();
  const before = (await (await page.request.get('/api/sales')).json()).length;
  await Promise.all(
    [page, second].map((tab) =>
      tab.evaluate(() => {
        document.querySelector<HTMLButtonElement>('dialog button[type="submit"]')!.click();
      }),
    ),
  );
  await expect(page.locator('.cart-item')).toHaveCount(0);
  await expect(second.locator('.cart-item')).toHaveCount(0);
  expect((await (await page.request.get('/api/sales')).json()).length).toBe(before + 1);
});
test('escaneos rápidos conservan todas las unidades aunque el servidor responda lento', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Punto de venta', exact: true }).click();
  await page.route('**/api/products?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === 'KIOSCO-001')
      await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  const field = page.getByRole('textbox', { name: 'Escanear o buscar productos' });
  for (let i = 0; i < 4; i++) {
    await field.fill('KIOSCO-001');
    await field.press('Enter');
  }
  await expect(page.locator('.qty-value')).toHaveText('4');
  await expect(page.locator('.cart-item')).toHaveCount(1);
});
