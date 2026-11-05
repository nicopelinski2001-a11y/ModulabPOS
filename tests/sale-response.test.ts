import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseSaleConfirmation } from '../src/shared/receipt';
import { confirmSale } from '../src/web/sale-client';
import { saleSchema } from '../src/shared/domain';
const id = '12345678-1234-4123-8123-123456789012';
const intent = saleSchema.parse({
  idempotency_key: id,
  shift_id: id,
  items: [{ product_id: id, qty_milli: 1000 }],
  payments: [{ method: 'cash', amount_cents: 12100, tendered_cents: 20000 }],
});
const receipt = () => ({
  id,
  operation_key: id,
  number: 1,
  shift_id: id,
  user_id: id,
  customer_id: null,
  subtotal_cents: 12100,
  discount_cents: 0,
  total_cents: 12100,
  tax_cents: 2100,
  change_cents: 7900,
  created_at: '2026-11-05T12:00:00.000Z',
  returned: false,
  user_name: 'Cajero',
  receipt_settings: {
    id,
    name: 'Kiosco',
    address: '',
    tax_id: '',
    timezone: 'America/Argentina/Buenos_Aires',
    paper_width: 58,
    currency: 'ARS',
  },
  lines: [
    {
      product_id: id,
      name: 'Producto',
      sku: 'P1',
      unit: 'unit',
      qty_milli: 1000,
      price_cents: 12100,
      total_cents: 12100,
      discount_cents: 0,
      tax_rate_bps: 2100,
      tax_cents: 2100,
    },
  ],
  payments: [{ method: 'cash', amount_cents: 12100, tendered_cents: 20000, status: 'manual' }],
});
afterEach(() => vi.unstubAllGlobals());
describe('Confirmación financiera vinculada a la intención persistida', () => {
  it('acepta el ticket completo sin exponer costo al cajero', () => {
    expect(parseSaleConfirmation(receipt(), intent, id).total_cents).toBe(12100);
  });
  it('rechaza JSON de éxito incompleto, ajeno o con importes inconsistentes', () => {
    const other = 'aaaaaaaa-1234-4123-8123-123456789012';
    for (const value of [
      { ok: true },
      null,
      { ...receipt(), operation_key: other },
      { ...receipt(), user_id: other },
      { ...receipt(), total_cents: 100 },
      { ...receipt(), change_cents: 0 },
      { ...receipt(), lines: [{ ...receipt().lines[0], qty_milli: 2000 }] },
    ])
      expect(() => parseSaleConfirmation(value, intent, id)).toThrow();
  });
  it('trata un 200 JSON inválido como resultado ambiguo que conserva la clave', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })));
    await expect(confirmSale(intent, id)).rejects.toMatchObject({ status: 502 });
  });
});
