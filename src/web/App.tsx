import { useEffect, useState, lazy, Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  ScanLine,
  Package,
  Boxes,
  Truck,
  ShoppingBag,
  Wallet,
  Users,
  ReceiptText,
  ChartNoAxesCombined,
  Settings,
  ShieldCheck,
  LogOut,
  Sun,
  Moon,
  Layers,
  Menu,
  X,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { api, setCsrf, setNotify, ApiError } from './api';
import { SessionContext } from './context';
import { Button, Field, Loading, ErrorState } from './components/ui';
import { can } from '../shared/permissions';
import { type Permission, type Tenant, type User } from '../shared/domain';
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const POS = lazy(() => import('./pages/POS').then((m) => ({ default: m.POS })));
const Products = lazy(() => import('./pages/Products').then((m) => ({ default: m.Products })));
const Inventory = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.Inventory })));
const Cash = lazy(() => import('./pages/Cash').then((m) => ({ default: m.Cash })));
const Contacts = lazy(() => import('./pages/Contacts').then((m) => ({ default: m.Contacts })));
const Purchases = lazy(() => import('./pages/Purchases').then((m) => ({ default: m.Purchases })));
const Sales = lazy(() => import('./pages/Sales').then((m) => ({ default: m.Sales })));
const SettingsPage = lazy(() =>
  import('./pages/Administration').then((m) => ({ default: m.SettingsPage })),
);
const Team = lazy(() => import('./pages/Administration').then((m) => ({ default: m.Team })));
const Audit = lazy(() => import('./pages/Administration').then((m) => ({ default: m.Audit })));
const nav: Array<{
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: Permission;
  group: string;
}> = [
  {
    id: 'dashboard',
    label: 'Resumen',
    icon: LayoutDashboard,
    permission: 'reports',
    group: 'TU COMERCIO',
  },
  { id: 'pos', label: 'Punto de venta', icon: ScanLine, permission: 'sell', group: 'TU COMERCIO' },
  { id: 'sales', label: 'Ventas', icon: ReceiptText, permission: 'sell', group: 'TU COMERCIO' },
  { id: 'cash', label: 'Caja y turnos', icon: Wallet, permission: 'cash', group: 'TU COMERCIO' },
  { id: 'products', label: 'Productos', icon: Package, permission: 'products', group: 'GESTIÓN' },
  { id: 'inventory', label: 'Inventario', icon: Boxes, permission: 'inventory', group: 'GESTIÓN' },
  {
    id: 'purchases',
    label: 'Compras',
    icon: ShoppingBag,
    permission: 'purchases',
    group: 'GESTIÓN',
  },
  { id: 'suppliers', label: 'Proveedores', icon: Truck, permission: 'suppliers', group: 'GESTIÓN' },
  { id: 'customers', label: 'Clientes', icon: Users, permission: 'customers', group: 'GESTIÓN' },
  {
    id: 'reports',
    label: 'Reportes',
    icon: ChartNoAxesCombined,
    permission: 'reports',
    group: 'ADMINISTRACIÓN',
  },
  {
    id: 'team',
    label: 'Equipo y permisos',
    icon: ShieldCheck,
    permission: 'users',
    group: 'ADMINISTRACIÓN',
  },
  {
    id: 'audit',
    label: 'Auditoría',
    icon: ReceiptText,
    permission: 'audit',
    group: 'ADMINISTRACIÓN',
  },
  {
    id: 'settings',
    label: 'Configuración',
    icon: Settings,
    permission: 'settings',
    group: 'ADMINISTRACIÓN',
  },
];
export function App() {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const data = await api<{ user: User; tenant: Tenant; csrf: string }>('/auth/me');
      setCsrf(data.csrf);
      return data;
    },
  });
  const [page, setPage] = useState(location.hash.slice(1));
  const [mobile, setMobile] = useState(false);
  const [dark, setDark] = useState(localStorage.getItem('modulab-theme') === 'dark');
  const [toast, setToast] = useState<{ message: string; kind: string } | null>(null);
  useEffect(() => {
    setNotify((message, kind = 'success') => setToast({ message, kind }));
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 6500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('modulab-theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    const cb = () => setPage(location.hash.slice(1));
    window.addEventListener('hashchange', cb);
    return () => window.removeEventListener('hashchange', cb);
  }, []);
  const go = (id: string) => {
    location.hash = id;
    setPage(id);
    setMobile(false);
  };
  if (session.isPending)
    return (
      <div className="app-loading">
        <Layers size={35} />
        <Loading />
      </div>
    );
  if (!session.data) {
    if (session.error instanceof ApiError && session.error.status !== 401)
      return (
        <div className="login-page">
          <div className="login-card">
            <ErrorState error={session.error} />
            <Button onClick={() => session.refetch()}>Reintentar conexión</Button>
          </div>
        </div>
      );
    return <Login onLogin={() => qc.invalidateQueries()} />;
  }
  const { user, tenant } = session.data;
  const available = nav.filter((n) => can(user.role, n.permission));
  const active = available.find((n) => n.id === page) ?? available[0]!;
  const roleNames = {
    owner: 'Propietario',
    admin: 'Administrador',
    cashier: 'Cajero',
    stock: 'Repositor',
  };
  let content;
  switch (active.id) {
    case 'pos':
      content = <POS />;
      break;
    case 'products':
      content = <Products />;
      break;
    case 'inventory':
      content = <Inventory />;
      break;
    case 'cash':
      content = <Cash />;
      break;
    case 'customers':
      content = <Contacts kind="customers" />;
      break;
    case 'suppliers':
      content = <Contacts kind="suppliers" />;
      break;
    case 'purchases':
      content = <Purchases />;
      break;
    case 'sales':
      content = <Sales />;
      break;
    case 'settings':
      content = <SettingsPage />;
      break;
    case 'team':
      content = <Team />;
      break;
    case 'audit':
      content = <Audit />;
      break;
    default:
      content = <Dashboard reports={active.id === 'reports'} />;
  }
  return (
    <SessionContext.Provider value={{ user, tenant, go }}>
      <div className="app-shell">
        {mobile && (
          <button
            aria-label="Cerrar menú"
            className="sidebar-scrim"
            onClick={() => setMobile(false)}
          />
        )}
        <aside className={`sidebar ${mobile ? 'open' : ''}`}>
          <a className="brand" href="#dashboard">
            <span className="brand-symbol">
              <Layers size={25} />
            </span>
            <span>
              modulab<span className="brand-pos">POS</span>
              <small>GESTIÓN QUE TE ACOMPAÑA</small>
            </span>
          </a>
          <div className="store-switch">
            <span className="store-avatar">{tenant.name.charAt(0).toUpperCase()}</span>
            <span>
              <strong>{tenant.name}</strong>
              <small>Casa central</small>
            </span>
            <ChevronRight size={15} />
          </div>
          <nav aria-label="Navegación principal">
            {['TU COMERCIO', 'GESTIÓN', 'ADMINISTRACIÓN'].map((group) => (
              <div key={group} className="nav-group">
                {available.some((n) => n.group === group) && (
                  <div className="nav-label">{group}</div>
                )}
                {available
                  .filter((n) => n.group === group)
                  .map((n) => (
                    <button
                      key={n.id}
                      onClick={() => go(n.id)}
                      className={`nav-link ${active.id === n.id ? 'active' : ''}`}
                      aria-current={active.id === n.id ? 'page' : undefined}
                    >
                      <n.icon size={19} />
                      <span>{n.label}</span>
                      {active.id === n.id && <span className="active-dot" />}
                    </button>
                  ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="local-status">
              <span className="status-dot" />
              <span>
                Instalación local<small>Datos en tu servidor</small>
              </span>
            </div>
            <small>Modulab Software · v0.1.0</small>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-toggle"
                aria-label="Abrir menú"
                onClick={() => setMobile(true)}
              >
                <Menu size={22} />
              </button>
              <span>Tu comercio</span>
              <ChevronRight size={14} />
              <strong>{active.label}</strong>
            </div>
            <div className="topbar-right">
              <span className="currency-label">
                ARS <span>·</span> Argentina
              </span>
              <button
                className="icon-button"
                aria-label={dark ? 'Activar tema claro' : 'Activar tema oscuro'}
                onClick={() => setDark(!dark)}
              >
                {dark ? <Sun size={19} /> : <Moon size={19} />}
              </button>
              <div className="user-menu">
                <span className="avatar">
                  {user.name
                    .split(' ')
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <span>
                  <strong>{user.name}</strong>
                  <small>{roleNames[user.role]}</small>
                </span>
              </div>
              <button
                className="icon-button"
                aria-label="Cerrar sesión"
                onClick={async () => {
                  try {
                    await api('/auth/logout', {});
                    setCsrf('');
                    qc.clear();
                    setPage('');
                  } catch (e) {
                    setToast({ message: (e as Error).message, kind: 'error' });
                  }
                }}
              >
                <LogOut size={18} />
              </button>
            </div>
          </header>
          <main key={active.id} className={`main-content ${active.id === 'pos' ? 'pos-main' : ''}`}>
            <Suspense fallback={<Loading />}>{content}</Suspense>
          </main>
          <footer className="workspace-footer">
            <span>Tu negocio, bajo control.</span>
            <span>
              Desarrollado por <strong>Modulab Software</strong>
            </span>
          </footer>
        </div>
        {toast && (
          <div className={`toast ${toast.kind}`} role="status">
            {toast.kind === 'error' ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
            <span>{toast.message}</span>
            <button
              className="icon-button"
              onClick={() => setToast(null)}
              aria-label="Cerrar aviso"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </SessionContext.Provider>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="login-page">
      <div className="login-decoration">
        <div className="brand">
          <span className="brand-symbol">
            <Layers size={30} />
          </span>
          <span>
            modulab<span className="brand-pos">POS</span>
          </span>
        </div>
        <div>
          <span className="eyebrow">MENOS VUELTAS. MÁS NEGOCIO.</span>
          <h1>
            Todo tu comercio.
            <br />
            En un solo lugar.
          </h1>
          <p>Ventas ágiles, inventario al día y cada movimiento de caja bajo control.</p>
        </div>
        <small>Un producto de Modulab Software</small>
      </div>
      <div className="login-card">
        <div className="eyebrow">BIENVENIDO A MODULAB POS</div>
        <h1>Ingresá a tu comercio</h1>
        <p>Usá los datos que te dio el administrador de tu instalación.</p>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError('');
            try {
              await api('/auth/login', {
                tenant: f.get('tenant'),
                email: f.get('email'),
                password: f.get('password'),
              });
              onLogin();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Identificador del comercio">
            <input
              name="tenant"
              required
              autoComplete="organization"
              placeholder="mi-comercio"
              defaultValue="modulab"
            />
          </Field>
          <Field label="Correo electrónico">
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              placeholder="vos@tucomercio.com"
            />
          </Field>
          <Field label="Contraseña">
            <input name="password" type="password" required autoComplete="current-password" />
          </Field>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <Button busy={busy} type="submit">
            Ingresar al sistema <ChevronRight size={17} />
          </Button>
        </form>
        <small className="login-help">
          ¿Necesitás recuperar el acceso? Contactá al administrador de la instalación.
        </small>
      </div>
    </div>
  );
}
