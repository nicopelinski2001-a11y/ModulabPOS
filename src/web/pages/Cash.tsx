import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, ArrowDownLeft, ArrowUpRight, LockKeyhole, Wallet, History } from 'lucide-react';
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
import { money, parseDecimal } from '../../shared/money';
import { type Shift } from '../../shared/domain';
type CashMove = {
  id: string;
  amount_cents: number;
  kind: string;
  reason: string;
  created_at: string;
};
export function Cash() {
  const { user, tenant } = useSession();
  const [modal, setModal] = useState<'open' | 'in' | 'out' | 'close' | null>(null);
  const [key, setKey] = useState('');
  const [selected, setSelected] = useState<Shift | null>(null);
  const action = useAction();
  const shifts = useQuery({ queryKey: ['shifts'], queryFn: () => api<Shift[]>('/cash/shifts') });
  const current = shifts.data?.find((s) => s.user_id === user.user_id && !s.closed_at);
  const registers = useQuery({
    queryKey: ['registers'],
    queryFn: () => api<{ id: string; name: string; branch_name: string }[]>('/cash/registers'),
  });
  const movements = useQuery({
    queryKey: ['cash-movements', selected?.id ?? current?.id],
    queryFn: () => api<CashMove[]>(`/cash/shifts/${selected?.id ?? current?.id}/movements`),
    enabled: !!(selected ?? current),
  });
  const open = (kind: typeof modal) => {
    setKey(crypto.randomUUID());
    setModal(kind);
  };
  return (
    <>
      <PageTitle
        eyebrow="CLARIDAD EN CADA TURNO"
        title="Caja y turnos"
        description="Separá el efectivo físico de los cobros electrónicos y cerrá con números claros."
        action={
          current ? (
            <>
              <Button variant="secondary" onClick={() => open('out')}>
                <ArrowUpRight size={16} /> Retirar efectivo
              </Button>
              <Button variant="secondary" onClick={() => open('in')}>
                <ArrowDownLeft size={16} /> Ingresar efectivo
              </Button>
              <Button onClick={() => open('close')}>
                <LockKeyhole size={16} /> Cerrar mi caja
              </Button>
            </>
          ) : (
            <Button onClick={() => open('open')}>
              <Plus size={17} /> Abrir mi caja
            </Button>
          )
        }
      />
      {shifts.isPending ? (
        <Loading />
      ) : shifts.error ? (
        <ErrorState error={shifts.error} />
      ) : (
        <>
          {current ? (
            <div className="cash-overview">
              <div className="cash-hero">
                <span className="cash-hero-icon">
                  <Wallet size={30} />
                </span>
                <div>
                  <Badge tone="green">Tu turno está abierto</Badge>
                  <h2>{current.register_name}</h2>
                  <p>Desde {dateTime(current.opened_at, tenant.timezone)}</p>
                </div>
                <div className="cash-expected">
                  <small>Efectivo esperado</small>
                  <strong>{money(current.expected_cents)}</strong>
                  <span>Fondo inicial {money(current.opening_cents)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="info-banner">
              <LockKeyhole size={23} />
              <div>
                <strong>No tenés un turno abierto</strong>
                <p>Abrí una caja con tu fondo inicial para empezar a vender.</p>
              </div>
            </div>
          )}
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Historial de turnos</h2>
                <p>Hasta 100 turnos recientes{user.role === 'cashier' ? ' propios' : ''}</p>
              </div>
              <History size={19} className="muted" />
            </div>
            {!shifts.data?.length ? (
              <Empty title="Todavía no se abrió ninguna caja" />
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Caja / Responsable</th>
                      <th>Apertura</th>
                      <th>Estado</th>
                      <th className="right">Esperado</th>
                      <th className="right">Contado</th>
                      <th className="right">Diferencia</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.data.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.register_name}</strong>
                          <small>{s.user_name}</small>
                        </td>
                        <td>{dateTime(s.opened_at, tenant.timezone)}</td>
                        <td>
                          <Badge tone={s.closed_at ? 'neutral' : 'green'}>
                            {s.closed_at ? 'Cerrado' : 'Abierto'}
                          </Badge>
                        </td>
                        <td className="right">{money(s.expected_cents)}</td>
                        <td className="right">
                          {s.counted_cents === null ? '—' : money(s.counted_cents)}
                        </td>
                        <td
                          className={`right ${s.counted_cents !== null && s.counted_cents !== s.expected_cents ? 'warning-text' : ''}`}
                        >
                          {s.counted_cents === null
                            ? '—'
                            : money(s.counted_cents - s.expected_cents)}
                        </td>
                        <td>
                          <Button variant="ghost" onClick={() => setSelected(s)}>
                            Movimientos
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {(current || selected) && (
            <section className="panel section-gap">
              <div className="panel-heading">
                <div>
                  <h2>Movimientos de efectivo · {(selected ?? current)?.register_name}</h2>
                  <p>Los pagos electrónicos no afectan este saldo.</p>
                </div>
                {selected && (
                  <Button variant="ghost" onClick={() => setSelected(null)}>
                    Volver a mi turno
                  </Button>
                )}
              </div>
              {movements.isPending ? (
                <Loading />
              ) : movements.error ? (
                <ErrorState error={movements.error} />
              ) : !movements.data?.length ? (
                <Empty title="Sin movimientos de efectivo" />
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Concepto</th>
                        <th className="right">Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.data.map((m) => (
                        <tr key={m.id}>
                          <td>{dateTime(m.created_at, tenant.timezone)}</td>
                          <td>{m.reason}</td>
                          <td
                            className={`right strong ${m.amount_cents > 0 ? 'success-text' : 'warning-text'}`}
                          >
                            {m.amount_cents > 0 ? '+' : ''}
                            {money(m.amount_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
      {modal && (
        <Modal
          title={
            {
              open: 'Abrir mi caja',
              in: 'Ingreso de efectivo',
              out: 'Retiro de efectivo',
              close: 'Cerrar y arquear mi caja',
            }[modal]
          }
          onClose={() => setModal(null)}
        >
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const amount = parseDecimal(String(f.get('amount')));
                let endpoint: string, body: unknown;
                if (modal === 'open') {
                  endpoint = '/cash/open';
                  body = { register_id: f.get('register_id'), opening_cents: amount };
                } else if (modal === 'close') {
                  endpoint = '/cash/close';
                  body = { shift_id: current!.id, counted_cents: amount, reason: f.get('reason') };
                } else {
                  endpoint = '/cash/movement';
                  body = {
                    shift_id: current!.id,
                    kind: modal,
                    amount_cents: amount,
                    reason: f.get('reason'),
                    idempotency_key: key,
                  };
                }
                const result = await action.run(
                  () => api(endpoint, body),
                  modal === 'close'
                    ? 'Caja cerrada y arqueo registrado.'
                    : 'Operación de caja registrada.',
                );
                if (result) setModal(null);
              } catch (err) {
                notify((err as Error).message, 'error');
              }
            }}
          >
            {modal === 'open' && (
              <Field label="Caja física">
                <select name="register_id" required>
                  <option value="">Seleccioná una caja</option>
                  {registers.data?.map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.name} · {r.branch_name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field
              label={
                modal === 'close'
                  ? 'Efectivo contado (ARS)'
                  : modal === 'open'
                    ? 'Fondo inicial (ARS)'
                    : 'Importe (ARS)'
              }
            >
              <input name="amount" required inputMode="decimal" autoFocus placeholder="0,00" />
            </Field>
            {modal !== 'open' && (
              <Field label={modal === 'close' ? 'Observaciones del arqueo' : 'Motivo'}>
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={300}
                  rows={2}
                  defaultValue={modal === 'close' ? 'Cierre de turno' : ''}
                />
              </Field>
            )}
            {modal === 'close' && (
              <div className="alert warning">
                Al cerrar, se guarda el saldo esperado y la diferencia con lo contado. El turno no
                se puede reabrir.
              </div>
            )}
            <Button type="submit" busy={action.busy}>
              {
                {
                  open: 'Abrir caja',
                  in: 'Registrar ingreso',
                  out: 'Registrar retiro',
                  close: 'Confirmar cierre',
                }[modal]
              }
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
