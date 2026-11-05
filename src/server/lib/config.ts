import { z } from 'zod';
const env = z
  .object({
    DATABASE_URL: z.string().startsWith('postgres'),
    SESSION_SECRET: z.string().min(32),
    APP_ORIGIN: z.string().url(),
    PORT: z.coerce.number().default(3001),
    HOST: z.string().default('127.0.0.1'),
    TRUST_PROXY: z.string().optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })
  .parse(process.env);
if (
  env.NODE_ENV === 'production' &&
  (!env.APP_ORIGIN.startsWith('https://') || env.SESSION_SECRET.includes('CHANGE_ME'))
)
  throw new Error('Producción requiere HTTPS y un secreto aleatorio.');
export const config = { ...env, APP_ORIGIN: new URL(env.APP_ORIGIN).origin };
