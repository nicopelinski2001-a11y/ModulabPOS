import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { can, type Permission, type User } from '../../shared/domain.js';
import { pool } from './db.js';
import { config } from './config.js';
import { AppError } from './errors.js';
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const csrfToken = (token: string) =>
  createHmac('sha256', config.SESSION_SECRET).update(token).digest('hex');
declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionToken: string | null;
  }
}
export async function authenticate(req: FastifyRequest) {
  const token = req.cookies.modulab_session;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
  const {
    rows: [user],
  } = await pool.query<User>('SELECT * FROM session_lookup($1)', [tokenHash(token)]);
  if (user) {
    req.user = user;
    req.sessionToken = token;
  }
}
export function auth(req: FastifyRequest, permission?: Permission): User {
  if (!req.user) throw new AppError(401, 'Iniciá sesión para continuar.');
  if (permission && !can(req.user.role, permission))
    throw new AppError(403, 'No tenés permiso para realizar esta operación.');
  return req.user;
}
export function csrf(req: FastifyRequest) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers.origin !== config.APP_ORIGIN || req.headers['x-requested-with'] !== 'ModulabPOS')
    throw new AppError(403, 'Origen de la solicitud no autorizado.');
  if (req.url === '/api/auth/login') return;
  if (!req.user || !req.sessionToken) throw new AppError(401, 'Iniciá sesión para continuar.');
  const supplied = req.headers['x-csrf-token'];
  const expected = csrfToken(req.sessionToken);
  if (
    typeof supplied !== 'string' ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    throw new AppError(403, 'Solicitud vencida. Actualizá la página.');
}
