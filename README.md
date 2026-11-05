# Modulab POS

Sistema de gestión comercial de Modulab Software, en español argentino y ARS. Este repositorio contiene una **primera versión funcional** del núcleo de ventas, inventario y caja. No constituye todavía la totalidad del sistema comercial descrito en el pedido ni una versión aprobada para producción.

El pedido recibido está conservado en [docs/PEDIDO-ORIGINAL.md](docs/PEDIDO-ORIGINAL.md); termina en el apartado 17, “Stock inicial”. El alcance verificable y los pendientes están en [docs/ALCANCE.md](docs/ALCANCE.md).

## Ejecutar en desarrollo

Requisitos: Node.js 24, npm y PostgreSQL 18. Docker es una alternativa; no se requiere ningún servicio SaaS para vender.

```bash
npm ci
cp .env.example .env
# Editar .env con tus credenciales y secretos aleatorios.
npm run db:migrate
npm run db:seed
npm run dev
```

Abrir **http://localhost:5173**. El seed crea únicamente un comercio de evaluación:

- Comercio: `modulab`
- Correo: `admin@modulab.local`
- Contraseña: el valor de `SEED_PASSWORD` que configuraste en `.env`.

No hay contraseñas predeterminadas dentro del código. El seed no crea ventas ficticias ni abre una caja automáticamente. Para probar: Caja y turnos → Abrir mi caja → Punto de venta → agregar productos → Cobrar → confirmar. No utilizar el seed como alta de clientes reales.

En este workspace ya se creó una instalación de evaluación con secretos aleatorios en `.env` (archivo excluido del repositorio). PostgreSQL usa el puerto **55438** y el directorio `.local/pgdata`, aislado del PostgreSQL del sistema. Para iniciarlo nuevamente, si no está activo:

```bash
pg_ctl -D .local/pgdata -l .local/postgres.log \
  -o "-p 55438 -k $PWD/.local/pgsocket -h 127.0.0.1" start
npm run dev
```

Esta instrucción específica del workspace requiere que `initdb` y `pg_ctl` estén instalados. No incluir `.local`, `.env` ni backups en Git.

## Crear un comercio sin datos de evaluación

Con la cuenta administradora de instalación configurada en `ADMIN_DATABASE_URL`:

```bash
OWNER_PASSWORD='una-contraseña-larga-y-única' npm run tenant:create -- \
  mi-kiosco 'Mi Kiosco' propietario@comercio.com
```

La contraseña puede establecerse por un gestor de secretos en lugar de escribirse en el historial del shell. Se crean un propietario, una sucursal y dos cajas. Las sesiones de un comercio no pueden seleccionar otro comercio por parámetros HTTP. La creación comercial SaaS y el acceso temporal de soporte aún no tienen una interfaz.

## Verificación

```bash
npm run build               # TypeScript estricto + bundle de producción
npm test                    # Dinero, cantidades, permisos y CSV
npm run test:integration     # PostgreSQL real; base temporal nueva y eliminada al terminar
npx playwright install chromium
npm run test:e2e             # Navegador real; base temporal y puertos 3041/5179
npm audit --omit=dev
npm run backup
npm run backup:verify -- backups/archivo.dump
```

Los tests necesitan un administrador PostgreSQL con permiso para crear bases. Nunca vacían la base del comercio: crean bases de nombre aleatorio `modulab_test_*` y `modulab_restore_test_*`. E2E cubre producto, apertura, escaneo doble, venta, vuelto, ticket, stock, reportes, borrador tras recarga, cierre, tema oscuro y navegación móvil. Las capturas se guardan en `test-results/`.

## Distribución y operación

```bash
npm run build
npm start
```

El servidor sirve el frontend compilado y `/api` desde el mismo origen. `APP_ORIGIN` debe coincidir exactamente con la URL que usa el navegador. En desarrollo con Vite: `http://localhost:5173`. Con `npm start` local: configurar `http://localhost:3001` y `NODE_ENV=development`. En producción se exige HTTPS y se activan cookies Secure.

[docs/OPERACION.md](docs/OPERACION.md) documenta Docker Compose, instalación local, backups, restauración, logs y despliegue. [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) explica las decisiones, el dinero exacto, RLS y los bloqueos. [docs/SEGURIDAD.md](docs/SEGURIDAD.md) incluye controles aplicados y brechas conocidas.

## Estructura

```text
src/server/modules/    Auth, productos/inventario, ventas/pagos, caja,
                       compras/proveedores, clientes, reportes, configuración
src/server/lib/        Sesiones, permisos, transacciones, errores y contraseñas
src/shared/            Contratos Zod, roles y aritmética exacta
src/web/               Aplicación React, formularios y tickets
 db/migrations/        SQL versionado y restricciones de integridad
scripts/               Migraciones, alta, seed, tests y backups
 tests/                Pruebas unitarias, integración y Playwright
```

No se implementaron servicios de pago, facturación ARCA, ESC/POS directo ni sincronización multiinstalación. Los comprobantes actuales son **tickets comerciales no válidos como factura**. Ver el alcance antes de planificar un uso real.
