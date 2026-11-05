# Verificación realizada

Fecha local: 22 de octubre de 2026 (Argentina). Entorno: Linux, Node.js 24.21.0 y PostgreSQL 18.6. Se usaron bases reales aisladas, con el rol de aplicación sin privilegios de bypass.

| Comprobación                                          | Resultado                                                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript estricto y compilación de cliente/servidor | Correctos, sin advertencias de tamaño de bundle                                                                                                    |
| Vitest unitario                                       | 12 pruebas aprobadas: aritmética, redondeo, cantidades, roles, CSV y errores de transporte                                                         |
| PostgreSQL real                                       | 20 pruebas de integración aprobadas                                                                                                                |
| Playwright / Chromium                                 | 3 pruebas aprobadas: flujo completo, móvil y respuesta de venta perdida                                                                            |
| Bundle compilado servido por Fastify                  | Login, POS, catálogo de 12 productos, configuración y logout comprobados en navegador; sin errores JavaScript; CSP presente                        |
| Backup y restauración                                 | Dump restaurado en base temporal, permisos reaplicados y RLS comprobado; 1 comercio, 12 productos, 0 ventas de evaluación y 0 diferencias de stock |
| Dependencias de producción                            | `npm audit --omit=dev`: 0 vulnerabilidades informadas                                                                                              |
| Formato                                               | Prettier aplicado; archivos de código y configuración comprobados                                                                                  |

Las pruebas de integración incluyen:

- Lectura y modificación de productos/ventas de otro comercio; consultas SQL sin contexto; referencias cruzadas rechazadas.
- Escalada de privilegios por HTTP, descuentos no autorizados, cajero sin acceso a costos, turno de otro empleado, CSRF y solicitudes sin sesión.
- Diez confirmaciones simultáneas con la misma clave: una sola venta, un movimiento de stock y un movimiento de efectivo.
- Dos cajas intentando vender la última unidad: una venta aprobada y otra rechazada sin saldo negativo.
- Reversión integral cuando falla el stock; validación de cantidades enteras, pagos y estado falsificado de acreditación.
- Pago mixto con transferencia pendiente y efectivo con vuelto: sólo el efectivo aplicado aumenta la caja.
- Devolución total repetida: una sola reposición y movimientos compensatorios, con historial protegido contra edición/borrado.
- Pedido sin efecto sobre stock y recepción simultánea idempotente; pago parcial de compra repetido.
- Límite de crédito y cobranza simultánea idempotente; importación revertida completa por SKU duplicado.
- Ajustes repetidos, saldo de stock no editable directamente, aumento porcentual masivo no duplicado.
- Rechazo de una venta SQL incompleta al confirmar la transacción, conciliación de todos los productos con el libro y cierre que bloquea ventas posteriores.

Playwright recorre la interfaz real. El caso de pérdida de respuesta deja que el servidor confirme una venta, aborta su respuesta, recarga el navegador y reintenta la intención persistida: aparecen dos ventas totales (la anterior del flujo y la recuperada), sin una tercera duplicada. Los tests usan sus propias bases y no crean ventas de muestra en el comercio de evaluación.

Se generan capturas de los temas claro/oscuro, POS y móvil en `test-results/`. El proceso compilado se dejó accesible localmente en `http://localhost:3001`, con el origen correspondiente configurado en su entorno. Para reiniciarlo así: `APP_ORIGIN=http://localhost:3001 npm start`.

No se validaron Docker/Compose (Docker no está instalado), instalación Windows, impresoras físicas, credenciales ARCA, pasarelas de pago, sincronización entre bases, pruebas de carga prolongada ni auditoría independiente de seguridad. Los archivos de CI se prepararon pero no se ejecutaron en GitHub.
