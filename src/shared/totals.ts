import { AmountError, lineTotal, sumMoney } from './money.js';

export type PricedLine = {
  id: string;
  price_cents: number;
  qty_milli: number;
  tax_rate_bps: number;
};

/** Retail prices include tax. Allocate the discount by largest remainder, then
 * extract included tax with half-up rounding. Stable IDs break remainder ties. */
export function saleTotals(items: readonly PricedLine[], discountCents = 0) {
  const lines = items.map((item) => {
    if (!Number.isInteger(item.tax_rate_bps) || item.tax_rate_bps < 0 || item.tax_rate_bps > 10000)
      throw new AmountError('La tasa de impuesto debe estar entre 0 y 100%.');
    const total = lineTotal(item.price_cents, item.qty_milli);
    if (total <= 0) throw new AmountError('Cada producto debe tener un importe mayor a cero.');
    return { ...item, total_cents: total, discount_cents: 0, tax_cents: 0, net_cents: 0 };
  });
  const subtotal = sumMoney(lines.map((l) => l.total_cents));
  if (!Number.isSafeInteger(discountCents) || discountCents < 0 || discountCents >= subtotal)
    throw new AmountError('El descuento debe ser menor al subtotal.');
  const denominator = BigInt(subtotal);
  const allocations = lines
    .map((line) => {
      const weighted = BigInt(line.total_cents) * BigInt(discountCents);
      line.discount_cents = Number(weighted / denominator);
      return { line, remainder: weighted % denominator };
    })
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.line.id.localeCompare(b.line.id)
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  let rest = discountCents - sumMoney(lines.map((l) => l.discount_cents));
  for (const { line } of allocations) if (rest-- > 0) line.discount_cents++;
  for (const line of lines) {
    const gross = line.total_cents - line.discount_cents;
    const divisor = BigInt(10000 + line.tax_rate_bps);
    line.tax_cents = Number((BigInt(gross) * BigInt(line.tax_rate_bps) + divisor / 2n) / divisor);
    line.net_cents = gross - line.tax_cents;
  }
  return {
    lines,
    subtotal_cents: subtotal,
    discount_cents: discountCents,
    total_cents: subtotal - discountCents,
    tax_cents: sumMoney(lines.map((l) => l.tax_cents)),
    net_cents: sumMoney(lines.map((l) => l.net_cents)),
  };
}
