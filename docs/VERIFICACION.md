# Verificación de entrega · 5 de noviembre de 2026

Entorno: Linux, Node.js 24.21.0, PostgreSQL 18.6 y Chromium mediante Playwright. Fecha de referencia: Argentina. Las pruebas financieras usan bases nuevas `modulab_test_*`, eliminadas al finalizar; no crean ventas en el comercio del workspace.

## Resultados

| Comprobación                       | Resultado                                                                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`                   | Aprobado: lint, formato, tipos, unitarios, build, integración y E2E                                                                                                                                                                                        |
| ESLint                             | Sin errores ni warnings                                                                                                                                                                                                                                    |
| Prettier                           | Archivos comprobados                                                                                                                                                                                                                                       |
| TypeScript                         | Cliente, servidor, scripts y tests con tipado estricto                                                                                                                                                                                                     |
| Unitarios Vitest                   | **16 aprobados**; dinero, cantidades, permisos, transporte, CSV e impuestos/descuentos                                                                                                                                                                     |
| PostgreSQL real                    | **26 aprobados**; atomicidad, concurrencia, roles, RLS, stock, caja, crédito, compras, impuestos, conciliación y recuperación de conexión                                                                                                                  |
| Chromium E2E                       | **7 aprobados**, incluyendo smoke de todos los medios, devolución, cierre y reportes                                                                                                                                                                       |
| Dependencias                       | `npm audit`: **0 vulnerabilidades**, incluido desarrollo                                                                                                                                                                                                   |
| Migración de instalación existente | Tres migraciones nuevas aplicadas, seis en total; se preservaron 12 productos y una venta previa                                                                                                                                                           |
| Backup anterior a migración        | Restaurado en base temporal y actualizado; 1 comercio, 12 productos, 1 venta, **0 diferencias de stock**                                                                                                                                                   |
| Backup posterior a migración       | Restaurado y permisos/RLS verificados; mismos conteos, **0 diferencias de stock**                                                                                                                                                                          |
| Backup manipulado                  | Rechazado por SHA256 antes de conectar/restaurar                                                                                                                                                                                                           |
| Instalación nueva aislada          | Setup, segundo pase sin cambiar secretos, producción en loopback, login, dos cajas y backup restaurado correctos                                                                                                                                           |
| Paquete distribuible               | SHA256 y lista de archivos comprobados, sin secretos/base/backups; extracción en directorio nuevo, `npm ci` limpio, setup repetido, login de producción, recuperación de contraseña con rechazo de la anterior y revocación de sesiones, backup restaurado |
| Servicios Linux                    | Generación `--preview` verificada sin activar servicios en el host                                                                                                                                                                                         |
| Shell y repositorio                | `bash -n` de backup/deploy y `git diff --check` correctos; versiones package/lock coherentes                                                                                                                                                               |

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

Los scripts de prueba están versionados en `tests/`. Playwright genera capturas y trazas en `test-results/`; las auditorías del instalador y del paquete se conservan localmente en `.local/setup-audit.log` y `.local/release-audit.log`, sin secretos en Git. Los backups y el paquete se guardan fuera del repositorio versionado.

No se ejecutaron contenedores Docker/Compose: Docker no está instalado en este host. Tampoco se probaron Windows nativo, impresoras físicas, cortes eléctricos destructivos del equipo, integración fiscal/bancaria real, carga prolongada ni auditoría independiente de seguridad. La opción validada es servidor Linux local, tickets comerciales y pagos registrados manualmente. Los puntos de configuración y validación de destino están identificados en el checklist del README.

No se publicaron servicios ni se ejecutó el pipeline en GitHub. El frontend compilado se comprobó en Chromium contra el servidor local de producción (`http://localhost:3001`), con CSP, catálogo existente, configuración, PDF y logout persistente, sin errores JavaScript. No se sustituyen esas comprobaciones por una afirmación de certificación fiscal o compatibilidad universal de hardware.
