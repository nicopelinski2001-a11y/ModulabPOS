import { test, expect } from '@playwright/test';
test('flujo completo: login, producto, caja, venta por escaneo, ticket, reportes y cierre', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Identificador del comercio').fill('e2e-comercio');
  await page.getByLabel('Correo electrónico').fill('e2e@test.local');
  await page.getByLabel('Contraseña', { exact: true }).fill('E2E-Test-Password-2026');
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Propietario.' })).toBeVisible();
  await page.getByRole('button', { name: 'Productos', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await page.getByLabel('Nombre del producto').fill('Alfajor de prueba');
  await page.getByLabel('SKU interno').fill('E2E-001');
  await page.getByLabel('Código de barras (opcional)').fill('7790000000011');
  await page.getByLabel('Precio de venta (ARS)').fill('1500');
  await page.getByLabel('Costo (ARS)', { exact: true }).fill('900');
  await page.getByLabel('Stock inicial').fill('10');
  await page.getByRole('button', { name: 'Crear producto', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Activo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Caja y turnos', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir mi caja', exact: true }).click();
  await page.getByLabel('Caja física').selectOption({ label: 'Caja 01 · Casa central' });
  await page.getByLabel('Fondo inicial (ARS)').fill('10000');
  await page.getByRole('button', { name: 'Abrir caja', exact: true }).click();
  await expect(page.getByText('Tu turno está abierto')).toBeVisible();
  await page.getByRole('button', { name: 'Punto de venta', exact: true }).click();
  const scan = page.getByRole('textbox', { name: 'Escanear o buscar productos' });
  await scan.fill('7790000000011');
  await scan.press('Enter');
  await expect(page.getByRole('heading', { name: 'Venta actual' })).toBeVisible();
  await expect(page.locator('.cart-item')).toHaveCount(1);
  // A second USB scan adds a second unit to the same line, never a duplicate line.
  await scan.fill('7790000000011');
  await scan.press('Enter');
  await expect(page.locator('.qty-value')).toHaveText('2');
  await page.keyboard.press('F8');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Efectivo recibido (opcional)').fill('5000');
  await page.getByRole('button', { name: 'Confirmar venta' }).click();
  await expect(page.getByRole('heading', { name: 'Venta completada' })).toBeVisible();
  await expect(page.locator('#print-receipt')).toContainText('NO VÁLIDO COMO FACTURA');
  await expect(page.locator('#print-receipt')).toContainText('Alfajor de prueba');
  await expect(page.locator('#print-receipt')).toContainText('2.000,00');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.locator('.cart-item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Productos', exact: true }).click();
  await expect(page.getByRole('cell', { name: '8 un.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resumen', exact: true }).click();
  await expect(page.locator('.metric-card').first()).toContainText('3.000,00');
  await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });
  await page.getByRole('button', { name: 'Activar tema oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/dashboard-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Activar tema claro' }).click();
  await page.getByRole('button', { name: 'Punto de venta', exact: true }).click();
  await page.screenshot({ path: 'test-results/pos.png', fullPage: true });
  // Draft survives a tab reload. Financial confirmation still requires the local server.
  await scan.fill('7790000000011');
  await scan.press('Enter');
  await expect(page.locator('.cart-item')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.cart-item')).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Vaciar carrito', exact: true }).click();
  await page.getByRole('button', { name: 'Caja y turnos', exact: true }).click();
  await expect(page.locator('.cash-expected')).toContainText('13.000,00');
  await page.getByRole('button', { name: 'Cerrar mi caja' }).click();
  await page.getByLabel('Efectivo contado (ARS)').fill('13000');
  await page.getByRole('button', { name: 'Confirmar cierre' }).click();
  await expect(page.getByRole('button', { name: 'Abrir mi caja', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Ingresá a tu comercio' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('vista móvil permite navegar y respeta el ancho del dispositivo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Identificador del comercio').fill('e2e-comercio');
  await page.getByLabel('Correo electrónico').fill('e2e@test.local');
  await page.getByLabel('Contraseña', { exact: true }).fill('E2E-Test-Password-2026');
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Propietario.' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await page.getByRole('button', { name: 'Punto de venta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Punto de venta', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
test('una respuesta perdida después del commit se recupera sin duplicar la venta', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Identificador del comercio').fill('e2e-comercio');
  await page.getByLabel('Correo electrónico').fill('e2e@test.local');
  await page.getByLabel('Contraseña', { exact: true }).fill('E2E-Test-Password-2026');
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Propietario.' })).toBeVisible();
  await page.getByRole('button', { name: 'Caja y turnos', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir mi caja', exact: true }).click();
  await page.getByLabel('Caja física').selectOption({ label: 'Caja 01 · Casa central' });
  await page.getByLabel('Fondo inicial (ARS)').fill('0');
  await page.getByRole('button', { name: 'Abrir caja', exact: true }).click();
  await expect(page.getByText('Tu turno está abierto')).toBeVisible();
  await page.getByRole('button', { name: 'Punto de venta', exact: true }).click();
  const scan = page.getByRole('textbox', { name: 'Escanear o buscar productos' });
  await scan.fill('7790000000011');
  await scan.press('Enter');
  await expect(page.locator('.cart-item')).toHaveCount(1);
  await page.keyboard.press('F8');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.route(
    '**/api/sales',
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Confirmar venta' }).click();
  await expect(
    page.getByText('Se consultará o completará la operación guardada', { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Hay una venta pendiente de confirmar.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar operación', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Venta completada' })).toBeVisible();
  await expect(page.locator('#print-receipt')).toContainText('000002');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Productos', exact: true }).click();
  await expect(page.getByRole('cell', { name: '7 un.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ventas', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
});
