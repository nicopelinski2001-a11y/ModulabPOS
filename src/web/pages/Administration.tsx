import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Save, Plus, ShieldCheck, KeyRound, Printer, Store, Check, Minus } from 'lucide-react';
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
import { parseDecimal, decimalInput } from '../../shared/money';
import { roles, can } from '../../shared/permissions';
import { type Role } from '../../shared/domain';
const roleNames: Record<Role, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  cashier: 'Cajero',
  stock: 'Repositor',
};
export function SettingsPage() {
  const { tenant } = useSession();
  const action = useAction();
  const [password, setPassword] = useState(false);
  return (
    <>
      <PageTitle
        eyebrow="EL SISTEMA, A TU MEDIDA"
        title="Configuración"
        description="Identidad del comercio, reglas de inventario y formato de impresión."
      />
      <div className="settings-grid">
        <section className="panel settings-form">
          <div className="panel-heading">
            <div>
              <h2>
                <Store size={18} /> Datos del comercio
              </h2>
              <p>Esta información aparece en los nuevos tickets.</p>
            </div>
          </div>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await action.run(
                async () =>
                  api(
                    '/settings',
                    {
                      name: f.get('name'),
                      address: f.get('address'),
                      tax_id: f.get('tax_id'),
                      timezone: f.get('timezone'),
                      paper_width: Number(f.get('paper')),
                      currency: 'ARS',
                      tax_rate_bps: parseDecimal(String(f.get('tax_rate') || '0')),
                      receipt_footer: f.get('receipt_footer'),
                      session_idle_minutes: Number(f.get('session_idle_minutes')),
                      allow_negative_stock: f.get('negative') === 'on',
                    },
                    'PATCH',
                  ),
                'Configuración guardada.',
              );
            }}
          >
            <Field label="Nombre comercial">
              <input name="name" defaultValue={tenant.name} required maxLength={160} />
            </Field>
            <Field label="Dirección">
              <input name="address" defaultValue={tenant.address} maxLength={250} />
            </Field>
            <div className="form-grid">
              <Field label="CUIT / datos comerciales">
                <input name="tax_id" defaultValue={tenant.tax_id} maxLength={30} />
              </Field>
              <Field label="Zona horaria">
                <input name="timezone" defaultValue={tenant.timezone} required />
              </Field>
            </div>
            <Field label="Ancho de ticket térmico">
              <select name="paper" defaultValue={tenant.paper_width}>
                <option value="80">80 mm</option>
                <option value="58">58 mm</option>
              </select>
            </Field>
            <Field label="Moneda">
              <input value="ARS · Peso argentino" disabled />
            </Field>
            <Field
              label="Impuesto incluido por defecto (%)"
              hint="Los precios finales ya incluyen este impuesto. Cada producto puede usar su propia tasa."
            >
              <input
                name="tax_rate"
                inputMode="decimal"
                required
                defaultValue={decimalInput(tenant.tax_rate_bps)}
              />
            </Field>
            <Field label="Mensaje al pie del ticket">
              <textarea
                name="receipt_footer"
                maxLength={300}
                defaultValue={tenant.receipt_footer}
              />
            </Field>
            <Field label="Bloquear por inactividad (minutos)">
              <input
                name="session_idle_minutes"
                type="number"
                min="1"
                max="120"
                required
                defaultValue={tenant.session_idle_minutes}
              />
            </Field>
            <label className="checkbox">
              <input name="negative" type="checkbox" defaultChecked={tenant.allow_negative_stock} />{' '}
              Permitir ventas con stock negativo
            </label>
            <p className="form-note">
              Cada cambio queda auditado. Los tickets de ventas anteriores conservan los datos que
              tenían al emitirse.
            </p>
            <Button type="submit" busy={action.busy}>
              <Save size={16} /> Guardar configuración
            </Button>
          </form>
        </section>
        <div className="settings-side">
          <section className="panel">
            <div className="panel-heading">
              <h2>
                <ShieldCheck size={18} /> Seguridad de acceso
              </h2>
            </div>
            <div className="panel-body">
              <p>
                Sesiones de hasta 8 horas, bloqueo por inactividad y permisos por usuario. El plazo
                de inactividad se configura junto a los datos del comercio.
              </p>
              <Button variant="secondary" onClick={() => setPassword(true)}>
                <KeyRound size={16} /> Cambiar mi contraseña
              </Button>
            </div>
          </section>
          <section className="panel section-gap">
            <div className="panel-heading">
              <h2>
                <Printer size={18} /> Impresión y facturación
              </h2>
            </div>
            <div className="panel-body">
              <Badge tone="green">Impresión desde navegador</Badge>
              <p>
                Tickets comerciales de 58 y 80 mm. Seleccioná tu impresora en el diálogo del
                sistema.
              </p>
              <div className="alert warning">
                Los tickets comerciales no son comprobantes fiscales. Para imprimir, usá el driver
                del equipo; también podés descargar el ticket en PDF.
              </div>
            </div>
          </section>
          <section className="panel section-gap">
            <div className="panel-heading">
              <h2>Instalación local</h2>
            </div>
            <div className="panel-body">
              <p>
                Las operaciones dependen del servidor local y de la red del comercio. No requieren
                conexión a internet para registrar ventas manuales.
              </p>
              <p className="muted">
                Si se interrumpe la red local, conservamos el carrito para recuperar la operación
                cuando vuelva la conexión al servidor.
              </p>
            </div>
          </section>
        </div>
      </div>
      {password && (
        <Modal title="Cambiar mi contraseña" onClose={() => setPassword(false)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (f.get('new') !== f.get('confirm')) {
                notify('Las contraseñas nuevas no coinciden.', 'error');
                return;
              }
              const r = await action.run(
                () =>
                  api('/auth/password', {
                    current_password: f.get('current'),
                    new_password: f.get('new'),
                  }),
                'Contraseña actualizada. Las otras sesiones se cerraron.',
              );
              if (r) setPassword(false);
            }}
          >
            <Field label="Contraseña actual">
              <input name="current" type="password" required autoComplete="current-password" />
            </Field>
            <Field label="Nueva contraseña (mínimo 12 caracteres)">
              <input
                name="new"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Repetí la nueva contraseña">
              <input
                name="confirm"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
              />
            </Field>
            <Button type="submit" busy={action.busy}>
              Actualizar contraseña
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Team() {
  const { user } = useSession();
  const [create, setCreate] = useState(false);
  const action = useAction();
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () =>
      api<{ id: string; name: string; email: string; role: Role; active: boolean }[]>('/users'),
  });
  return (
    <>
      <PageTitle
        eyebrow="CADA PERSONA, EL ACCESO QUE NECESITA"
        title="Equipo y permisos"
        description="Roles operativos con permisos controlados en el servidor."
        action={
          <Button onClick={() => setCreate(true)}>
            <Plus size={17} /> Agregar empleado
          </Button>
        }
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>Personas de tu comercio</h2>
        </div>
        {users.isPending ? (
          <Loading />
        ) : users.error ? (
          <ErrorState error={users.error} />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Correo</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.data?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong>
                      {u.id === user.user_id && <small>Tu usuario</small>}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      {u.role === 'owner' ? (
                        roleNames[u.role]
                      ) : (
                        <select
                          aria-label={`Rol de ${u.name}`}
                          value={u.role}
                          disabled={action.busy || u.id === user.user_id}
                          onChange={(e) => {
                            const role = e.target.value;
                            void action.run(
                              () => api(`/users/${u.id}`, { active: u.active, role }, 'PATCH'),
                              'Rol actualizado.',
                            );
                          }}
                        >
                          {roles
                            .filter((r) => r !== 'owner')
                            .map((r) => (
                              <option value={r} key={r}>
                                {roleNames[r]}
                              </option>
                            ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <Badge tone={u.active ? 'green' : 'neutral'}>
                        {u.active ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </td>
                    <td>
                      {u.role !== 'owner' && u.id !== user.user_id && (
                        <Button
                          variant="ghost"
                          busy={action.busy}
                          onClick={() => {
                            if (
                              confirm(
                                `¿${u.active ? 'Desactivar' : 'Activar'} el acceso de ${u.name}?`,
                              )
                            )
                              void action.run(
                                () =>
                                  api(
                                    `/users/${u.id}`,
                                    { active: !u.active, role: u.role },
                                    'PATCH',
                                  ),
                                'Acceso actualizado.',
                              );
                          }}
                        >
                          {u.active ? 'Desactivar' : 'Activar'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <h2>Permisos por rol</h2>
            <p>Perfiles predefinidos de esta versión</p>
          </div>
          <ShieldCheck size={20} className="muted" />
        </div>
        <div className="table-scroll">
          <table className="permissions-table">
            <thead>
              <tr>
                <th>Operación</th>
                {roles.map((r) => (
                  <th key={r}>{roleNames[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Vender', 'sell'],
                  ['Aplicar descuentos', 'discount'],
                  ['Devolver ventas', 'refund'],
                  ['Gestionar productos', 'products'],
                  ['Ajustar inventario', 'inventory'],
                  ['Registrar compras', 'purchases'],
                  ['Ver reportes', 'reports'],
                  ['Administrar usuarios', 'users'],
                  ['Configurar comercio', 'settings'],
                ] as const
              ).map(([label, p]) => (
                <tr key={p}>
                  <td>{label}</td>
                  {roles.map((r) => (
                    <td key={r}>
                      {can(r, p) ? (
                        <Check size={17} className="success-text" />
                      ) : (
                        <Minus size={16} className="muted" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {create && (
        <Modal title="Agregar empleado" onClose={() => setCreate(false)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const r = await action.run(
                () =>
                  api('/users', {
                    name: f.get('name'),
                    email: f.get('email'),
                    password: f.get('password'),
                    role: f.get('role'),
                  }),
                'Empleado creado.',
              );
              if (r) setCreate(false);
            }}
          >
            <Field label="Nombre">
              <input name="name" required maxLength={160} autoFocus />
            </Field>
            <Field label="Correo electrónico">
              <input name="email" type="email" required maxLength={200} />
            </Field>
            <Field label="Contraseña inicial (mínimo 12 caracteres)">
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label="Rol">
              <select name="role" defaultValue="cashier">
                {roles
                  .filter((r) => r !== 'owner')
                  .map((r) => (
                    <option value={r} key={r}>
                      {roleNames[r]}
                    </option>
                  ))}
              </select>
            </Field>
            <Button type="submit" busy={action.busy}>
              Crear empleado
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Audit() {
  const { tenant } = useSession();
  const events = useQuery({
    queryKey: ['audit'],
    queryFn: () =>
      api<
        {
          id: string;
          user_name: string;
          action: string;
          entity_id: string | null;
          detail: unknown;
          created_at: string;
        }[]
      >('/audit'),
  });
  return (
    <>
      <PageTitle
        eyebrow="TRAZABILIDAD PARA TU TRANQUILIDAD"
        title="Auditoría"
        description="Registro inmutable de accesos y operaciones sensibles. Hasta 300 eventos recientes."
      />
      <section className="panel">
        {events.isPending ? (
          <Loading />
        ) : events.error ? (
          <ErrorState error={events.error} />
        ) : !events.data?.length ? (
          <Empty />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Responsable</th>
                  <th>Acción</th>
                  <th>Recurso</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{dateTime(e.created_at, tenant.timezone)}</td>
                    <td>{e.user_name || 'Instalación'}</td>
                    <td>
                      <code>{e.action}</code>
                    </td>
                    <td>
                      <code>{e.entity_id?.slice(0, 8) || '—'}</code>
                    </td>
                    <td>
                      <details>
                        <summary>Ver datos</summary>
                        <pre className="audit-detail">{JSON.stringify(e.detail, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
