import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, PackageCheck, Wallet, Trash2 } from 'lucide-react';
import { api, notify, useAction } from '../api';
import { useSession } from '../context';
import {
  Button,
  PageTitle,
  Loading,
  ErrorState,
  Empty,
  Modal,
  Field,
  Badge,
  dateTime,
} from '../components/ui';
import { money, parseDecimal, decimalInput, lineTotal, sumMoney } from '../../shared/money';
import { type Product, type Shift } from '../../shared/domain';
type Purchase = {
  id: string;
  supplier_name: string;
  reference: string;
  status: string;
  created_at: string;
  total_cents: number;
  paid_cents: number;
};
type DraftLine = { product_id: string; quantity: string; cost: string };
export function Purchases() {
  const { user, tenant } = useSession();
  const [create, setCreate] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([{ product_id: '', quantity: '1', cost: '' }]);
  const [payment, setPayment] = useState<Purchase | null>(null);
  const [key, setKey] = useState('');
  const action = useAction();
  const purchases = useQuery({
    queryKey: ['purchases'],
    queryFn: () => api<Purchase[]>('/purchases'),
  });
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<{ id: string; name: string }[]>('/suppliers'),
  });
  const products = useQuery({
    queryKey: ['products', 'purchases'],
    queryFn: () => api<{ items: Product[]; total: number }>('/products?limit=500'),
  });
  const shifts = useQuery({
    queryKey: ['shifts'],
    queryFn: () => api<Shift[]>('/cash/shifts'),
    enabled: user.role !== 'stock',
  });
  const shift = shifts.data?.find((s) => !s.closed_at && s.user_id === user.user_id);
  let total = 0;
  try {
    total = sumMoney(
      lines
        .filter((l) => l.cost && l.quantity)
        .map((l) => lineTotal(parseDecimal(l.cost), parseDecimal(l.quantity, 3))),
    );
  } catch {
    /* validate amounts on submission */
  }
  return (
    <>
      <PageTitle
        eyebrow="DEL PEDIDO A TU ESTANTERÍA"
        title="Compras"
        description="Registrá pedidos y confirmá la mercadería cuando realmente la recibís."
        action={
          <Button
            onClick={() => {
              setLines([{ product_id: '', quantity: '1', cost: '' }]);
              setCreate(true);
            }}
          >
            <Plus size={17} /> Nueva compra
          </Button>
        }
      />
      <div className="info-banner">
        <PackageCheck size={23} />
        <div>
          <strong>Comprar y recibir son dos operaciones distintas</strong>
          <p>El inventario y los costos se actualizan al confirmar la recepción completa.</p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Registro de compras</h2>
            <p>Hasta 300 compras recientes</p>
          </div>
        </div>
        {purchases.isPending ? (
          <Loading />
        ) : purchases.error ? (
          <ErrorState error={purchases.error} />
        ) : !purchases.data?.length ? (
          <Empty title="Todavía no hay compras registradas" />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Referencia / proveedor</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th className="right">Total</th>
                  <th className="right">Saldo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {purchases.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.reference}</strong>
                      <small>{p.supplier_name}</small>
                    </td>
                    <td>{dateTime(p.created_at, tenant.timezone)}</td>
                    <td>
                      <Badge tone={p.status === 'received' ? 'green' : 'amber'}>
                        {p.status === 'received' ? 'Recibida' : 'Pendiente de recepción'}
                      </Badge>
                    </td>
                    <td className="right strong">{money(p.total_cents)}</td>
                    <td className="right">
                      {p.status === 'received' ? money(p.total_cents - p.paid_cents) : '—'}
                    </td>
                    <td className="actions-cell">
                      {p.status === 'ordered' ? (
                        <Button
                          variant="secondary"
                          busy={action.busy}
                          onClick={() => {
                            if (
                              confirm(
                                '¿Confirmar que recibiste toda la mercadería? Se actualizarán el stock y los costos.',
                              )
                            )
                              void action.run(
                                () => api(`/purchases/${p.id}/receive`, {}),
                                'Mercadería recibida e inventario actualizado.',
                              );
                          }}
                        >
                          <PackageCheck size={16} /> Recibir
                        </Button>
                      ) : (
                        ['owner', 'admin'].includes(user.role) && (
                          <Button
                            variant="secondary"
                            disabled={p.paid_cents >= p.total_cents || !shift}
                            title={!shift ? 'Abrí tu caja para registrar un pago' : undefined}
                            onClick={() => {
                              setKey(crypto.randomUUID());
                              setPayment(p);
                            }}
                          >
                            <Wallet size={16} /> Registrar pago
                          </Button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {create && (
        <Modal title="Registrar compra" onClose={() => setCreate(false)} wide>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const body = {
                  supplier_id: f.get('supplier_id'),
                  reference: f.get('reference'),
                  items: lines.map((l) => ({
                    product_id: l.product_id,
                    qty_milli: parseDecimal(l.quantity, 3),
                    cost_cents: parseDecimal(l.cost),
                  })),
                };
                const r = await action.run(
                  () => api('/purchases', body),
                  'Compra registrada. Pendiente de recepción.',
                );
                if (r) setCreate(false);
              } catch (err) {
                notify((err as Error).message, 'error');
              }
            }}
          >
            <div className="form-grid">
              <Field label="Proveedor">
                <select name="supplier_id" required>
                  <option value="">Seleccioná un proveedor</option>
                  {suppliers.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Referencia / comprobante">
                <input
                  name="reference"
                  required
                  maxLength={160}
                  placeholder="Ej.: Remito 0001-1234"
                />
              </Field>
            </div>
            <div className="section-title">
              <h3>Productos de la compra</h3>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setLines([...lines, { product_id: '', quantity: '1', cost: '' }])}
              >
                <Plus size={15} /> Agregar fila
              </Button>
            </div>
            {lines.map((l, index) => (
              <div className="purchase-edit-row" key={index}>
                <Field label="Producto">
                  <select
                    value={l.product_id}
                    required
                    onChange={(e) => {
                      const p = products.data?.items.find((p) => p.id === e.target.value);
                      setLines(
                        lines.map((x, i) =>
                          i === index
                            ? {
                                ...x,
                                product_id: e.target.value,
                                cost: p ? decimalInput(p.cost_cents) : '',
                              }
                            : x,
                        ),
                      );
                    }}
                  >
                    <option value="">Seleccioná</option>
                    {products.data?.items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.unit === 'kg' ? ' (kg)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Cantidad / kg">
                  <input
                    required
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, i) => (i === index ? { ...x, quantity: e.target.value } : x)),
                      )
                    }
                  />
                </Field>
                <Field label="Costo unitario ARS">
                  <input
                    required
                    inputMode="decimal"
                    value={l.cost}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, i) => (i === index ? { ...x, cost: e.target.value } : x)),
                      )
                    }
                  />
                </Field>
                <button
                  type="button"
                  className="icon-button"
                  disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((_, i) => i !== index))}
                  aria-label="Eliminar fila"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
            <div className="stat-line">
              <strong>Total de la compra</strong>
              <strong>{money(total)}</strong>
            </div>
            <div className="modal-actions">
              <Button type="button" variant="secondary" onClick={() => setCreate(false)}>
                Cancelar
              </Button>
              <Button type="submit" busy={action.busy}>
                Registrar pedido
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {payment && (
        <Modal title="Pago a proveedor" onClose={() => setPayment(null)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const r = await action.run(
                  () =>
                    api(`/purchases/${payment.id}/payments`, {
                      amount_cents: parseDecimal(String(f.get('amount'))),
                      method: f.get('method'),
                      shift_id: shift!.id,
                      idempotency_key: key,
                    }),
                  'Pago registrado.',
                );
                if (r) setPayment(null);
              } catch (err) {
                notify((err as Error).message, 'error');
              }
            }}
          >
            <p>
              {payment.supplier_name} · {payment.reference}
            </p>
            <div className="stat-line">
              <span>Pendiente</span>
              <strong>{money(payment.total_cents - payment.paid_cents)}</strong>
            </div>
            <Field label="Importe del pago (ARS)">
              <input name="amount" required inputMode="decimal" autoFocus />
            </Field>
            <Field label="Medio">
              <select name="method">
                <option value="cash">Efectivo de mi caja</option>
                <option value="transfer">Transferencia registrada manualmente</option>
              </select>
            </Field>
            <Button type="submit" busy={action.busy}>
              Confirmar pago
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
