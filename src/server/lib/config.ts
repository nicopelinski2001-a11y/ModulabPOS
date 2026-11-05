import { z } from 'zod';
const env = z
  .object({
    DATABASE_URL: z.string().startsWith('postgres'),
    SESSION_SECRET: z.string().min(32),
    APP_ORIGIN: z.string().url(),
    PAYMENT_PROVIDER: z.literal('manual').default('manual'),
    FISCAL_PROVIDER: z.literal('commercial').default('commercial'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().default('127.0.0.1'),
    TRUST_PROXY: z.string().optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })
  .parse(process.env);
const origin = new URL(env.APP_ORIGIN);
const localOnly =
  ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) &&
  ['localhost', '127.0.0.1', '::1'].includes(env.HOST);
if (
  !['http:', 'https:'].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash
)
  throw new Error('APP_ORIGIN debe ser un origen HTTP(S), sin ruta ni credenciales.');
if (
  env.NODE_ENV === 'production' &&
  ((origin.protocol !== 'https:' && !localOnly) ||
    /CHANGE_ME|REPLACE_WITH/.test(env.SESSION_SECRET + env.DATABASE_URL))
)
  throw new Error('Producción requiere HTTPS (o sólo loopback) y un secreto aleatorio.');
export const config = {
  ...env,
  APP_ORIGIN: origin.origin,
  secureCookies: origin.protocol === 'https:',
};
