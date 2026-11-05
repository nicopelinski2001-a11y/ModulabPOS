# Modulab POS · 1.0

POS local para kioscos pequeños y medianos: React + TypeScript, Fastify y PostgreSQL. Ventas, inventario y caja se confirman en una sola transacción. Interfaz en español argentino, importes exactos en centavos y cantidades en milésimas para productos por peso.

**Preparado para operar con un servidor dentro del comercio.** Perder internet no impide vender ni emitir tickets comerciales. Las terminales necesitan conexión con ese servidor. Los tickets están identificados como **NO VÁLIDOS COMO FACTURA** y los pagos electrónicos se registran manualmente.

## Resumen ejecutivo

La auditoría completó los flujos de venta, descuentos e impuestos incluidos; efectivo con vuelto, tarjetas, QR/billetera, transferencia y pagos combinados; devolución total; productos, categorías, códigos, stock y alertas; apertura, movimientos, arqueo y cierre. Se reforzó la integridad también en PostgreSQL, el reintento de cobros, la coordinación entre pestañas y el bloqueo por inactividad.

**Verificación:** 27 tests unitarios, 32 de integración y 9 E2E aprobados (68 en total), lint/formato/tipos/build correctos y `npm audit` sin vulnerabilidades.

Se incorporaron PDF térmicos reales de 58/80 mm para tickets y PDF A4 de reportes y arqueos, CSV seguro, conciliación manual de pagos pendientes con evidencia, recuperación de acceso por CLI, instalador local, arranque del kiosco, servicios de usuario con backup diario, despliegue Docker y paquete de distribución sin secretos. Las comprobaciones y sus límites están en [docs/VERIFICACION.md](docs/VERIFICACION.md).

Las imágenes de instalación se construyeron y probaron con Podman rootless. La validación de impresoras, Docker Compose con su proxy HTTPS y Windows requiere esos entornos de destino. Acreditar o reintegrar dinero electrónico se hace en el banco/proveedor del comercio; la integración automática y la facturación fiscal requieren un proveedor implementado y credenciales autorizadas. Los adaptadores locales funcionan sin esos servicios y nunca simulan autorizaciones.

## Instalación rápida en una computadora Linux

Requisitos: **Node.js 24 LTS**, npm, PostgreSQL 18 con `initdb`, `pg_ctl`, `pg_dump` y `pg_restore` en PATH; navegador Chromium/Chrome actual. Ejecutar con un usuario del kiosco **sin ser root**. No reutilizar un perfil de navegador entre comercios.

```bash
npm ci
npm run setup
npm run kiosk:start
```

El setup de una instalación nueva genera secretos aleatorios y archivos privados, inicializa PostgreSQL en `.local/pgdata`, enlazado a `127.0.0.1:55438`, aplica las siete migraciones, crea el comercio `mi-kiosco` con dos cajas y compila la aplicación. Abrir **http://localhost:3001**. Las credenciales del propietario están en `.local/installation.json`, con permisos 600; no se imprimen en consola ni se incluyen en Git/paquetes.

Para personalizar el alta, establecer `SHOP_SLUG`, `SHOP_NAME` y `OWNER_EMAIL` antes de ejecutar setup. `OWNER_PASSWORD` permite suministrar una contraseña de al menos 12 caracteres desde un gestor de secretos; si falta, se genera. `SETUP_PG_PORT` cambia el puerto de la base local en una instalación nueva. Si `.env` ya existe, se respeta y se migra/compila la instalación configurada; el script no reemplaza sus secretos ni crea un comercio real sobre esa base.

```bash
# Evaluación separada, con catálogo demo. No cargar demo en el comercio real.
npm run setup -- --demo
# El seed crea modulab / admin@modulab.local, contraseña SEED_PASSWORD de .env.
```

Repetir setup no duplica los datos. El setup nuevo se comprobó de forma aislada, incluyendo un segundo pase, arranque de producción, login y backup restaurado. Si existe `.local/pgdata` pero se perdió `.env`, el instalador se detiene para preservar la base: recuperar el archivo de configuración desde una copia segura.

### Arranque automático y backup diario

En Linux con systemd de usuario:

```bash
npm run service:install -- --preview  # genera unidades para revisar, sin activar nada
npm run service:install              # instala/activa POS y timer de backup
systemctl --user status modulab-pos.service modulab-backup.timer
journalctl --user -u modulab-pos -f
```

El administrador del equipo puede ejecutar `loginctl enable-linger USUARIO` para iniciar los servicios al encender sin iniciar sesión gráfica. El backup diario se programa a las 03:00, en la zona horaria del equipo; `Persistent=true` recupera ejecuciones omitidas. El inicio local levanta la base administrada por setup. Una instalación con `.env` propio debe mantener su PostgreSQL disponible mediante el servicio correspondiente.

### Base existente o servidor de red

```bash
npm ci
cp .env.example .env
# Configurar URL administradora, URL runtime, contraseña runtime y secreto únicos.
npm run db:migrate
# OWNER_PASSWORD debe venir del entorno/gestor de secretos.
npm run tenant:create -- mi-kiosco 'Mi Kiosco' propietario@comercio.com
npm run build
npm start
```

El migrador necesita una cuenta PostgreSQL privilegiada para crear roles, extensiones y funciones de autenticación. El servidor usa exclusivamente `modulab_app`, sin propiedad de tablas, SUPERUSER ni BYPASSRLS. Una base/cluster por instalación evita compartir credenciales de instalación con otros clientes. No exponer PostgreSQL a internet.

En este workspace ya existía una base de evaluación local en el puerto 55438. Sus secretos y datos se preservaron; el setup no la transforma en un comercio nuevo. El binario de producción fue comprobado en `http://localhost:3001`. El `.env` preexistente conserva su origen de desarrollo; para iniciar ese mismo binario sin modificar secretos usar `NODE_ENV=production APP_ORIGIN=http://localhost:3001 HOST=127.0.0.1 npm start`. Si la base está detenida:

```bash
pg_ctl -D .local/pgdata -l .local/postgres.log \
  -o "-p 55438 -k $PWD/.local/pgsocket -h 127.0.0.1" start
```

## Configuración

| Parámetro                    | Uso                                                                       |
| ---------------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`               | Runtime PostgreSQL, rol `modulab_app`                                     |
| `ADMIN_DATABASE_URL`         | Sólo migraciones, altas, recuperación y backups; nunca frontend           |
| `APP_DATABASE_PASSWORD`      | Contraseña del rol runtime; mínimo 16 caracteres                          |
| `SESSION_SECRET`             | Secreto aleatorio de al menos 32 caracteres                               |
| `APP_ORIGIN`                 | Origen exacto del navegador, sin ruta; desarrollo `http://localhost:5173` |
| `HOST`, `PORT`               | Escucha; predeterminados `127.0.0.1:3001`                                 |
| `NODE_ENV`                   | `production` en instalaciones reales; `development` para Vite             |
| `TRUST_PROXY`                | IP/CIDR de proxies confiables, separados por comas; vacío por defecto     |
| `PAYMENT_PROVIDER=manual`    | Adaptador local que registra pagos, no cobra ni verifica al banco         |
| `FISCAL_PROVIDER=commercial` | Emisor de ticket comercial sin autorización fiscal                        |
| `BACKUP_DIR`                 | Directorio destino del backup, predeterminado `backups/`                  |
| `BACKUP_RETENTION_DAYS`      | Opcional; entero ≥7. Sin definir conserva todas las copias                |
| `SEED_PASSWORD`              | Sólo alta de demo; seed bloqueado en producción                           |

**HTTPS obligatorio para terminales en red.** Se admite HTTP en producción únicamente cuando tanto `APP_ORIGIN` como `HOST` son loopback para una computadora individual. Las cookies son HttpOnly/SameSite=Strict y Secure bajo HTTPS. No usar `HOST=0.0.0.0` con un origen HTTP de producción. `TRUST_PROXY` se configura sólo si se conocen las IP del proxy; la cuota por IP es por proceso.

En **Configuración** se administran nombre, dirección, CUIT/datos comerciales, zona horaria, impuesto incluido por defecto, pie y ancho de ticket (58/80 mm), política de stock y bloqueo por inactividad (1–120 minutos, 15 por defecto). La moneda soportada es ARS. Cada producto puede heredar el impuesto o indicar una tasa propia, incluido 0. Los tickets históricos conservan las tasas y los datos originales.

## Operación del cajero

1. **Caja y turnos → Abrir mi caja**: elegir caja física y declarar el fondo inicial.
2. **Punto de venta**: escanear código/SKU y Enter, buscar o tocar un producto. Un nuevo escaneo suma cantidad; tocar la cantidad permite editarla. Los productos por kg aceptan tres decimales.
3. **F8 → Cobrar**: aplicar descuento autorizado, elegir efectivo, débito, crédito, QR/billetera o transferencia. **Combinar** reparte el total entre medios; los importes deben cubrir exactamente el total. El vuelto se calcula sólo sobre efectivo recibido.
4. Verificar la acreditación de pagos electrónicos por el canal del proveedor. Si se registra un pago pendiente, queda señalado en Ventas/ticket/reportes. Desde el ticket puede confirmarse manualmente con una referencia; el registro original permanece inmutable.
5. **Confirmar venta** registra venta, pagos, descuento, impuestos, stock, caja y auditoría. Imprimir o descargar PDF; fallar la impresora no revierte ni repite la venta.
6. Si se pierde la respuesta, usar **Reintentar operación**. Se conserva la misma intención y UUID, incluso después de recargar. No borrar el almacenamiento del navegador mientras haya un cobro pendiente.
7. **Ventas → Devolver**: sólo propietario/admin, motivo obligatorio y caja propia abierta. Devolución total con reposición y compensación financiera. El reintegro electrónico se ejecuta por el proveedor original; el POS registra la devolución comercial.
8. **Caja y turnos → Cerrar mi caja**: contar efectivo real y registrar motivo. Se conserva esperado, contado y diferencia. Descargar arqueo en CSV/PDF. Los pagos electrónicos no forman parte del efectivo esperado.

Atajos: **F2** búsqueda, **Enter** escaneo, **F8** cobro y **Escape** cierre de ventanas. Hay feedback visual y un tono corto cuando el navegador permite audio. Los controles táctiles tienen un mínimo de 44 px. Un producto se da de baja desactivándolo; sus ventas e historial se conservan.

Los ingresos/retiros requieren motivo. Un retiro, pago o devolución en efectivo no puede superar el efectivo registrado: revisar el saldo o registrar un ingreso real. No se reabre ni edita un turno cerrado. El backend permite cierre administrativo autorizado mediante `/api/cash/close`.

Los ingresos/retiros, aperturas, cobranzas, pagos a proveedores, ajustes de stock y aumentos de precios se guardan antes del envío. Si aparece **Hay una operación pendiente de recuperar**, usar **Recuperar operación**, incluso después de recargar o volver a ingresar. Primero se consulta el resultado confirmado del mismo operador; si no existe, se reenvían los datos originales con su UUID. Mientras tanto se bloquean otras modificaciones. No volver a cargar el movimiento con otra clave ni borrar datos del navegador.

Una respuesta HTTP 200 incompleta tampoco confirma un cobro: el cliente verifica clave de operación, operador, renglones, pagos, impuestos, descuento y vuelto antes de liberar el carrito.

### Roles y recuperación de acceso

| Rol                     | Facultades                                                                       |
| ----------------------- | -------------------------------------------------------------------------------- |
| Propietario (`owner`)   | Operación, descuentos, devoluciones, stock, reportes, usuarios y configuración   |
| Administrador (`admin`) | Operación, descuentos, devoluciones, stock, reportes y auditoría                 |
| Cajero (`cashier`)      | Ventas sin descuentos/devoluciones, caja propia y clientes sin habilitar crédito |
| Repositor (`stock`)     | Productos, inventario, compras y proveedores                                     |

Las contraseñas usan scrypt. La sesión dura como máximo 8 horas, con bloqueo por inactividad aplicado en navegador y servidor. Las consultas automáticas no renuevan ese plazo; el carrito persiste al volver a ingresar. Cambiar contraseña revoca las demás sesiones; desactivar/cambiar el rol revoca todas las sesiones del usuario.

Si el propietario pierde la contraseña, un administrador **del equipo/base**, con credenciales de instalación, puede restablecerla sin correo externo:

```bash
# NEW_PASSWORD se suministra por un gestor de secretos/entorno, no se incluye en argumentos.
npm run user:reset-password -- mi-kiosco propietario@comercio.com
```

Esto exige `NEW_PASSWORD`, usa `ADMIN_DATABASE_URL`, revoca sesiones, libera el bloqueo por intentos fallidos y deja auditoría. El login admite 30 solicitudes por IP/minuto y hasta 10 intentos fallidos consecutivos por cuenta en 15 minutos; un ingreso válido reinicia el contador de cuenta. Los cambios concurrentes de contraseña/acceso se comprueban bajo bloqueo antes de crear una sesión. No reactiva usuarios deshabilitados ni cambia sus roles.

## Reportes y exportación

**Reportes** permite elegir período (hasta 367 días, inclusive), ventas brutas/netas, descuentos, devoluciones en su fecha, impuestos incluidos, costos históricos, resultado estimado, serie diaria, ocho productos más vendidos, pagos y pendientes, stock valorizado y alertas. Exporta CSV y PDF directamente, sin servicios externos. CSV neutraliza fórmulas de planillas. Ventas permite exportar la página filtrada y paginar el historial; Productos exporta el catálogo completo.

Los reportes se leen bajo una instantánea consistente de PostgreSQL. El resultado estimado es ventas con impuestos incluidos menos costos cargados: no constituye una liquidación fiscal ni separa impuestos recuperables de las compras. Los arqueos incluyen resumen de medios, efectivo inicial/esperado/contado/diferencia y hasta 10000 movimientos de detalle; el saldo se calcula con **todos** los movimientos.

## Resiliencia y backups

La aplicación no depende de CDNs ni APIs externas para operar. No hay que sincronizar con una nube para registrar ventas: los datos viven en PostgreSQL del comercio. El indicador superior comprueba el servidor cada 15 segundos. Si falla la LAN, el servidor o la base, se conserva el carrito/intención, se informa el problema y se reintenta al recuperar conexión. No se emite una venta definitiva desde un navegador aislado del servidor.

```bash
npm run backup
npm run backup:verify -- backups/modulab-FECHA-SUFIJO.dump
```

El backup usa `pg_dump` consistente, archivo temporal, publicación por renombre, checksum SHA256 y permisos privados. La verificación exige el `.sha256`, restaura en una base temporal, reaplica permisos y comprueba RLS y conciliación del stock. Nunca restaura sobre el comercio activo ni lo vacía. Las pruebas también crean y eliminan únicamente bases temporales.

Programar backups con el timer incluido o el servicio Compose. Configurar `BACKUP_DIR` en un volumen/disco distinto y copiar las copias fuera del equipo. El backup PostgreSQL **no incluye `.env`**: conservarlo cifrado y separado con las credenciales de recuperación. Procedimiento de restauración y actualización en [docs/OPERACION.md](docs/OPERACION.md). Proteger físicamente el equipo y su perfil de navegador; los borradores locales no están cifrados.

## Despliegue y empaquetado

```bash
npm run package
# Produce releases/modulab-pos-1.0.0.tar.gz y .sha256.
# En destino: extraer, npm ci, npm run setup, npm run kiosk:start.
```

La distribución usa una lista explícita de archivos: excluye `.env`, credenciales, base, backups, `.git`, dependencias y capturas. Incluye código, lockfile, compilación, migraciones, pruebas y documentación. La instalación inicial necesita internet para `npm ci`; después las ventas locales no lo necesitan. Para un destino sin internet, preparar dependencias/imágenes previamente en una máquina del mismo sistema y arquitectura.

Para Docker/Linux o Docker Desktop en Windows:

```bash
cp .env.docker.example .env.docker
# Completar tres secretos hexadecimales aleatorios, APP_ORIGIN HTTPS y DOMAIN.
npm run deploy
# Alta de un comercio, con OWNER_PASSWORD suministrada por el entorno:
docker compose --env-file .env.docker run --rm -e OWNER_PASSWORD migrate \
  scripts/create-tenant.ts mi-kiosco 'Mi Kiosco' propietario@comercio.com
```

El script valida Compose, compila imágenes, detiene escritores, guarda el backup final previo a la migración, migra y levanta base/app/backup/proxy HTTPS. La cuenta administradora no llega al contenedor runtime. Una migración fallida deja la aplicación detenida y los datos disponibles para diagnóstico; no se deshacen migraciones automáticamente. El proxy Caddy requiere DNS/puertos/certificado de la instalación. No ejecutar seed en producción.

## Verificación reproducible

```bash
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:integration
npx playwright install chromium
npm run test:e2e
npm audit
npm run backup
npm run backup:verify -- backups/archivo.dump
# Prueba aislada de las imágenes; requiere Docker o Podman:
npm run test:container
# Alternativa comprobada en este equipo:
CONTAINER_ENGINE=podman npm run test:container
```

La prueba de contenedores genera credenciales temporales, una red y una base separadas, compila tooling/runtime, aplica migraciones dos veces y ejecuta login, cinco medios, mixto, reintento, PDF, devolución, cierre, reportes y backup/restauración. Elimina sus contenedores, volúmenes, red y credenciales al terminar; conserva imágenes/cache de build. No lee `.env` ni usa la base del comercio. `CONTAINER_SMOKE_PORT` cambia el puerto local 3181. No comprueba el dominio/certificado del proxy ni Windows.

`npm run verify` reúne lint, formato, tipos, unitarios, build, integración y E2E. Integración/E2E necesitan un administrador PostgreSQL con permiso de crear bases y `APP_DATABASE_PASSWORD`/`DATABASE_URL` coherentes. Chromium requiere sus dependencias del SO (`npx playwright install --with-deps chromium` en un host de CI nuevo). Las capturas y trazas se guardan en `test-results/`. Hay CI en `.github/workflows/ci.yml`.

## Troubleshooting

| Síntoma                                    | Resolución                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| No inicia sesión o aparece error de origen | Verificar `APP_ORIGIN` exacto: protocolo, hostname y puerto. No intercambiar localhost/127.0.0.1 en el navegador      |
| PostgreSQL no conecta                      | Comprobar puerto, servicio, disco libre y `.env`; iniciar la base local con `kiosk:start` si fue creada por setup     |
| HTTPS/cookies no funcionan en LAN          | Instalar certificado confiable, configurar proxy y origen HTTPS; `HOST=0.0.0.0` no habilita HTTP de producción        |
| Operación pendiente de caja/stock          | Pulsar Recuperar operación con el mismo usuario; no repetir el movimiento con una clave nueva ni limpiar el navegador |
| Venta pendiente tras un corte              | Volver al POS con el mismo usuario y pulsar Reintentar; conservar almacenamiento del navegador                        |
| Stock insuficiente                         | Revisar cantidad y movimientos; cargar ingreso/ajuste real, no modificar saldos por SQL                               |
| Efectivo insuficiente                      | Revisar fondo, ingresos, retiros y devoluciones; registrar un ingreso real si corresponde                             |
| Impresora no aparece                       | Instalar driver del SO, elegir 58/80 mm, escala 100%, sin encabezados del navegador; usar Descargar PDF               |
| Backup/timer falla                         | Revisar PostgreSQL, `ADMIN_DATABASE_URL`, ejecutables y permisos/espacio de destino; consultar journal o logs Compose |
| Archivo de backup alterado                 | No restaurar: la verificación rechaza un SHA256 incorrecto; obtener otra copia íntegra                                |
| Migración con checksum distinto            | Recuperar el SQL original. Crear una migración nueva; nunca editar una aplicada                                       |
| Sesión bloqueada                           | Volver a ingresar; no cerrar caja ni borrar datos para intentar recuperar el carrito                                  |

## Decisiones tomadas

- Un servidor y una base por comercio, compartidos por LAN. El requisito offline se resuelve operando localmente; no se implementa una segunda base en cada navegador ni sincronización entre servidores independientes, para evitar conflictos de stock, numeración y caja.
- ARS es la única moneda. Los precios de mostrador son finales con impuestos incluidos, tasa global opcional y por producto; predeterminado 0 hasta configurar el comercio. No se supone una condición tributaria ni una tasa legal aplicable.
- Descuento global en centavos, sólo para propietario/admin, distribuido proporcionalmente por mayor resto y desempate por ID; impuesto extraído después del descuento, redondeo half-up por línea, aritmética BigInt. Se preserva cada centavo y las condiciones históricas.
- Un código de barras por producto. Categorías como nombres normalizados por trim. Desactivar conserva el historial. Un depósito por comercio; unidades enteras o kg con tres decimales. Sin stock negativo por defecto.
- Efectivo recibido vacío significa importe exacto. Vuelto sólo en efectivo, pagos sin duplicar métodos y suma exacta. Se permite marcar electrónicos pendientes de forma explícita y conciliarlos después con referencia auditada; no se procesan tarjetas ni se certifica acreditación bancaria.
- Los adaptadores `PaymentRecorder` y `FiscalProvider` (`src/server/lib/providers.ts`) implementan los modos manual/comercial. Las variables sólo habilitan esos modos; un proveedor desconocido impide arrancar. Una integración automática requiere implementar el contrato y configurar credenciales del proveedor; cambiar una variable no convierte un ticket en factura.
- La anulación de una venta confirmada se registra como devolución total. El carrito sin confirmar puede vaciarse. Devolución total con motivo, permiso y reposición completa, sin borrar la venta original. Para mercadería dañada se registra después una merma con ajuste de inventario. Los reintegros electrónicos se hacen en el proveedor original. No se implementan devoluciones parciales.
- Apertura/cierre definitivos por turno y empleado. Se rechazan egresos que producirían efectivo negativo; no hay reapertura ni modificación de libros contables. Las correcciones se registran como movimientos compensatorios.
- Carrito/intención por comercio y usuario, con UUID persistido antes de cobrar y coordinación entre pestañas del mismo perfil. Los reintentos utilizan exactamente los datos guardados. No se confirman ventas sin el servidor; no eliminar datos del navegador en medio de una recuperación.
- También se conserva la intención completa de comandos de caja, stock, cobranzas y precios. La consulta de recuperación se restringe al operador/comercio original y espera cualquier commit concurrente. Un dato local corrupto impide sobrescribir su clave: requiere revisar historial con el administrador.
- Se preservaron la base y las credenciales de evaluación existentes; una instalación comercial nueva genera sus propios secretos y propietario, con contraseñas de al menos 12 caracteres.
- Bloqueo tras 15 minutos sin entrada real, configurable; TTL absoluto de 8 horas. Polling de salud/reportes no extiende sesión. La reautenticación conserva el borrador. Sin dependencia de correo para recuperar acceso: CLI privilegiada y auditada.
- Impresión mediante driver/navegador, 58/80 mm, con PDF descargable del mismo ancho y altura según contenido (paginación a un metro). Los reportes permanecen A4. Caja y operador se conservan en el snapshot del ticket, aunque cambien sus nombres después. Sin impresión silenciosa ni ESC/POS directo: requieren un agente/driver específico de hardware.
- HTTP sólo en loopback para el kiosco individual; HTTPS para LAN. Instalación Linux nativa y distribución Docker. Windows nativo y otras arquitecturas requieren un piloto de su plataforma.
- Se conserva copia antes de migrar; migraciones versionadas e inmutables, sin rollback automático destructivo. Backups sin vencimiento por defecto; retención optativa mínima de siete días y copia externa a cargo de la instalación.
- TypeScript 6.0 se usa para compatibilidad declarada con el parser ESLint. `minimatch` se fija a una versión corregida mediante override; lint y tests comprueban la resolución. `npm audit` se ejecuta sobre todo el árbol.
- El pedido histórico en `docs/PEDIDO-ORIGINAL.md` se preserva como antecedente; no amplía este alcance a una plataforma SaaS ni a módulos ajenos al kiosco.

## Checklist final

| Estado | Entrega / condición                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | Venta completa: escaneo/búsqueda, carrito, cantidades/peso, descuentos, impuestos, vuelto, efectivo/tarjetas/QR/transferencia/mixto, ticket y devolución total                                  |
| ✅     | Catálogo, categorías, códigos, precios, alta/edición/desactivación, inventario automático, movimientos y alertas                                                                                |
| ✅     | Apertura, ingresos/egresos, arqueo, diferencia y cierre, con reportes CSV/PDF                                                                                                                   |
| ✅     | Transacciones atómicas, bloqueos, claves idempotentes, restricciones diferidas, libros inmutables, siete migraciones e índices                                                                  |
| ✅     | Login, roles, CSRF, RLS, contraseñas seguras, expiración/inactividad y recuperación administrativa                                                                                              |
| ✅     | Errores globales, logging, recuperación de interfaz, carrito/comandos persistentes, validación de confirmaciones, indicador de conexión y recuperación de respuesta perdida                     |
| ✅     | Operación sin internet manteniendo servidor/LAN; ninguna dependencia externa para vender manualmente                                                                                            |
| ✅     | Validaciones, lint, tipos, unitarios, integración PostgreSQL, E2E y smoke de medios/devolución/cierre/reporte                                                                                   |
| ✅     | Reportes por período, top de productos, exportaciones CSV/PDF, datos históricos de impuestos y pagos pendientes conciliables                                                                    |
| ✅     | `.env.example`, configuración del comercio, moneda/impuestos/ticket, controles táctiles, atajos, feedback y carga diferida                                                                      |
| ✅     | Instalador, demo separado, arranque, servicios y backup diario, empaquetado con checksum, script de deploy y documentación                                                                      |
| ✅     | Backups con checksum y restauración de verificación en una base aislada                                                                                                                         |
| ⚠️     | Impresora física: instalar driver, seleccionar papel y realizar prueba en el equipo de destino; fallback PDF disponible                                                                         |
| ✅     | Imágenes tooling/runtime comprobadas con Podman rootless, red aislada, usuario sin privilegios y filesystem de sólo lectura                                                                     |
| ⚠️     | Docker Compose/proxy HTTPS y Windows: validar en destino; configurar dominio, DNS, puertos y confianza del certificado                                                                          |
| ⚠️     | Backup fuera del equipo: configurar destino seguro y probar restauración periódica; proteger `.env` por separado                                                                                |
| ⚠️     | Pagos automáticos/facturación fiscal: los modos actuales son manual/comercial. Requieren proveedor implementado, credenciales del titular y homologación; no se emiten autorizaciones ficticias |
| ❌     | Sincronización entre bases independientes: no aplica a la arquitectura local centralizada; la pérdida de LAN conserva borradores pero impide confirmar                                          |
| ❌     | Certificación fiscal, impresión silenciosa universal y certificación de seguridad: no se declaran ni están comprendidas en el ticket comercial/navegador entregado                              |

Ver también [arquitectura](docs/ARQUITECTURA.md), [operación](docs/OPERACION.md), [seguridad](docs/SEGURIDAD.md) y [alcance](docs/ALCANCE.md).
