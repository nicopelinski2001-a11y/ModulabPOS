import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Download, Boxes } from 'lucide-react';
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
import { qty, parseDecimal } from '../../shared/money';
import { type Product } from '../../shared/domain';
import { downloadCsv } from '../csv';
type Movement = {
  id: string;
  product_name: string;
  user_name: string;
  qty_milli: number;
  kind: string;
  reason: string;
  created_at: string;
};
const names: Record<string, string> = {
  opening: 'Stock inicial',
  sale: 'Venta',
  return: 'Devolución',
  adjustment: 'Ajuste',
  purchase: 'Recepción de compra',
};
export function Inventory() {
  const { tenant } = useSession();
  const [adjust, setAdjust] = useState(false);
  const [key, setKey] = useState('');
  const action = useAction();
  const movements = useQuery({
    queryKey: ['inventory'],
    queryFn: () => api<Movement[]>('/inventory'),
  });
  const products = useQuery({
    queryKey: ['products', 'inventory'],
    queryFn: () => api<{ items: Product[]; total: number }>('/products?all=true&limit=500'),
  });
  return (
    <>
      <PageTitle
        eyebrow="CADA UNIDAD TIENE SU HISTORIA"
        title="Inventario"
        description="Un libro de movimientos auditable, desde la recepción hasta la venta."
        action={
          <>
            <Button
              variant="secondary"
              disabled={!movements.data}
              onClick={() =>
                downloadCsv('inventario.csv', [
                  ['Fecha', 'Producto', 'Tipo', 'Cantidad', 'Responsable', 'Motivo'],
                  ...(movements.data ?? []).map((m) => [
                    dateTime(m.created_at, tenant.timezone),
                    m.product_name,
                    names[m.kind],
                    m.qty_milli / 1000,
                    m.user_name,
                    m.reason,
                  ]),
                ])
              }
            >
              <Download size={16} /> Exportar movimientos
            </Button>
            <Button
              onClick={() => {
                setKey(crypto.randomUUID());
                setAdjust(true);
              }}
            >
              <Plus size={17} /> Registrar ajuste
            </Button>
          </>
        }
      />
      <div className="info-banner">
        <Boxes size={21} />
        <div>
          <strong>El stock se calcula a partir de movimientos</strong>
          <p>
            Las ventas, recepciones y devoluciones lo actualizan automáticamente. Los ajustes
            requieren un motivo.
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Últimos movimientos</h2>
            <p>Hasta 300 registros recientes · Historial inmutable</p>
          </div>
          <Badge tone="blue">Trazabilidad activa</Badge>
        </div>
        {movements.isPending ? (
          <Loading />
        ) : movements.error ? (
          <ErrorState error={movements.error} />
        ) : !movements.data?.length ? (
          <Empty />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Producto</th>
                  <th>Movimiento</th>
                  <th className="right">Cantidad</th>
                  <th>Responsable</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {movements.data.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{dateTime(m.created_at, tenant.timezone)}</td>
                    <td className="strong">{m.product_name}</td>
                    <td>
                      <Badge tone={m.qty_milli > 0 ? 'green' : 'amber'}>{names[m.kind]}</Badge>
                    </td>
                    <td
                      className={`right strong ${m.qty_milli > 0 ? 'success-text' : 'warning-text'}`}
                    >
                      {m.qty_milli > 0 ? '+' : ''}
                      {qty(m.qty_milli)}
                    </td>
                    <td>{m.user_name}</td>
                    <td>{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {adjust && (
        <Modal title="Registrar ajuste de inventario" onClose={() => setAdjust(false)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const raw = String(f.get('qty'));
                const value =
                  parseDecimal(raw.replace(/^[+-]/, ''), 3) * (raw.startsWith('-') ? -1 : 1);
                const r = await action.run(
                  () =>
                    api('/inventory/adjust', {
                      product_id: f.get('product_id'),
                      qty_milli: value,
                      reason: f.get('reason'),
                      idempotency_key: key,
                    }),
                  'Ajuste registrado.',
                );
                if (r) setAdjust(false);
              } catch (err) {
                notify((err as Error).message, 'error');
              }
            }}
          >
            <Field label="Producto">
              <select name="product_id" required>
                <option value="">Seleccioná un producto</option>
                {products.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {qty(p.stock_milli)} {p.unit === 'kg' ? 'kg' : 'un.'}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Variación de stock"
              hint="Usá una cantidad negativa para mermas, roturas o vencimientos. Ej.: -2 o 0,250 kg."
            >
              <input name="qty" required inputMode="decimal" autoFocus />
            </Field>
            <Field label="Motivo del ajuste">
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={300}
                rows={3}
                placeholder="Ej.: vencimiento, rotura o diferencia de inventario físico"
              />
            </Field>
            {products.data && products.data.total > 500 && (
              <p className="form-note">Este selector muestra los primeros 500 productos.</p>
            )}
            <Button type="submit" busy={action.busy}>
              Confirmar ajuste
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
