# PROYECTO: MODULAB POS — SISTEMA PROFESIONAL DE GESTIÓN COMERCIAL

## 1. TU ROL

Actuá como un equipo senior de desarrollo de software compuesto por:

- Software Architect
- Senior Full Stack Engineer
- Database Architect
- Cybersecurity Engineer
- UI/UX Product Designer
- DevOps Engineer
- QA Automation Engineer
- Especialista en sistemas POS y gestión comercial para Argentina

Tu responsabilidad es diseñar, desarrollar, probar y documentar un sistema comercial de calidad profesional, preparado para producción y para su futura comercialización como software SaaS o instalación local.

No quiero un prototipo visual, una landing page ni una demo con botones falsos.

Quiero un sistema funcional, seguro, robusto, mantenible, escalable y preparado para ser utilizado diariamente por comercios reales.

## 2. IDENTIDAD DEL PRODUCTO

Nombre del software: Modulab POS

Empresa desarrolladora: Modulab Software

Mercado inicial: Argentina.

Primer cliente objetivo: kioscos, despensas y minimercados.

Mercados futuros: almacenes, autoservicios y pequeños comercios minoristas.

Idioma: español de Argentina.

Moneda inicial: peso argentino (ARS).

Zona horaria por defecto: America/Argentina/Buenos_Aires, configurable por comercio.

El sistema debe diseñarse para soportar múltiples clientes independientes, con aislamiento estricto de sus datos.

La identidad visual debe ser moderna, elegante y profesional.

Colores sugeridos:
- Azul tecnológico.
- Celeste.
- Gris oscuro.
- Blanco.

Soportar tema oscuro y claro.

Mostrar la marca Modulab POS de manera discreta y profesional, permitiendo que el comercio incorpore su nombre y logotipo.

## 3. OBJETIVO PRINCIPAL

Desarrollar un sistema POS de uso diario extremadamente rápido, simple y confiable.

Las funcionalidades principales serán:

1. Punto de venta.
2. Gestión de productos.
3. Control de inventario.
4. Gestión de compras.
5. Gestión de proveedores.
6. Gestión de caja.
7. Control de empleados y permisos.
8. Reportes y estadísticas.
9. Clientes y cuentas corrientes.
10. Impresión de tickets.
11. Importación de información desde otros sistemas.
12. Copias de seguridad.
13. Funcionamiento offline.
14. Sincronización segura.
15. Configuración del comercio.
16. Facturación electrónica argentina mediante integración autorizada.
17. Plataforma multi-comercio.
18. Preparación para futuras suscripciones SaaS.

La prioridad absoluta es la confiabilidad operativa de ventas, stock y caja.

## 4. STACK TECNOLÓGICO

Elegí tecnologías modernas, estables, ampliamente utilizadas y con buena documentación.

Stack preferido:

Frontend:
- React.
- Next.js con App Router cuando sea apropiado.
- TypeScript estricto.
- Tailwind CSS.
- shadcn/ui.
- Radix UI.
- React Hook Form.
- Zod.
- TanStack Query.
- TanStack Table.
- Zustand solamente cuando exista necesidad real de estado global.
- Recharts para estadísticas.

Backend:
- Node.js.
- TypeScript.
- NestJS o arquitectura backend equivalente bien estructurada.

Base de datos:
- PostgreSQL.
- Prisma ORM o Drizzle ORM, justificando la selección.

Infraestructura:
- Docker y Docker Compose.
- GitHub Actions.
- Variables de entorno seguras.
- Migraciones versionadas.
- Logging estructurado.
- Monitoreo de errores.
- Backups automatizados.
- Despliegues reproducibles.

Testing:
- Vitest o Jest.
- React Testing Library.
- Playwright.
- Tests de integración con base real.
- Tests de autorización y concurrencia.

No es obligatorio utilizar exactamente todas estas tecnologías. Si una alternativa mejora significativamente el proyecto, justificá la elección.

No agregues dependencias innecesarias.

Preferí un monolito modular correctamente diseñado antes que una arquitectura de microservicios que complique el mantenimiento.

## 5. ARQUITECTURA GENERAL

El sistema debe poder comercializarse a múltiples negocios.

Diseñar una arquitectura multi-tenant segura.

Cada comercio debe tener:
- Su propia configuración.
- Sus productos.
- Sus movimientos de stock.
- Sus empleados.
- Sus cajas.
- Sus ventas.
- Sus reportes.
- Sus proveedores.
- Sus clientes.
- Sus sucursales, cuando corresponda.

Ningún usuario debe poder consultar o modificar datos de otro comercio.

Implementar aislamiento a nivel backend y base de datos, no solamente mediante filtros del frontend.

Considerar políticas de seguridad a nivel de filas de PostgreSQL cuando aporten una protección adicional verificable.

Implementar controles de autorización en todas las operaciones.

Preparar una estructura modular con dominios independientes:

- Auth
- Tenants
- Branches
- Users
- Products
- Inventory
- Purchases
- Suppliers
- Sales
- Payments
- CashRegisters
- Customers
- Reports
- Printing
- Integrations
- Auditing
- Settings
- Subscriptions

Separar lógica de negocio, acceso a datos, API y presentación.

Usar convenciones consistentes, interfaces claras y tipado estricto.

## 6. PUNTO DE VENTA — MÓDULO CRÍTICO

Este módulo debe recibir la mayor atención del proyecto.

Necesito que vender un producto sea extremadamente rápido.

Funciones:

- Buscar productos por nombre.
- Buscar por código de barras.
- Buscar por SKU.
- Escanear con lector USB que simula teclado.
- Agregar productos mediante teclado.
- Modificar cantidades.
- Eliminar productos del carrito.
- Aplicar descuentos con permisos.
- Seleccionar métodos de pago.
- Registrar pagos combinados.
- Calcular vuelto.
- Suspender y recuperar ventas.
- Cancelar ventas con autorización.
- Reimprimir comprobantes.
- Consultar ventas anteriores.
- Procesar devoluciones.
- Mostrar precio unitario, cantidad, subtotal y total.
- Mostrar advertencias por stock insuficiente.
- Soportar productos por unidad y por peso.
- Permitir ventas sin código de barras.
- Permitir productos con precio variable mediante autorización.
- Configurar políticas de stock negativo.

Métodos de pago iniciales:
- Efectivo.
- Transferencia.
- Tarjeta de débito.
- Tarjeta de crédito.
- Billetera virtual.
- Pago mixto.
- Cuenta corriente, cuando esté autorizado.

La selección de un método de pago no significa que el pago esté acreditado.

Distinguir pagos registrados manualmente, pagos pendientes y pagos verificados mediante una integración real.

Requisitos adicionales:
- Interfaz optimizada para teclado.
- Atajos de teclado configurables.
- Campo de escaneo siempre accesible.
- Feedback inmediato al agregar productos.
- Prevención de doble confirmación.
- Estados de carga claros.
- Recuperación segura ante errores.
- Excelente rendimiento incluso con catálogos grandes.

La operación de venta debe ser atómica.

Si ocurre un error al completar una venta, no deben quedar ventas parciales, pagos inconsistentes ni movimientos de inventario incorrectos.

Utilizar transacciones de base de datos y claves de idempotencia.

Diseñar pruebas para ventas simultáneas y doble escaneo.

## 7. PRODUCTOS E INVENTARIO

Cada producto debe poder contener:

- ID interno.
- Comercio propietario.
- SKU.
- Código de barras.
- Nombre.
- Descripción.
- Categoría.
- Marca.
- Proveedor principal.
- Precio de costo.
- Precio de venta.
- Margen estimado.
- Unidad de medida.
- Stock actual calculado.
- Stock mínimo.
- Estado activo/inactivo.
- Imagen opcional.
- Impuestos aplicables.
- Fecha de creación.
- Última modificación.

Funcionalidades:

- Alta de productos.
- Edición.
- Desactivación sin perder historial.
- Importación masiva.
- Exportación CSV y Excel.
- Actualización masiva de precios.
- Aumento porcentual de precios.
- Actualización por categoría o proveedor.
- Precios especiales.
- Alertas de stock bajo.
- Ajustes de inventario.
- Inventarios físicos.
- Registro de productos dañados o vencidos.
- Transferencias entre sucursales.
- Historial de movimientos.
- Control de productos duplicados.
- Soporte para múltiples códigos de barras cuando sea necesario.

No usar un simple campo editable como única fuente de verdad del stock.

Implementar un libro de movimientos de inventario auditable.

Cada venta, compra, devolución, ajuste o transferencia debe generar movimientos consistentes.

Usar unidades de precisión adecuadas y evitar errores de punto flotante.

## 8. COMPRAS Y PROVEEDORES

Crear un módulo para:

- Registrar proveedores.
- Registrar compras.
- Cargar comprobantes.
- Actualizar costos.
- Incorporar mercadería al inventario.
- Consultar historial de compras.
- Detectar aumentos de costos.
- Calcular márgenes.
- Gestionar deudas con proveedores.
- Registrar pagos parciales.
- Crear órdenes de compra.
- Consultar productos pendientes de recepción.

Las compras deben estar separadas de la recepción efectiva de mercadería.

No modificar stock hasta confirmar su recepción.

## 9. CONTROL DE CAJA

Implementar:

- Apertura de caja.
- Fondo inicial.
- Registro de ventas.
- Entradas y salidas de efectivo.
- Retiros.
- Gastos.
- Cierre de caja.
- Arqueo.
- Diferencias entre importe esperado y contado.
- Historial de turnos.
- Identificación del empleado responsable.

Soportar varias cajas por sucursal.

Evitar que dos sesiones incompatibles operen sobre el mismo turno de caja.

Distinguir efectivo físico de pagos electrónicos.

No permitir editar silenciosamente movimientos históricos.

Toda corrección debe realizarse mediante un movimiento compensatorio, con usuario, fecha, motivo y auditoría.

## 10. TICKETS E IMPRESIÓN

Este módulo es fundamental.

Muchos kioscos utilizan impresoras térmicas de 58 mm u 80 mm.

Implementar:
- Ticket configurable.
- Nombre del comercio.
- Dirección.
- Datos comerciales.
- Fecha y hora.
- Número de operación.
- Productos.
- Cantidades.
- Precios.
- Descuentos.
- Total.
- Forma de pago.
- Vuelto.
- Identificación de caja.
- Reimpresión.
- Vista previa.
- Diseño para rollos de 58 y 80 mm.

Diseñar una abstracción de impresión con diferentes adaptadores.

Compatibilidades a evaluar:
- Impresión desde navegador.
- Impresoras térmicas compatibles ESC/POS.
- Servicio local de impresión.
- Impresoras USB, red o Bluetooth, según soporte real.

No asumir que una aplicación web alojada remotamente puede acceder directamente a cualquier impresora USB.

Evaluar la necesidad de un agente local instalable para impresión silenciosa y controlada.

Evitar dependencias de servicios externos pagos si existe una alternativa confiable.

Diferenciar claramente un ticket comercial de un comprobante fiscal válido.

Nunca generar un comprobante con apariencia de factura electrónica autorizada si ARCA no lo autorizó.

## 11. CLIENTES Y CUENTAS CORRIENTES

Crear:

- Registro de clientes.
- Historial de compras.
- Datos de contacto.
- Saldo de cuenta corriente.
- Límites de crédito.
- Registro de pagos.
- Abonos parciales.
- Deudas pendientes.
- Vencimientos.
- Historial de movimientos.
- Reportes de cobranza.

Los saldos deben surgir de movimientos financieros consistentes.

No permitir modificar deudas históricas de forma silenciosa.

## 12. REPORTES Y ESTADÍSTICAS

Crear un dashboard profesional.

Métricas:
- Ventas de hoy.
- Ventas semanales.
- Ventas mensuales.
- Cantidad de operaciones.
- Ticket promedio.
- Ingresos por método de pago.
- Productos más vendidos.
- Categorías más vendidas.
- Rentabilidad estimada.
- Márgenes.
- Stock valorizado.
- Mercadería de baja rotación.
- Productos por reponer.
- Rendimiento por empleado.
- Rendimiento por sucursal.
- Diferencias de caja.
- Evolución de ventas.
- Comparación entre períodos.

Permitir filtros de fecha, sucursal, vendedor y categoría.

Exportación a CSV y Excel.

Cuando corresponda, exportación PDF.

Definir correctamente cada métrica.

Distinguir ingresos, ventas brutas, ventas netas, costos y ganancias estimadas.

Utilizar criterios consistentes para devoluciones, descuentos y anulaciones.

## 13. USUARIOS, ROLES Y PERMISOS

Roles iniciales:

SUPERADMIN DE MODULAB:
Administra el servicio SaaS, comercios, suscripciones y soporte autorizado.

PROPIETARIO:
Control completo sobre su propio comercio.

ADMINISTRADOR:
Acceso operativo amplio según permisos.

CAJERO:
Ventas y operaciones autorizadas de caja.

REPOSITOR:
Gestión limitada de inventario.

Permisos configurables.

Aplicar mínimo privilegio.

Un usuario no debe obtener más privilegios manipulando peticiones HTTP, IDs o parámetros del frontend.

Todas las acciones sensibles deben validarse en el servidor.

La plataforma de Modulab no debe tener acceso irrestricto por defecto a información privada de todos los comercios.

Diseñar accesos de soporte temporales, autorizados, limitados y auditados.

## 14. SEGURIDAD INFORMÁTICA

Tomar como referencia OWASP ASVS 5.0, especialmente los controles pertinentes al nivel 2 para un sistema comercial.

Implementar:

- Autenticación segura.
- Hashing de contraseñas con Argon2id o alternativa apropiada.
- Protección frente a fuerza bruta.
- Rate limiting.
- Gestión segura de sesiones.
- Cookies HttpOnly, Secure y SameSite cuando corresponda.
- Protección CSRF cuando corresponda.
- Prevención de XSS.
- Prevención de SQL injection.
- Validación estricta de entradas.
- Validación y autorización en backend.
- Protección contra IDOR/BOLA.
- Control de permisos por recurso.
- Gestión segura de archivos subidos.
- CORS restrictivo.
- Cabeceras de seguridad.
- Política CSP adecuada.
- HTTPS obligatorio en producción.
- Manejo seguro de secretos.
- Registro de eventos de seguridad.
- Protección contra enumeración de usuarios.
- Rotación y revocación de sesiones.
- Auditoría de acciones administrativas.
- Protección frente a abuso de endpoints.
- Análisis de dependencias vulnerables.
- Escaneo de secretos.
- Manejo seguro de errores.

No exponer stack traces, credenciales ni información sensible a usuarios finales.

No colocar claves privadas ni credenciales de base de datos en el frontend.

Preparar MFA para administradores y propietarios.

Implementar comprobaciones automáticas de aislamiento multi-tenant.

Crear tests específicos para intentar acceder a ventas y productos de otros comercios.

## 15. INTEGRIDAD DE DATOS Y CONCURRENCIA

Las ventas, pagos, caja y stock deben ser consistentes bajo concurrencia.

Implementar:

- Transacciones.
- Constraints de base de datos.
- Índices apropiados.
- Idempotencia.
- Control de concurrencia.
- Estados de negocio explícitos.
- Historial inmutable donde corresponda.
- Reintentos controlados.
- Manejo de errores de red.
- Operaciones compensatorias.
- Prevención de duplicados.

Usar decimal exacto o unidades monetarias enteras con una política de redondeo documentada.

Nunca utilizar cálculos monetarios críticos basados en números flotantes de JavaScript.

Las operaciones financieras deben ser auditables.

## 16. FUNCIONAMIENTO OFFLINE

Un kiosco no puede detener todas sus ventas simplemente porque se corta internet.

Evaluar e implementar una arquitectura local-first adecuada.

Requisitos:
- Operaciones de venta disponibles sin conexión.
- Base local persistente y protegida.
- Cola de operaciones pendientes.
- IDs globalmente únicos.
- Sincronización al recuperar conectividad.
- Control de conflictos.
- Prevención de ventas duplicadas.
- Recuperación ante cierre inesperado.
- Visualización clara del estado de sincronización.

No asumir que una PWA y un service worker por sí solos resuelven correctamente un POS offline.

Evaluar una aplicación de escritorio con Tauri, un agente local o una arquitectura híbrida si es la alternativa más confiable.

Priorizar una solución realista para computadoras Windows de pequeños comercios.

No almacenar claves fiscales ni secretos sensibles innecesariamente en almacenamiento del navegador.

No prometer sincronización automática libre de conflictos si no está implementada y probada.

Documentar cómo se resuelven conflictos de inventario y operaciones entre múltiples cajas desconectadas.

## 17. MIGRACIÓN DESDE ARONIUM Y OTROS SISTEMAS

Incorporar un asistente de migración.

Debe permitir importar:

- Productos.
- Códigos de barras.
- Precios.
- Costos.
- Categorías.
- Stock inicial