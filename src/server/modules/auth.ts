import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { auth, csrfToken, tokenHash } from '../lib/auth.js';
import { pool, transaction, withUser, audit } from '../lib/db.js';
import { AppError, requireFound } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { config } from '../lib/config.js';
import { roles, uuid, text } from '../../shared/domain.js';
const fallbackHash = await hashPassword(randomBytes(32).toString('hex'));
export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const body = z
        .object({
          tenant: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-z0-9-]{3,50}$/),
          email: z.string().trim().toLowerCase().email().max(200),
          password: z.string().min(1).max(128),
        })
        .strict()
        .parse(req.body);
      const accountKey = tokenHash(`${body.tenant}:${body.email}`);
      const {
        rows: [gate],
      } = await pool.query('SELECT login_gate($1) AS allowed', [accountKey]);
      if (!gate.allowed) throw new AppError(429, 'Demasiados intentos. Esperá 15 minutos.');
      const {
        rows: [found],
      } = await pool.query('SELECT * FROM auth_lookup($1,$2)', [body.tenant, body.email]);
      const valid = await verifyPassword(body.password, found?.password_hash ?? fallbackHash);
      if (!found || !valid || !found.active) {
        req.log.warn({ event: 'login_failed', account: accountKey }, 'Acceso rechazado');
        throw new AppError(401, 'Comercio, correo o contraseña incorrectos.');
      }
      const token = randomBytes(32).toString('hex');
      await transaction(found.tenant_id, found.user_id, async (db) => {
        await db.query('DELETE FROM sessions WHERE expires_at<now()');
        await db.query(
          "INSERT INTO sessions(tenant_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
          [found.tenant_id, found.user_id, tokenHash(token)],
        );
        await db.query(
          "INSERT INTO audit_events(tenant_id,user_id,action) VALUES($1,$2,'auth.login')",
          [found.tenant_id, found.user_id],
        );
      });
      reply.setCookie('modulab_session', token, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 8 * 60 * 60,
      });
      return { ok: true };
    },
  );
  app.get('/api/auth/me', async (req) => {
    const user = auth(req);
    return withUser(user, async (db) => ({
      user,
      tenant: (
        await db.query(
          'SELECT id,slug,name,address,tax_id,timezone,allow_negative_stock,paper_width FROM tenants',
        )
      ).rows[0],
      csrf: csrfToken(req.sessionToken!),
    }));
  });
  app.post('/api/auth/logout', async (req, reply) => {
    const user = auth(req);
    await withUser(user, async (db) => {
      await db.query('DELETE FROM sessions WHERE id=$1', [user.session_id]);
      await audit(db, user, 'auth.logout', null);
    });
    reply.clearCookie('modulab_session', { path: '/' });
    return { ok: true };
  });
  app.post(
    '/api/auth/password',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req) => {
      const user = auth(req);
      const b = z
        .object({
          current_password: z.string().min(1).max(128),
          new_password: z.string().min(12).max(128),
        })
        .strict()
        .parse(req.body);
      const slug = await withUser(
        user,
        async (db) => (await db.query('SELECT slug FROM tenants')).rows[0].slug,
      );
      const {
        rows: [found],
      } = await pool.query('SELECT * FROM auth_lookup($1,$2)', [slug, user.email]);
      if (!found || !(await verifyPassword(b.current_password, found.password_hash)))
        throw new AppError(403, 'La contraseña actual es incorrecta.');
      const hash = await hashPassword(b.new_password);
      await withUser(user, async (db) => {
        await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.user_id]);
        await db.query('DELETE FROM sessions WHERE user_id=$1 AND id<>$2', [
          user.user_id,
          user.session_id,
        ]);
        await audit(db, user, 'auth.password_change', user.user_id);
      });
      return { ok: true };
    },
  );
  app.get('/api/users', async (req) => {
    const user = auth(req, 'users');
    return withUser(
      user,
      async (db) =>
        (await db.query('SELECT id,name,email,role,active,created_at FROM users ORDER BY name'))
          .rows,
    );
  });
  app.post('/api/users', async (req) => {
    const user = auth(req, 'users');
    const body = z
      .object({
        name: text,
        email: z.string().trim().toLowerCase().email().max(200),
        password: z.string().min(12).max(128),
        role: z
          .enum(roles)
          .refine(
            (r) => r !== 'owner',
            'Crear propietarios requiere el administrador de instalación.',
          ),
      })
      .strict()
      .parse(req.body);
    const hash = await hashPassword(body.password);
    return withUser(user, async (db) => {
      const {
        rows: [row],
      } = await db.query(
        'INSERT INTO users(tenant_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,active',
        [user.tenant_id, body.name, body.email, hash, body.role],
      );
      await audit(db, user, 'user.create', row.id, { role: body.role });
      return row;
    });
  });
  app.patch('/api/users/:id', async (req) => {
    const user = auth(req, 'users');
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z
      .object({ active: z.boolean(), role: z.enum(roles).refine((r) => r !== 'owner') })
      .strict()
      .parse(req.body);
    if (id === user.user_id) throw new AppError(409, 'No podés cambiar tu propio acceso.');
    return withUser(user, async (db) => {
      const target = requireFound(
        (await db.query('SELECT id,role FROM users WHERE id=$1 FOR UPDATE', [id])).rows[0],
      );
      if (target.role === 'owner')
        throw new AppError(403, 'El propietario se administra desde la instalación.');
      await db.query('UPDATE users SET active=$1,role=$2 WHERE id=$3', [b.active, b.role, id]);
      await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await audit(db, user, 'user.access', id, b);
      return { ok: true };
    });
  });
}
