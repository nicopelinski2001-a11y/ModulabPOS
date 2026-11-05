# Instalación, operación y recuperación

## Desarrollo y configuración

`.env.example` describe las variables; copiarlo a `.env` y generar secretos independientes. No reutilizar los valores ilustrativos ni versionar `.env`. El servidor importa sólo `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN`, `PORT`, `HOST`, `NODE_ENV` `TRUST_PROXY` y los selectores de adaptadores locales `PAYMENT_PROVIDER`/`FISCAL_PROVIDER`. El proceso runtime no usa `ADMIN_DATABASE_URL`; Docker no le entrega esa variable. En instalación nativa el archivo privado .env también lo usan las herramientas administrativas y debe protegerse a nivel del equipo.

Usar PostgreSQL 18 con `pgcrypto` y `pg_trgm`. La identidad de migraciones debe poder crear roles/extensiones y poseer las funciones definidoras con BYPASSRLS. En esta distribución se utiliza la cuenta administradora de instalación. El rol runtime es `modulab_app`; el migrador lo configura sin SUPERUSER, BYPASSRLS, CREATEDB ni CREATEROLE. Debe ser un rol exclusivo de este sistema.

El migrador usa bloqueo asesor global y checksum SHA-256 de cada SQL. No editar una migración aplicada: añadir otra. Las migraciones fallidas se revierten. Se conserva el registro en `modulab_meta.migrations`, sin acceso concedido al runtime. Antes de actualizar una instalación real: backup verificado y ensayo de migración sobre una restauración.

Node 24 ejecuta scripts con `--env-file-if-exists=.env`; variables ya definidas por el entorno tienen precedencia. Los secretos se entregan por variables protegidas o un gestor de secretos en operación administrada.

## Docker Compose

Se incluye una configuración reproducible, **aún no ejecutada en este entorno porque Docker no está instalado**. Validar imágenes, permisos de volúmenes, healthchecks, certificados y ciclo de actualización antes del piloto.

```bash
cp .env.docker.example .env.docker
# Editar secretos (hex aleatorio) y dominio/origen HTTPS.
npm run deploy
```

Servicios: PostgreSQL con volumen persistente, migrador de una ejecución, app sin privilegios con filesystem de sólo lectura, backup diario y Caddy opcional. El puerto PostgreSQL no se publica. La app se publica sólo en `127.0.0.1:3001`; las terminales acceden por el proxy HTTPS. Caddy requiere DNS y conectividad adecuados para obtener certificados públicos; una instalación LAN puede usar certificados internos confiados por las terminales y una configuración de proxy adaptada.

Crear el primer comercio con el contenedor de herramientas, sin activar el seed:

```bash
# OWNER_PASSWORD definido en el entorno por un medio protegido.
docker compose --env-file .env.docker run --rm \
  -e OWNER_PASSWORD migrate scripts/create-tenant.ts \
  mi-comercio 'Mi comercio' propietario@comercio.com
```

No publicar directamente Vite o PostgreSQL a internet. Para acceder desde varias PCs, configurar DNS/hosts del comercio, HTTPS y firewall hacia la LAN. `APP_ORIGIN` debe ser la URL exacta usada por todas las terminales. No establecer `trustProxy=true` para cualquier origen; `TRUST_PROXY` admite una lista de IP/CIDR de proxies controlados. Por defecto no se confía en cabeceras proxy. Sin configurar esa lista, las cuotas por IP se comparten entre usuarios detrás del proxy; la cuota persistente por cuenta sigue siendo individual.

## Windows y funcionamiento sin internet

La opción implementada es un **servidor local compartido**: PostgreSQL + Node en una computadora del comercio; las cajas usan navegador en la misma máquina o en LAN. Un corte del proveedor de internet no interrumpe las operaciones manuales mientras ese servidor y la LAN sigan funcionando. No se descargan fuentes, scripts o estilos de CDN.

Windows puede usar Docker Desktop con WSL2 en un equipo compatible, o Node 24 y PostgreSQL instalados como servicios con cuentas restringidas. El instalador y el servicio/timer incluidos se dirigen a Linux. Windows usa Docker Desktop con WSL2 o instalación administrada; no se incluyen un MSI firmado, servicio Windows nativo ni agente Tauri. Validar consumo de recursos en el hardware del cliente. Recomendada una UPS para el servidor y una política de backup fuera del disco principal.

Si se corta la LAN, se apaga el servidor o la caja no puede alcanzarlo, **no se confirma una venta nueva**. El carrito se conserva en el navegador y la pantalla informa la falta de conexión al intentar operar. Si una venta llegó al servidor pero se perdió su respuesta, el reintento reutiliza la misma clave y recupera la venta existente. No borrar el almacenamiento del navegador con una operación pendiente.

Cajas desconectadas de una misma base no pueden producir conflictos de stock porque no confirman ventas independientes. Para habilitar múltiples bases offline en el futuro harán falta outbox duradera, IDs globales, firma/vinculación de terminal, orden de aplicación, conciliación de efectivo y política de stock sobrevendido; no hay un sincronizador ficticio en esta versión.

## Backup

Con herramientas PostgreSQL 18 instaladas:

```bash
npm run backup
```

Usa `pg_dump -Fc`, permisos de archivo 0600/umask 077, archivo temporal, validación de catálogo mediante `pg_restore --list`, nombre único y SHA-256. La contraseña se pasa en el entorno del proceso hijo, no en los argumentos. `BACKUP_DIR` configura el destino, por defecto `backups/`. El contenedor de backups hace una copia cada 24 h; para una instalación nativa programar el comando con systemd timer, cron o Programador de tareas. La zona de las etiquetas de backup es UTC.

Por defecto no se eliminan backups. `BACKUP_RETENTION_DAYS` permite configurar un mínimo de siete días, y sólo se limpia después de completar una copia nueva. El timer Linux de `npm run service:install` programa el backup diario; el contenedor tiene healthcheck de antigüedad de la última copia y reintenta en 60 segundos si falla. Un volumen de Docker en el mismo disco **no es protección ante pérdida del equipo**: copiar una copia cifrada a otro dispositivo/ubicación. Cifrado de volumen y gestión de claves quedan a cargo de la operación. Los dumps contienen datos de todos los comercios de esa instalación y requieren permisos de administrador.

## Verificar una restauración

```bash
npm run backup:verify -- backups/archivo.dump
```

Primero comprueba el `.sha256` junto al archivo y rechaza copias alteradas. Crea una base temporal `modulab_restore_test_*`, restaura todo en una transacción, aplica migraciones pendientes y permisos, compara stock contra sus movimientos y comprueba que el runtime sin contexto no vea productos. Informa conteos y elimina únicamente esa base temporal. No sobreescribe la base del comercio.

Para recuperar una instalación real: detener accesos, conservar una copia de la base dañada, verificar el dump y su checksum, restaurar en **una base nueva vacía**, aplicar migraciones/permisos y cambiar la conexión sólo tras validar ventas, movimientos y saldos. Ensayar este procedimiento antes del piloto. No ejecutar `pg_restore --clean` contra la base activa por comodidad.

## Impresoras y comprobantes

El adaptador de impresión física usa `window.print()`; hay descarga directa de PDF desde el servidor como fallback. Instalar el driver Windows del modelo real y elegir papel de 58/80 mm, escala 100%, sin cabeceras/pies de navegador, márgenes mínimos. La vista previa adapta el ancho; el tamaño físico exacto depende del driver. No se afirma compatibilidad de hardware sin probar el dispositivo. Una impresora USB accesible por Windows puede usarse a través de ese diálogo; el servidor remoto no obtiene acceso USB directo.

La impresión silenciosa requiere otro adaptador y un agente local autenticado, con lista de dispositivos y orígenes autorizados, límites de trabajos y actualización segura. No está implementado. El ticket declara “NO VÁLIDO COMO FACTURA”. No se imprime CAE, QR fiscal ni identidad de comprobante autorizado.

## Observabilidad y actualizaciones

Fastify registra JSON por stdout, identifica solicitudes y oculta cookies/tokens. Los errores inesperados incluyen identificador de solicitud al usuario y detalle sólo en logs del operador. No registra cuerpos con contraseñas. `GET /api/health` comprueba conexión de base sin devolver credenciales ni métricas comerciales. No hay envío a servicios de monitoreo de terceros.

Compose incluye rotación de logs JSON (3 archivos de 10 MB por servicio) y systemd usa journal. En producción configurar alertas por healthcheck, disco y fallos de backup; supervisión de procesos y reloj sincronizado del servidor. Las fechas se guardan como `timestamptz` y se presentan en la zona configurada del comercio. Las migraciones y comandos financieros deben ejecutarse sobre el primario.

CI prepara Node 24 y PostgreSQL real, compila, prueba integración y navegador, escanea dependencias y secretos. La ejecución local se registra en [VERIFICACION.md](VERIFICACION.md). El pipeline no se ejecutó en GitHub ni se publicó ningún servicio desde este workspace.

## Actualización y restauración paso a paso

1. Hacer backup y `npm run backup:verify -- RUTA.dump`. Conservar el archivo `.sha256`, el paquete anterior y `.env` por separado.
2. En nativo: detener `systemctl --user stop modulab-pos`, instalar archivos nuevos conservando `.env`, `.local` y backups, ejecutar `npm ci`, `npm run db:migrate` y `npm run build`. Reiniciar el servicio. En Docker usar `npm run deploy`, que detiene escritores y guarda copia antes de migrar.
3. Comprobar salud, login, catálogo y caja en el nuevo binario. No vender por un servidor viejo sobre un esquema nuevo. Una migración aplicada nunca se edita ni se elimina del registro.
4. Para restaurar, mantener el POS detenido. Con la cuenta de instalación, crear una **base nueva** vacía, restaurar el dump con `pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname=NUEVA_BASE RUTA.dump`. Proporcionar autenticación mediante `.pgpass` privado o entorno, sin contraseña en argumentos.
5. Apuntar temporalmente `ADMIN_DATABASE_URL` y `DATABASE_URL` a esa base nueva, mantener la contraseña runtime original y ejecutar `npm run db:migrate` para reaplicar permisos/extensiones y las migraciones faltantes. Confirmar conciliación de stock/libro, ventas y saldos como hace `backup:verify`.
6. Cambiar la configuración del POS sólo después de esa validación y arrancar. Conservar la base previa para investigación; no usar `--clean` ni borrar la original como parte del procedimiento.

Las migraciones son hacia adelante. Volver al binario anterior exige restaurar la copia compatible y evaluar operaciones posteriores con el responsable; el script no descarta ventas automáticamente. El backup no incluye la configuración: mantener una copia segura de `.env` y credenciales fuera del equipo.
