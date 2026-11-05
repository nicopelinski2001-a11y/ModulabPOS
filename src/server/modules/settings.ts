import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auth } from '../lib/auth.js';
import { withUser, audit } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { text } from '../../shared/domain.js';
export async function settingsRoutes(app: FastifyInstance) {
  app.patch('/api/settings', async (req) => {
    const user = auth(req, 'settings');
    const b = z
      .object({
        currency: z.literal('ARS').default('ARS'),
        tax_rate_bps: z.number().int().min(0).max(10000).default(0),
        receipt_footer: z.string().trim().max(300).default('¡Gracias por tu compra!'),
        session_idle_minutes: z.number().int().min(1).max(120).default(15),
        name: text,
        address: z.string().trim().max(250),
        tax_id: z.string().trim().max(30),
        timezone: z
          .string()
          .max(80)
          .refine((v) => {
            try {
              new Intl.DateTimeFormat('es-AR', { timeZone: v });
              return true;
            } catch {
              return false;
            }
          }, 'Zona horaria inválida'),
        allow_negative_stock: z.boolean(),
        paper_width: z.union([z.literal(58), z.literal(80)]),
      })
      .strict()
      .parse(req.body);
    return withUser(user, async (db) => {
      await db.query('SELECT id FROM tenants FOR UPDATE');
      if (
        !b.allow_negative_stock &&
        (await db.query('SELECT id FROM products WHERE stock_milli<0 LIMIT 1')).rowCount
      )
        throw new AppError(409, 'Regularizá el stock negativo antes de desactivar esta política.');
      const old = (
        await db.query(
          'SELECT name,address,tax_id,timezone,allow_negative_stock,paper_width,currency,tax_rate_bps,receipt_footer,session_idle_minutes FROM tenants',
        )
      ).rows[0];
      await db.query(
        'UPDATE tenants SET name=$1,address=$2,tax_id=$3,timezone=$4,allow_negative_stock=$5,paper_width=$6,currency=$7,tax_rate_bps=$8,receipt_footer=$9,session_idle_minutes=$10',
        [
          b.name,
          b.address,
          b.tax_id,
          b.timezone,
          b.allow_negative_stock,
          b.paper_width,
          b.currency,
          b.tax_rate_bps,
          b.receipt_footer,
          b.session_idle_minutes,
        ],
      );
      await audit(db, user, 'settings.update', user.tenant_id, { before: old, after: b });
      return { ok: true };
    });
  });
}
