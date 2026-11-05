# Seguridad: controles y límites

Referencia de diseño: controles pertinentes de OWASP ASVS nivel 2 y guías OWASP. **No se declara certificación, auditoría independiente ni conformidad completa con ASVS 5.0.**

| Control              | Aplicación concreta                                                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hash de contraseña   | scrypt asíncrono nativo de Node, N=131072, r=8, p=1, salt aleatorio de 128 bits y salida de 64 bytes; alternativa memory-hard a Argon2id sin binarios externos                                                    |
| Credenciales         | Mínimo 12 caracteres al alta/cambio, máximo 128; sin contraseña predeterminada; comparación de hash en tiempo constante                                                                                           |
| Sesión               | Token opaco de 256 bits, sólo hash SHA-256 en base, 8 horas, validación de usuario activo en cada solicitud; logout y revocación al cambiar acceso; cambio de contraseña revoca otras sesiones                    |
| Cookie               | HttpOnly, SameSite=Strict, path=/, Secure en producción; no se guarda en localStorage                                                                                                                             |
| Fuerza bruta         | Cuota global por IP y cuota de login más restrictiva; contador persistente por comercio/correo. Respuesta genérica de credenciales; hash ficticio evita omitir el costo de derivación cuando no existe el usuario |
| CSRF                 | Origen exacto y cabecera de aplicación en todas las mutaciones; token HMAC ligado a sesión, comparación constante. Login también verifica origen                                                                  |
| CORS                 | No se habilita acceso entre orígenes; cliente y API comparten origen                                                                                                                                              |
| XSS                  | React escapa nombres, etiquetas y tickets; sin HTML arbitrario. CSP restringida a origen propio, objetos y framing bloqueados; estilos inline permitidos para gráficos/componentes                                |
| SQL injection        | Valores por parámetros de node-postgres; columnas dinámicas sólo provienen de esquema Zod estricto; sin SQL del usuario                                                                                           |
| IDOR / BOLA          | Tenant desde sesión, RLS forzado, referencias compuestas, validación de permisos de cada mutación y propiedad del turno; pruebas de otros comercios por HTTP y SQL                                                |
| Menor privilegio     | Runtime no propietario/superusuario/BYPASSRLS, columna stock no editable; no puede leer hashes de `users` por SELECT; cajero no recibe costos en API de catálogo o detalle de venta                               |
| Integridad           | Transacciones, bloqueos, UUID, clave+hash para ventas/comandos, constraints y triggers diferidos. Libros inmutables, movimientos compensatorios, permisos de actualización restringidos                           |
| Datos externos       | CSV hasta 1 MB y 500 productos, validación y transacción; sin ejecución de fórmulas ni subida de archivos al servidor. Exportación neutraliza prefijos de fórmulas                                                |
| Recursos             | Body hasta 1 MB, máximo 200 líneas por venta/compra, consultas paginadas, límites de fecha/importes/cantidades, pool y statement timeout                                                                          |
| HTTPS                | Obligatorio al arrancar con NODE_ENV=production; CSP, HSTS y headers por Helmet; Compose ofrece proxy Caddy                                                                                                       |
| Secretos             | `.env` ignorado, sin secretos en frontend ni imagen; cuenta migradora separada. Docker runtime no recibe credencial administradora                                                                                |
| Auditoría / errores  | Accesos y acciones sensibles en tabla inmutable; logs JSON sin cookies/tokens/cuerpos; errores de servidor sin stack al usuario                                                                                   |
| Cadena de suministro | Lockfile, npm ci, npm audit en CI, job gitleaks; dependencias reducidas                                                                                                                                           |

## Pendientes antes de producción comercial

- MFA de propietarios/administradores, recuperación de contraseña y rotación de acceso de instalación.
- Revisión independiente de autorización por recurso, pruebas de penetración, validación de carga y matriz ASVS con evidencia por control.
- Alertas de seguridad, límites distribuidos en despliegues de varios procesos, política y limpieza periódica de contadores de login, auditoría y sesiones vencidas. El rate limit en memoria es por proceso; el de cuenta de login persiste en PostgreSQL.
- La función de autenticación y su propietario privilegiado deben revisarse durante hardening de PostgreSQL. Limitar acceso de red a la base y nunca distribuir esa cuenta a terminales.
- Cifrado de disco/volúmenes/backups, protección de endpoints Windows y autenticación de administradores del host. El navegador guarda borradores y la intención de cobro en claro para recuperación; se requieren cuentas de sistema protegidas y no compartir perfil entre personas ajenas al comercio.
- Evaluación real de restauración en el hardware del comercio, apagados, degradación de disco y actualización de servicios. El backup local no reemplaza una copia externa.
- Permisos individuales configurables y soporte SaaS temporal autorizado; hoy no existen rutas de soporte ni lectura cross-tenant de plataforma.
- Sin carga de fotos/adjuntos: no hay una superficie de archivos que se declare saneada sin implementarla.
- No hay secretos fiscales, integraciones de pagos ni procesamiento de tarjetas. Los registros manuales no certifican acreditación.

Reportar un incidente al administrador de la instalación/Modulab Software por el canal contratado. No hay envío automático de información comercial ni mensajería a terceros desde la aplicación.
