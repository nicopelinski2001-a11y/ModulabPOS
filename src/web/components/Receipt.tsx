import { browserPrinter } from './browser-printer';
import { Printer, CheckCircle2 } from 'lucide-react';
import { Modal, Button, dateTime } from './ui';
import { money, qty } from '../../shared/money';
import { paymentNames } from '../../shared/payments';
import { type Sale } from '../../shared/domain';
export function Receipt({
  sale,
  onClose,
  success = false,
}: {
  sale: Sale;
  onClose: () => void;
  success?: boolean;
}) {
  const settings = sale.receipt_settings;
  return (
    <Modal title={success ? 'Venta completada' : 'Detalle de la operación'} onClose={onClose}>
      <div className="receipt-wrap">
        {success && (
          <div className="receipt-success">
            <CheckCircle2 size={28} />
            <span>Se registraron la venta, el stock y los movimientos de caja.</span>
          </div>
        )}
        <article id="print-receipt" className={`receipt paper-${settings.paper_width}`}>
          <h2>{settings.name}</h2>
          {settings.address && <p>{settings.address}</p>}
          {settings.tax_id && <p>CUIT: {settings.tax_id}</p>}
          <div className="receipt-rule" />
          <p>
            <strong>TICKET COMERCIAL</strong>
          </p>
          <p>NO VÁLIDO COMO FACTURA</p>
          <p>Operación #{String(sale.number).padStart(6, '0')}</p>
          <p>{dateTime(sale.created_at, settings.timezone)}</p>
          <p>Atendió: {sale.user_name}</p>
          <p>Caja: {sale.shift_id.slice(0, 8)}</p>
          {sale.returned && (
            <p>
              <strong>DEVOLUCIÓN TOTAL REGISTRADA</strong>
            </p>
          )}
          <div className="receipt-rule" />
          {sale.lines?.map((l) => (
            <div className="receipt-line" key={l.product_id}>
              <strong>{l.name}</strong>
              <div>
                <span>
                  {qty(l.qty_milli)}
                  {l.unit === 'kg' ? ' kg' : ''} × {money(l.price_cents)}
                </span>
                <span>{money(l.total_cents)}</span>
              </div>
            </div>
          ))}
          <div className="receipt-rule" />
          <div className="receipt-totals">
            <div>
              <span>Subtotal</span>
              <span>{money(sale.subtotal_cents)}</span>
            </div>
            {sale.discount_cents > 0 && (
              <div>
                <span>Descuento</span>
                <span>− {money(sale.discount_cents)}</span>
              </div>
            )}
            <div className="receipt-total">
              <strong>TOTAL</strong>
              <strong>{money(sale.total_cents)}</strong>
            </div>
            {sale.payments?.map((p) => (
              <div key={p.method}>
                <span>
                  {paymentNames[p.method]}
                  {p.status === 'pending' ? ' (pendiente)' : ''}
                </span>
                <span>{money(p.amount_cents)}</span>
              </div>
            ))}
            {sale.change_cents > 0 && (
              <div>
                <span>Vuelto</span>
                <strong>{money(sale.change_cents)}</strong>
              </div>
            )}
          </div>
          <div className="receipt-rule" />
          <p>¡Gracias por tu compra!</p>
          <p className="receipt-brand">Modulab POS · Modulab Software</p>
        </article>
      </div>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
        <Button onClick={() => void browserPrinter.print({ paperWidth: settings.paper_width })}>
          <Printer size={17} /> Imprimir ticket
        </Button>
      </div>
    </Modal>
  );
}
