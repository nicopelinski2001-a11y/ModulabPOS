import { z } from 'zod';
import type { Role } from './permissions.js';
import { paymentMethods } from './payments.js';
export * from './permissions.js';
export * from './payments.js';
export * from './money.js';
export const uuid = z.string().uuid();
export const cents = z.number().int().min(0).max(1_000_000_000_000);
export const quantity = z.number().int().min(1).max(1_000_000_000);
export const text = z.string().trim().min(1).max(160);
export const productSchema = z
  .object({
    sku: text.max(50),
    barcode: z.string().trim().max(80).nullable().default(null),
    name: text,
    description: z.string().trim().max(1000).default(''),
    category: text.default('General'),
    brand: z.string().trim().max(100).default(''),
    supplier_id: uuid.nullable().default(null),
    unit: z.enum(['unit', 'kg']).default('unit'),
    price_cents: cents.min(1).max(1_000_000_000),
    cost_cents: cents.max(1_000_000_000).default(0),
    min_stock_milli: z.number().int().min(0).max(1_000_000_000).default(0),
    active: z.boolean().default(true),
  })
  .strict();
export const saleSchema = z
  .object({
    idempotency_key: uuid,
    shift_id: uuid,
    customer_id: uuid.nullable().default(null),
    discount_cents: cents.default(0),
    items: z
      .array(z.object({ product_id: uuid, qty_milli: quantity }).strict())
      .min(1)
      .max(200),
    payments: z
      .array(
        z
          .object({
            method: z.enum(paymentMethods),
            amount_cents: cents.min(1),
            tendered_cents: cents.min(1),
            status: z.enum(['manual', 'pending']).default('manual'),
          })
          .strict(),
      )
      .min(1)
      .max(7),
  })
  .strict();
export type SaleInput = z.infer<typeof saleSchema>;
export type Product = z.infer<typeof productSchema> & {
  id: string;
  stock_milli: number;
  updated_at: string;
};
export type User = {
  user_id: string;
  tenant_id: string;
  session_id: string;
  name: string;
  email: string;
  role: Role;
};
export type Tenant = {
  id: string;
  slug: string;
  name: string;
  address: string;
  tax_id: string;
  timezone: string;
  allow_negative_stock: boolean;
  paper_width: 58 | 80;
};
export type Shift = {
  id: string;
  register_id: string;
  user_id: string;
  register_name: string;
  user_name: string;
  opening_cents: number;
  expected_cents: number;
  counted_cents: number | null;
  opened_at: string;
  closed_at: string | null;
};
export type Sale = {
  id: string;
  number: number;
  shift_id: string;
  user_id: string;
  customer_id: string | null;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  change_cents: number;
  created_at: string;
  returned: boolean;
  receipt_settings: Tenant;
  user_name?: string;
  lines?: Array<{
    product_id: string;
    name: string;
    sku: string;
    unit: string;
    qty_milli: number;
    price_cents: number;
    cost_cents: number;
    total_cents: number;
  }>;
  payments?: Array<{
    method: (typeof paymentMethods)[number];
    amount_cents: number;
    tendered_cents: number;
    status: string;
  }>;
};
