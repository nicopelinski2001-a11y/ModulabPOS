import { describe, it, expect } from 'vitest';
import {
  lineTotal,
  sumMoney,
  parseDecimal,
  decimalInput,
  saleSchema,
  can,
} from '../src/shared/domain';
import { parseCsv, downloadCsv } from '../src/web/csv';
describe('Dinero exacto y cantidades', () => {
  it('interpreta centavos y milésimas sin usar coma flotante', () => {
    expect(parseDecimal('0,29')).toBe(29);
    expect(parseDecimal('1234567.89')).toBe(123456789);
    expect(parseDecimal('0,125', 3)).toBe(125);
    expect(decimalInput(-1250, 3)).toBe('-1.250');
    expect(decimalInput(-29)).toBe('-0.29');
  });
  it('rechaza formatos ambiguos, infinito y precisión de más', () => {
    for (const s of ['1.000,00', '1e8', 'Infinity', '-1', '1.001', 'NaN', '  '])
      expect(() => parseDecimal(s)).toThrow();
  });
  it('redondea cada renglón por medio hacia arriba', () => {
    expect(lineTotal(101, 500)).toBe(51);
    expect(lineTotal(29, 1000)).toBe(29);
    expect(lineTotal(125050, 125)).toBe(15631);
  });
  it('conserva precisión con precios y cantidades grandes', () => {
    expect(lineTotal(999999999, 999999)).toBe(999998999000);
  });
  it('no permite exceder los límites de importe', () => {
    expect(() => lineTotal(1e9, 1e9)).toThrow();
    expect(() => sumMoney([1e12, 1])).toThrow();
    expect(() => sumMoney([0.1, 0.2])).toThrow();
  });
  it('no confunde pagos seleccionados con pagos verificados', () => {
    expect(
      saleSchema.safeParse({ payments: [{ method: 'transfer', status: 'verified' }] }).success,
    ).toBe(false);
  });
  it('aplica mínimo privilegio por rol', () => {
    expect(can('cashier', 'sell')).toBe(true);
    expect(can('cashier', 'refund')).toBe(false);
    expect(can('stock', 'sell')).toBe(false);
    expect(can('stock', 'inventory')).toBe(true);
  });
});
describe('Archivos de migración', () => {
  it('interpreta separadores, escapes y saltos dentro de comillas', () => {
    expect(
      parseCsv('\ufeffsku;nombre;precio\r\nA;"Alfajor; \"\"premium\"\"";1,20\r\nB;"Dos\nlíneas";2'),
    ).toEqual([
      ['sku', 'nombre', 'precio'],
      ['A', 'Alfajor; "premium"', '1,20'],
      ['B', 'Dos\nlíneas', '2'],
    ]);
  });
  it('rechaza comillas sin cerrar y archivos excesivos', () => {
    expect(() => parseCsv('sku;nombre\nA;"sin fin')).toThrow();
    expect(() => parseCsv('x'.repeat(1000001))).toThrow();
  });
});
