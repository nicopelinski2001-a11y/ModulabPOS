import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ReceiptText, Undo2 } from 'lucide-react';
import { api, useAction } from '../api';
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
import { Receipt } from '../components/Receipt';
import { money } from '../../shared/money';
import { paymentNames } from '../../shared/payments';
import { can } from '../../shared/permissions';
import { type Sale, type Shift } from '../../shared/domain';
import { downloadCsv } from '../csv';
export function Sales() {
  const { user, tenant } = useSession();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [returning, setReturning] = useState<Sale | null>(null);
  const action = useAction();
  const sales = useQuery({
    queryKey: ['sales', from, to, offset],
    queryFn: () =>
      api<Array<Sale & { methods: string; customer_name: string; pending_payment: boolean }>>(
        `/sales?limit=100&offset=${offset}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`,
      ),
  });
  const shifts = useQuery({ queryKey: ['shifts'], queryFn: () => api<Shift[]>('/cash/shifts') });
  const shift = shifts.data?.find((s) => s.user_id === user.user_id && !s.closed_at);
  return (
    <>
      <PageTitle
        eyebrow="TODO LO QUE PASÓ POR TU MOSTRADOR"
        title="Ventas"
        description="Consultá operaciones, reimprimí tickets y registrá devoluciones autorizadas."
        action={
          <Button
            variant="secondary"
            disabled={!sales.data}
            onClick={() =>
              downloadCsv('ventas.csv', [
                ['Operación', 'Fecha', 'Responsable', 'Total ARS', 'Estado'],
                ...(sales.data ?? []).map((s) => [
                  s.number,
                  dateTime(s.created_at, tenant.timezone),
                  s.user_name,
                  s.total_cents / 100,
                  s.returned ? 'Devuelta' : 'Completada',
                ]),
              ])
            }
          >
            <Download size={16} /> Exportar esta página
          </Button>
        }
      />
      <section className="panel">
        <div className="list-toolbar">
          <div className="date-range">
            <span>Desde</span>
            <input
              type="date"
              value={from}
              aria-label="Ventas desde"
              onChange={(e) => {
                setFrom(e.target.value);
                setOffset(0);
              }}
            />
            <span>hasta</span>
            <input
              type="date"
              value={to}
              aria-label="Ventas hasta"
              onChange={(e) => {
                setTo(e.target.value);
                setOffset(0);
              }}
            />
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setFrom('');
              setTo('');
              setOffset(0);
            }}
          >
            Limpiar filtros
          </Button>
        </div>
        {sales.isPending ? (
          <Loading />
        ) : sales.error ? (
          <ErrorState error={sales.error} />
        ) : !sales.data?.length ? (
          <Empty title="No hay ventas en este período" />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Operación</th>
                  <th>Fecha y hora</th>
                  <th>Responsable / cliente</th>
                  <th>Medios de pago</th>
                  <th>Estado</th>
                  <th className="right">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sales.data.map((s) => (
                  <tr key={s.id}>
                    <td className="strong">#{String(s.number).padStart(6, '0')}</td>
                    <td className="nowrap">{dateTime(s.created_at, tenant.timezone)}</td>
                    <td>
                      {s.user_name}
                      <small>{s.customer_name || 'Consumidor final'}</small>
                    </td>
                    <td>
                      {s.methods
                        .split(',')
                        .map((m) => paymentNames[m as keyof typeof paymentNames])
                        .join(' + ')}
                    </td>
                    <td>
                      <Badge tone={s.returned || s.pending_payment ? 'amber' : 'green'}>
                        {s.returned
                          ? 'Devuelta'
                          : s.pending_payment
                            ? 'Pago pendiente'
                            : 'Completada'}
                      </Badge>
                    </td>
                    <td className="right strong">{money(s.total_cents)}</td>
                    <td className="actions-cell">
                      <Button
                        variant="ghost"
                        busy={action.busy}
                        onClick={async () => {
                          const r = await action.run(() => api<Sale>(`/sales/${s.id}`));
                          if (r) setReceipt(r);
                        }}
                      >
                        <ReceiptText size={16} /> Ticket
                      </Button>
                      {can(user.role, 'refund') && !s.returned && (
                        <Button variant="ghost" disabled={!shift} onClick={() => setReturning(s)}>
                          <Undo2 size={15} /> Devolver
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>Hasta 100 operaciones por página</span>
          <Button
            variant="ghost"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            Anterior
          </Button>
          <Button
            variant="ghost"
            disabled={!sales.data || sales.data.length < 100}
            onClick={() => setOffset(offset + 100)}
          >
            Siguiente
          </Button>
        </div>
      </section>
      {receipt && <Receipt sale={receipt} onClose={() => setReceipt(null)} />}
      {returning && (
        <Modal title={`Devolver venta #${returning.number}`} onClose={() => setReturning(null)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const r = await action.run(
                () =>
                  api(`/sales/${returning.id}/return`, {
                    shift_id: shift!.id,
                    reason: f.get('reason'),
                  }),
                'Devolución total registrada.',
              );
              if (r) setReturning(null);
            }}
          >
            <div className="alert warning">
              Se devuelve la venta completa y toda la mercadería vuelve al stock. El efectivo sale
              de tu caja actual. La devolución electrónica debe realizarse por el canal de pago
              original.
            </div>
            <div className="stat-line">
              <span>Total a devolver</span>
              <strong>{money(returning.total_cents)}</strong>
            </div>
            <Field label="Motivo de la devolución">
              <textarea name="reason" minLength={5} maxLength={300} required rows={3} autoFocus />
            </Field>
            <Button variant="danger" type="submit" busy={action.busy}>
              Confirmar devolución completa
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
