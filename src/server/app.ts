import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { ZodError } from 'zod';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './lib/config.js';
import { pool } from './lib/db.js';
import { authenticate, csrf } from './lib/auth.js';
import { AppError } from './lib/errors.js';
import { AmountError } from '../shared/domain.js';
import { authRoutes } from './modules/auth.js';
import { productRoutes } from './modules/products.js';
import { cashRoutes } from './modules/cash.js';
import { salesRoutes } from './modules/sales.js';
import { contactRoutes } from './modules/contacts.js';
import { purchaseRoutes } from './modules/purchases.js';
import { reportRoutes } from './modules/reports.js';
import { settingsRoutes } from './modules/settings.js';
export async function buildApp(logging = true) {
  const app = Fastify({
    logger: logging
      ? {
          level: 'info',
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers.x-csrf-token',
            'res.headers.set-cookie',
            'password',
            'token',
          ],
        }
      : false,
    bodyLimit: 1_048_576,
    trustProxy:
      config.TRUST_PROXY?.split(',')
        .map((x) => x.trim())
        .filter(Boolean) ?? false,
    requestTimeout: 15000,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.secureCookies ? [] : null,
      },
    },
    hsts: config.secureCookies,
  });
  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      message: 'Demasiadas solicitudes. Intentá de nuevo en un minuto.',
    }),
  });
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      await authenticate(req);
      csrf(req);
    }
  });
  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok', version: '1.0.0' };
  });
  await authRoutes(app);
  await productRoutes(app);
  await cashRoutes(app);
  await salesRoutes(app);
  await contactRoutes(app);
  await purchaseRoutes(app);
  await reportRoutes(app);
  await settingsRoutes(app);
  app.setErrorHandler((error: Error & { code?: string; statusCode?: number }, req, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({
        message: error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join(' · '),
      });
      return;
    }
    if (error instanceof AmountError) {
      reply.code(400).send({ message: error.message });
      return;
    }
    if (error instanceof AppError) {
      reply.code(error.status).send({ message: error.message });
      return;
    }
    if (error.code === '23505') {
      reply.code(409).send({
        message: 'Ya existe un registro con ese código o la operación ya fue registrada.',
      });
      return;
    }
    if (error.code === '23503') {
      reply.code(404).send({ message: 'Un recurso no existe o no pertenece al comercio.' });
      return;
    }
    if (error.code === '23514') {
      const messages: Record<string, string> = {
        'Efectivo insuficiente en caja':
          'Efectivo insuficiente en caja. Registrá un ingreso o revisá el retiro.',
        'Stock insuficiente': 'Stock insuficiente. Revisá las cantidades.',
      };
      reply.code(409).send({
        message: messages[error.message] ?? 'La operación no cumple las reglas de integridad.',
      });
      return;
    }
    if (error.code === '40P01' || error.code === '40001') {
      reply
        .code(409)
        .send({ message: 'Otra operación modificó estos datos. Reintentá con la misma clave.' });
      return;
    }
    if (
      ['ECONNREFUSED', 'ECONNRESET', '57P01', '57P03', '53300', '08006', '57014'].includes(
        error.code ?? '',
      )
    ) {
      req.log.error({ err: error, requestId: req.id }, 'Base de datos no disponible');
      reply.code(503).send({
        message: 'El servidor de datos está ocupado o sin conexión. Reintentá la misma operación.',
        requestId: req.id,
      });
      return;
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      reply.code(error.statusCode).send({
        message:
          error.statusCode === 429
            ? 'Demasiadas solicitudes. Esperá antes de reintentar.'
            : 'Solicitud inválida.',
      });
      return;
    }
    req.log.error({ err: error, requestId: req.id }, 'Error de operación');
    reply.code(500).send({
      message:
        'No se pudo completar la operación. Reintentá. Si persiste, contactá al administrador.',
      requestId: req.id,
    });
  });
  if (existsSync(resolve('dist/web/index.html'))) {
    await app.register(staticFiles, { root: resolve('dist/web'), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/'))
        return reply.code(404).send({ message: 'Ruta no encontrada.' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
