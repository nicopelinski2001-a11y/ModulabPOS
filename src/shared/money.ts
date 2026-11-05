export class AmountError extends Error {}
/** Integers at the API boundary; bigint for every multiplication and rounding. */
export function lineTotal(priceCents: number, qtyMilli: number): number {
  if (
    !Number.isSafeInteger(priceCents) ||
    !Number.isSafeInteger(qtyMilli) ||
    priceCents < 0 ||
    qtyMilli < 0
  )
    throw new AmountError('Importe o cantidad inválidos');
  const result = (BigInt(priceCents) * BigInt(qtyMilli) + 500n) / 1000n;
  if (result > 1_000_000_000_000n) throw new AmountError('Importe fuera de rango');
  return Number(result);
}
export function sumMoney(amounts: readonly number[]): number {
  const result = amounts.reduce((sum, n) => {
    if (!Number.isSafeInteger(n)) throw new AmountError('Importe inválido');
    return sum + BigInt(n);
  }, 0n);
  if (result > 1_000_000_000_000n || result < -1_000_000_000_000n)
    throw new AmountError('Importe fuera de rango');
  return Number(result);
}
/** Accepts decimal comma or dot, never thousands separators. No floating point. */
export function parseDecimal(value: string, decimals = 2): number {
  const normalized = value.trim().replace(',', '.');
  if (!new RegExp(`^\\d+(?:\\.\\d{0,${decimals}})?$`).test(normalized))
    throw new AmountError(
      `Ingresá un número con hasta ${decimals} decimales, sin separador de miles.`,
    );
  const [whole, fraction = ''] = normalized.split('.');
  const n = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (n > 1_000_000_000_000n) throw new AmountError('Importe fuera de rango');
  return Number(n);
}
export function decimalInput(value: number, decimals = 2): string {
  const absolute = Math.abs(value);
  return `${value < 0 ? '-' : ''}${Math.trunc(absolute / 10 ** decimals)}.${String(absolute % 10 ** decimals).padStart(decimals, '0')}`;
}
export const money = (value: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(value / 100);
export const qty = (value: number) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(value / 1000);
