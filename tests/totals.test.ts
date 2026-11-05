import { describe, expect, it } from 'vitest';
import { saleTotals } from '../src/shared/totals';
import { serializeCsv } from '../src/shared/csv';

describe('Precios finales, impuestos y descuentos', () => {
  it('extrae impuesto después de distribuir descuentos entre tasas diferentes', () => {
    const result = saleTotals(
      [
        { id: 'a', price_cents: 12100, qty_milli: 1000, tax_rate_bps: 2100 },
        { id: 'b', price_cents: 11050, qty_milli: 1000, tax_rate_bps: 1050 },
      ],
      2315,
    );
    expect(result).toMatchObject({
      subtotal_cents: 23150,
      total_cents: 20835,
      tax_cents: 2835,
      net_cents: 18000,
    });
    expect(result.lines.map((l) => l.discount_cents)).toEqual([1210, 1105]);
  });
  it('conserva cada centavo con pesos, varios impuestos y descuentos difíciles', () => {
    for (let discount = 0; discount < 700; discount++) {
      const input = [
        { id: 'a', price_cents: 12345, qty_milli: 333, tax_rate_bps: 2100 },
        { id: 'b', price_cents: 555, qty_milli: 1000, tax_rate_bps: 0 },
        { id: 'c', price_cents: 9999, qty_milli: 700, tax_rate_bps: 1050 },
      ];
      const result = saleTotals(input, discount);
      expect(result.lines.reduce((n, l) => n + l.discount_cents, 0)).toBe(discount);
      expect(result.net_cents + result.tax_cents).toBe(result.total_cents);
      expect(result.total_cents).toBe(result.subtotal_cents - discount);
      expect(result.lines.every((l) => l.net_cents >= 0 && l.tax_cents >= 0)).toBe(true);
      const reversed = saleTotals([...input].reverse(), discount);
      expect(reversed.tax_cents).toBe(result.tax_cents);
      expect(reversed.lines.find((l) => l.id === 'a')!.discount_cents).toBe(
        result.lines[0]!.discount_cents,
      );
    }
  });
  it('rechaza descuentos excesivos, totales cero y tasas inválidas', () => {
    const line = { id: 'a', price_cents: 100, qty_milli: 1000, tax_rate_bps: 0 };
    for (const discount of [-1, 100, 101, 1.1])
      expect(() => saleTotals([line], discount)).toThrow();
    expect(() => saleTotals([{ ...line, tax_rate_bps: 10001 }])).toThrow();
    expect(() => saleTotals([{ ...line, price_cents: 1, qty_milli: 1 }])).toThrow();
    expect(() => saleTotals([])).toThrow();
  });
  it('neutraliza fórmulas CSV sin perder comillas ni decimales exactos', () => {
    expect(serializeCsv([['=SUM(A1)', '"producto"', '21.05']])).toBe(
      '\ufeff"\'=SUM(A1)";"""producto""";"21.05"',
    );
  });
});
