# Verificación de entrega · 5 de noviembre de 2026

Entorno: Linux, Node.js 24.21.0, PostgreSQL 18.6 y Chromium mediante Playwright. Fecha de referencia: Argentina. Las pruebas financieras usan bases nuevas `modulab_test_*`, eliminadas al finalizar; no crean ventas en el comercio del workspace.

## Resultados

| Comprobación                       | Resultado                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`                   | Aprobado: lint, formato, tipos, unitarios, build, integración y E2E                                                                                                                                                                                                                |
| ESLint                             | Sin errores ni warnings                                                                                                                                                                                                                                                            |
| Prettier                           | Archivos comprobados                                                                                                                                                                                                                                                               |
| TypeScript                         | Cliente, servidor, scripts y tests con tipado estricto                                                                                                                                                                                                                             |
| Unitarios Vitest                   | **27 aprobados**; dinero, cantidades, permisos, transporte, CSV, impuestos/descuentos, confirmaciones financieras y PDF térmico                                                                                                                                                    |
| PostgreSQL real                    | **32 aprobados**; atomicidad, concurrencia, roles, RLS, stock, caja, crédito, compras, impuestos, conciliación y recuperación de conexión                                                                                                                                          |
| Chromium E2E                       | **9 aprobados**, incluyendo smoke de todos los medios, devolución, cierre y reportes                                                                                                                                                                                               |
| Dependencias                       | `npm audit`: **0 vulnerabilidades**, incluido desarrollo                                                                                                                                                                                                                           |
| Migración de instalación existente | Siete migraciones aplicadas; se preservaron 12 productos y una venta previa                                                                                                                                                                                                        |
| Backup anterior a migración        | Restaurado en base temporal y actualizado; 1 comercio, 12 productos, 1 venta, **0 diferencias de stock**                                                                                                                                                                           |
| Backup posterior a migración       | Restaurado y permisos/RLS verificados; mismos conteos, **0 diferencias de stock**                                                                                                                                                                                                  |
| Backup manipulado                  | Rechazado por SHA256 antes de conectar/restaurar                                                                                                                                                                                                                                   |
| Instalación nueva aislada          | Setup, segundo pase sin cambiar secretos, producción en loopback, login, dos cajas y backup restaurado correctos                                                                                                                                                                   |
| Paquete distribuible               | SHA256 y lista comprobados, sin secretos/base/backups; extracción nueva, `npm ci`, setup repetido sin cambiar secretos, venta en Chromium con binario de producción, vuelto/PDF/cierre/reportes, reset con revocación y backup restaurado (1 producto, 1 venta, stock consistente) |
| Servicios Linux                    | Generación `--preview` verificada sin activar servicios en el host                                                                                                                                                                                                                 |
| Shell y repositorio                | `bash -n` de backup/deploy y `git diff --check` correctos; versiones package/lock coherentes                                                                                                                                                                                       |

## Refuerzos verificados en esta revisión

- Un 200 con JSON incompleto después del commit conserva UUID y carrito; recargar y reintentar produce una única venta. El recibo se valida contra el operador, clave, cantidades y todos los importes.
- Un ingreso de caja confirmado con respuesta perdida se recupera desde el aviso global después de recargar, sin repetir el movimiento. La consulta se aísla por comercio y operador. Los comandos de caja, stock, cobranzas, pagos y precios persisten antes de enviar. Una intención corrupta o que no puede guardarse impide enviar una operación nueva.
- Doce reingresos válidos no agotan la cuota de cuenta. Once intentos fallidos sí bloquean. El reset administrativo libera la cuota y revoca sesiones; un reset concurrente impide crear una sesión con la contraseña anterior.
- Los PDF de tickets tienen MediaBox real de 58/80 mm, altura compacta y paginación uniforme en tickets largos. Reportes y arqueos conservan A4. Se guarda el nombre de caja/operador al vender.
- El build fuerza React de producción aunque el `.env` del workspace sea de desarrollo. El POS espera la consulta de caja al usar F8 temprano; los E2E esperan salud de API y frontend de forma independiente.

## Smoke de operación real en navegador

Con un comercio nuevo, producto de ARS 121 (impuesto incluido de 21%) y diez unidades iniciales:

1. Apertura con ARS 1000.
2. Cinco ventas: efectivo con vuelto, débito, crédito, QR/billetera y transferencia.
3. Transferencia inicialmente pendiente, confirmada manualmente con referencia. El pago original permanece inmutable.
4. Venta mixta: ARS 21 en efectivo y ARS 100 en transferencia.
5. Descarga de ticket PDF válido.
6. Devolución total de la primera venta: reposición y compensación de efectivo.
7. Stock resultante: **5 unidades**. Ventas netas del período: **ARS 605**.
8. Efectivo esperado: **ARS 1021**. Cierre con ARS 1020, diferencia **−ARS 1**.
9. Descarga de arqueo PDF y reporte CSV/PDF.

Ese flujo se ejecuta con `navigator.onLine=false` y bloqueo de cualquier dominio externo; los servicios locales permanecen disponibles. No hubo solicitudes externas ni errores JavaScript. Esto verifica independencia de internet, sin simular que una terminal aislada del servidor pueda confirmar ventas.

Otros E2E comprueban escaneo doble y edición del carrito, persistencia tras recarga, navegación móvil y temas, respuesta perdida después del commit sin duplicación, bloqueo por inactividad con recuperación del carrito, dos pestañas intentando cobrar el mismo borrador (**una sola venta**) y cuatro escaneos rápidos con latencia (**cuatro unidades**, un renglón).

## Instalación en contenedores

`CONTAINER_ENGINE=podman npm run test:container` construyó las imágenes tooling/runtime y usó PostgreSQL 18 en una red interna, con credenciales aleatorias temporales. Ejecutó migraciones dos veces, alta de comercio, login, cinco medios y mixto, reintento del mismo cobro, ticket PDF, devolución, control de stock, cierre, reportes CSV/PDF y dump/restauración transaccional. El runtime corre como `node`, con filesystem de sólo lectura, capacidades retiradas y sin credenciales administradoras. La prueba elimina contenedores, volúmenes, red y secretos al finalizar.

La prueba detectó y corrigió la salud prematura de PostgreSQL durante su arranque temporal por socket: ahora se espera TCP con `pg_isready -h 127.0.0.1`. El deploy compila antes de detener escritores y toma el backup final después de detenerlos, antes de migrar. El CI usa clientes PostgreSQL de su imagen para evitar un `pg_dump` de versión anterior en el runner.

Esta comprobación usa HTTP sólo en el puerto loopback de la prueba para hablar con el backend detrás del proxy; no comprueba el dominio/certificado Caddy de una instalación real.

## Integridad comprobada

- Diez reintentos simultáneos con el mismo UUID producen una sola venta y un solo movimiento de stock/efectivo.
- Dos cajas disputando la última unidad: una confirma y otra se rechaza sin stock negativo.
- Fallar el stock revierte venta, pagos, movimientos y numeración.
- SQL incompleto se rechaza al commit; stock y libros no admiten edición directa.
- Descuentos proporcionales e impuestos de tasas distintas conservan los centavos e históricos. El unitario recorre 700 descuentos para verificar invariantes y orden estable.
- Los retiros que exceden el efectivo se rechazan sin efectos. Pagos electrónicos y vuelto no inflan el efectivo esperado.
- Devolución repetida repone una sola vez. Crédito, cobranzas, recepción, pagos, ajustes y aumentos tienen protección de reintento.
- Lecturas/escrituras de otro comercio, escalada de roles, costos de cajero, turno ajeno, CSRF y sesiones vencidas se rechazan.
- Una conexión PostgreSQL inactiva terminada por el administrador no derriba Node; el pool recupera una conexión y vuelve a generar reportes.

## Evidencia y límites

Los scripts de prueba están versionados en `tests/`; el smoke de imágenes está en `scripts/container-smoke.ts`. Playwright genera capturas y trazas en `test-results/`; las auditorías del instalador y del paquete se conservan localmente en `.local/setup-audit.log`, `.local/release-audit.log` y `.local/release-final-audit.log`, sin secretos en Git. Los backups y el paquete se guardan fuera del repositorio versionado.

Se probaron las imágenes con Podman rootless. Docker/Compose no están instalados en este host; no se ejecutó su orquestación ni el proxy TLS público. Tampoco se probaron Windows nativo, impresoras físicas, cortes eléctricos destructivos del equipo, integración fiscal/bancaria real, carga prolongada ni auditoría independiente de seguridad. La opción validada es servidor Linux local, tickets comerciales y pagos registrados manualmente. Los puntos de configuración y validación de destino están identificados en el checklist del README.

No se publicaron servicios ni se ejecutó el pipeline en GitHub. El frontend compilado se comprobó en Chromium contra un servidor local de producción, incluido el paquete final extraído en una instalación nueva con puerto loopback temporal, con CSP, catálogo existente, configuración, PDF y logout persistente, sin errores JavaScript. No se sustituyen esas comprobaciones por una afirmación de certificación fiscal o compatibilidad universal de hardware.
