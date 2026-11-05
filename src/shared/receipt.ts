import { z } from 'zod';
import { cents, quantity, uuid, type Sale, type SaleInput } from './domain.js';
import { paymentMethods } from './payments.js';
import { lineTotal, sumMoney } from './money.js';

const receiptSchema = z
  .object({
    id: uuid,
    operation_key: uuid,
    number: z.number().int().positive().safe(),
    shift_id: uuid,
    user_id: uuid,
    customer_id: uuid.nullable(),
    subtotal_cents: cents.min(1),
    discount_cents: cents,
    total_cents: cents.min(1),
    tax_cents: cents,
    change_cents: cents,
    created_at: z.iso.datetime({ offset: true }),
    returned: z.boolean(),
    user_name: z.string().min(1).max(160),
    receipt_settings: z
      .object({
        id: uuid,
        name: z.string().min(1).max(160),
        address: z.string().max(250),
        tax_id: z.string().max(30),
        timezone: z
          .string()
          .max(80)
          .refine((value) => {
            try {
              new Intl.DateTimeFormat('es-AR', { timeZone: value });
              return true;
            } catch {
              return false;
            }
          }),
        paper_width: z.union([z.literal(58), z.literal(80)]),
        currency: z.literal('ARS').optional(),
        tax_rate_bps: z.number().int().min(0).max(10000).optional(),
        receipt_footer: z.string().max(300).optional(),
        register_name: z.string().max(160).optional(),
        operator_name: z.string().max(160).optional(),
      })
      .passthrough(),
    lines: z
      .array(
        z
          .object({
            product_id: uuid,
            name: z.string().min(1).max(160),
            sku: z.string().min(1).max(50),
            unit: z.enum(['unit', 'kg']),
            qty_milli: quantity,
            price_cents: cents.min(1),
            cost_cents: cents.optional(),
            total_cents: cents.min(1),
            discount_cents: cents,
            tax_rate_bps: z.number().int().min(0).max(10000),
            tax_cents: cents,
          })
          .passthrough(),
      )
      .min(1)
      .max(200),
    payments: z
      .array(
        z
          .object({
            method: z.enum(paymentMethods),
            amount_cents: cents.min(1),
            tendered_cents: cents.min(1),
            status: z.enum(['manual', 'pending']),
          })
          .passthrough(),
      )
      .min(1)
      .max(7),
  })
  .passthrough();

/** A 200 response is not a receipt until it matches the persisted operation.
 * Never discard a pending key on malformed or unrelated success JSON. */
export function parseSaleConfirmation(value: unknown, intent: SaleInput, userId: string): Sale {
  const sale = receiptSchema.parse(value);
  if (
    sale.operation_key !== intent.idempotency_key ||
    sale.shift_id !== intent.shift_id ||
    sale.user_id !== userId ||
    sale.customer_id !== intent.customer_id ||
    sale.discount_cents !== intent.discount_cents ||
    sale.total_cents !== sumMoney(intent.payments.map((p) => p.amount_cents)) ||
    sale.total_cents !== sale.subtotal_cents - sale.discount_cents ||
    sale.lines.length !== intent.items.length ||
    new Set(sale.lines.map((l) => l.product_id)).size !== sale.lines.length ||
    sale.payments.length !== intent.payments.length ||
    new Set(sale.payments.map((p) => p.method)).size !== sale.payments.length
  )
    throw new Error('La confirmación no corresponde a esta operación.');
  for (const line of sale.lines) {
    const wanted = intent.items.find((item) => item.product_id === line.product_id);
    if (
      !wanted ||
      line.qty_milli !== wanted.qty_milli ||
      line.total_cents !== lineTotal(line.price_cents, line.qty_milli) ||
      (line.unit === 'unit' && line.qty_milli % 1000 !== 0) ||
      line.discount_cents > line.total_cents ||
      line.tax_cents > line.total_cents - line.discount_cents
    )
      throw new Error('Los renglones de la confirmación no coinciden.');
  }
  for (const payment of sale.payments) {
    const wanted = intent.payments.find((p) => p.method === payment.method);
    if (
      !wanted ||
      payment.amount_cents !== wanted.amount_cents ||
      payment.tendered_cents !== wanted.tendered_cents ||
      (wanted.status === 'manual' && payment.status !== 'manual')
    )
      throw new Error('Los pagos de la confirmación no coinciden.');
  }
  if (
    sale.subtotal_cents !== sumMoney(sale.lines.map((l) => l.total_cents)) ||
    sale.tax_cents !== sumMoney(sale.lines.map((l) => l.tax_cents)) ||
    sale.change_cents !== sumMoney(sale.payments.map((p) => p.tendered_cents - p.amount_cents)) ||
    (sale.receipt_settings.currency &&
      sale.discount_cents !== sumMoney(sale.lines.map((l) => l.discount_cents)))
  )
    throw new Error('Los importes de la confirmación no coinciden.');
  return sale;
}
