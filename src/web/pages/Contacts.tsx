import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Users, Truck, Wallet, History, Search } from 'lucide-react';
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
  SearchBox,
  dateTime,
} from '../components/ui';
import { money, parseDecimal } from '../../shared/money';
import { type Shift } from '../../shared/domain';
type Contact = {
  id: string;
  name: string;
  contact: string;
  tax_id: string;
  balance_cents: number;
  credit_limit_cents?: number;
};
type Movement = { id: string; created_at: string; reason: string; amount_cents: number };
export function Contacts({ kind }: { kind: 'customers' | 'suppliers' }) {
  const { user, tenant } = useSession();
  const customer = kind === 'customers';
  const [search, setSearch] = useState('');
  const [create, setCreate] = useState(false);
  const [history, setHistory] = useState<Contact | null>(null);
  const [collect, setCollect] = useState<Contact | null>(null);
  const [key, setKey] = useState('');
  const action = useAction();
  const contacts = useQuery({ queryKey: [kind], queryFn: () => api<Contact[]>(`/${kind}`) });
  const shifts = useQuery({
    queryKey: ['shifts'],
    queryFn: () => api<Shift[]>('/cash/shifts'),
    enabled: customer,
  });
  const shift = shifts.data?.find((s) => s.user_id === user.user_id && !s.closed_at);
  const movements = useQuery({
    queryKey: ['customer-movements', history?.id],
    queryFn: () => api<Movement[]>(`/customers/${history!.id}/movements`),
    enabled: !!history,
  });
  const items = contacts.data?.filter((c) =>
    `${c.name} ${c.contact} ${c.tax_id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        eyebrow={customer ? 'RELACIONES QUE SUMAN' : 'ABASTECIMIENTO ORGANIZADO'}
        title={customer ? 'Clientes y cuentas corrientes' : 'Proveedores'}
        description={
          customer
            ? 'Conocé a tus clientes y seguí cada movimiento de su cuenta.'
            : 'Tus contactos de compra y sus saldos, siempre a mano.'
        }
        action={
          <Button onClick={() => setCreate(true)}>
            <Plus size={17} /> {customer ? 'Nuevo cliente' : 'Nuevo proveedor'}
          </Button>
        }
      />
      <section className="panel">
        <div className="list-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={customer ? 'Buscar clientes' : 'Buscar proveedores'}
          />
          <span className="muted">{items?.length ?? 0} registros</span>
        </div>
        {contacts.isPending ? (
          <Loading />
        ) : contacts.error ? (
          <ErrorState error={contacts.error} />
        ) : !items?.length ? (
          <Empty />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{customer ? 'Cliente' : 'Proveedor'}</th>
                  <th>Contacto</th>
                  <th>CUIT / documento</th>
                  {customer && <th className="right">Límite de crédito</th>}
                  <th className="right">Saldo pendiente</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="table-product">
                        <span className="contact-avatar">{c.name[0]}</span>
                        <strong>{c.name}</strong>
                      </div>
                    </td>
                    <td>{c.contact || '—'}</td>
                    <td>{c.tax_id || '—'}</td>
                    {customer && <td className="right">{money(c.credit_limit_cents ?? 0)}</td>}
                    <td className="right">
                      <Badge tone={c.balance_cents > 0 ? 'amber' : 'green'}>
                        {money(c.balance_cents)}
                      </Badge>
                    </td>
                    <td className="actions-cell">
                      {customer && (
                        <>
                          <Button variant="ghost" onClick={() => setHistory(c)}>
                            <History size={15} /> Cuenta
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={c.balance_cents <= 0 || !shift}
                            title={!shift ? 'Abrí tu caja para cobrar' : undefined}
                            onClick={() => {
                              setKey(crypto.randomUUID());
                              setCollect(c);
                            }}
                          >
                            <Wallet size={15} /> Cobrar
                          </Button>
                        </>
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
        <Modal
          title={customer ? 'Nuevo cliente' : 'Nuevo proveedor'}
          onClose={() => setCreate(false)}
        >
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const body = {
                  name: f.get('name'),
                  contact: f.get('contact'),
                  tax_id: f.get('tax_id'),
                  ...(customer
                    ? { credit_limit_cents: parseDecimal(String(f.get('limit') || '0')) }
                    : {}),
                };
                const r = await action.run(
                  () => api(`/${kind}`, body),
                  customer ? 'Cliente creado.' : 'Proveedor creado.',
                );
                if (r) setCreate(false);
              } catch (err) {
                notify((err as Error).message, 'error');
              }
            }}
          >
            <Field label="Nombre / razón social">
              <input name="name" required autoFocus maxLength={160} />
            </Field>
            <Field label="Contacto (teléfono o correo)">
              <input name="contact" maxLength={200} />
            </Field>
            <Field label="CUIT / documento">
              <input name="tax_id" maxLength={30} />
            </Field>
            {customer && (
              <Field
                label="Límite de cuenta corriente (ARS)"
                hint="Un límite de cero no habilita ventas a cuenta."
              >
                <input
                  name="limit"
                  inputMode="decimal"
                  defaultValue="0"
                  disabled={!['owner', 'admin'].includes(user.role)}
                />
              </Field>
            )}
            <Button type="submit" busy={action.busy}>
              Guardar {customer ? 'cliente' : 'proveedor'}
            </Button>
          </form>
        </Modal>
      )}
      {history && (
        <Modal title={`Cuenta de ${history.name}`} onClose={() => setHistory(null)} wide>
          {movements.isPending ? (
            <Loading />
          ) : movements.error ? (
            <ErrorState error={movements.error} />
          ) : !movements.data?.length ? (
            <Empty title="La cuenta no tiene movimientos" />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Concepto</th>
                    <th className="right">Débito / crédito</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.data.map((m) => (
                    <tr key={m.id}>
                      <td>{dateTime(m.created_at, tenant.timezone)}</td>
                      <td>{m.reason}</td>
                      <td
                        className={`right ${m.amount_cents > 0 ? 'warning-text' : 'success-text'}`}
                      >
                        {money(m.amount_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="form-note">
            Los importes positivos aumentan la deuda. Los pagos y las devoluciones la reducen.
          </p>
        </Modal>
      )}
      {collect && (
        <Modal title={`Cobrar a ${collect.name}`} onClose={() => setCollect(null)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const r = await action.run(
                  () =>
                    api(`/customers/${collect.id}/payments`, {
                      amount_cents: parseDecimal(String(f.get('amount'))),
                      method: f.get('method'),
                      shift_id: shift!.id,
                      idempotency_key: key,
                    }),
                  'Cobranza registrada.',
                );
                if (r) setCollect(null);
              } catch (err) {
                notify((err as Error).message, 'error');
              }
            }}
          >
            <div className="stat-line">
              <span>Deuda actual</span>
              <strong>{money(collect.balance_cents)}</strong>
            </div>
            <Field label="Importe a cobrar (ARS)">
              <input name="amount" inputMode="decimal" required autoFocus />
            </Field>
            <Field label="Medio de pago">
              <select name="method">
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia (registro manual)</option>
              </select>
            </Field>
            <Button type="submit" busy={action.busy}>
              Confirmar cobranza
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
