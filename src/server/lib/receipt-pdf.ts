import { createPdf } from './pdf.js';
import type { Sale } from '../../shared/domain.js';
import { money, qty } from '../../shared/money.js';
import { paymentNames } from '../../shared/payments.js';

export function createReceiptPdf(sale: Sale) {
  const settings = sale.receipt_settings;
  return createPdf(
    settings.name,
    [
      settings.address,
      settings.tax_id ? `CUIT: ${settings.tax_id}` : '',
      'TICKET COMERCIAL',
      'NO VÁLIDO COMO FACTURA',
      `Operación #${String(sale.number).padStart(6, '0')}`,
      new Date(sale.created_at).toLocaleString('es-AR', { timeZone: settings.timezone }),
      `Caja: ${settings.register_name ?? sale.shift_id.slice(0, 8)}`,
      `Atendió: ${sale.user_name ?? settings.operator_name ?? ''}`,
      ...(sale.returned ? ['DEVOLUCIÓN TOTAL REGISTRADA'] : []),
      '--------------------------------',
      ...(sale.lines ?? []).flatMap((line) => [
        line.name,
        `${qty(line.qty_milli)}${line.unit === 'kg' ? ' kg' : ''} x ${money(line.price_cents)} = ${money(line.total_cents)}`,
      ]),
      '--------------------------------',
      `Subtotal: ${money(sale.subtotal_cents)}`,
      `Descuento: ${money(sale.discount_cents)}`,
      `TOTAL: ${money(sale.total_cents)}`,
      `Neto sin impuesto: ${money(sale.total_cents - sale.tax_cents)}`,
      `Impuestos incluidos: ${money(sale.tax_cents)}`,
      ...(sale.payments ?? []).map(
        (p) =>
          `${paymentNames[p.method]}: ${money(p.amount_cents)}${p.status === 'pending' ? ' (pendiente)' : ''}`,
      ),
      `Vuelto: ${money(sale.change_cents)}`,
      '--------------------------------',
      settings.receipt_footer ?? '¡Gracias por tu compra!',
      'Modulab POS · Modulab Software',
    ],
    { paperWidth: settings.paper_width },
  );
}
