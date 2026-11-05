import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  ArrowUpRight,
  ArrowRight,
  ShoppingBasket,
  ReceiptText,
  Wallet,
  TrendingUp,
  Download,
  CalendarDays,
  Package,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../api';
import { useSession } from '../context';
import {
  PageTitle,
  Button,
  Loading,
  ErrorState,
  Badge,
  Empty,
  today,
  dateTime,
} from '../components/ui';
import { money, qty } from '../../shared/money';
import { paymentNames } from '../../shared/payments';
import { type Sale } from '../../shared/domain';
import { downloadCsv } from '../csv';
type Report = {
  from: string;
  to: string;
  totals: {
    gross_cents: number;
    discount_cents: number;
    refunds_cents: number;
    net_cents: number;
    cost_cents: number;
    estimated_profit_cents: number;
    operations: number;
    returns: number;
  };
  daily: { label: string; date: string; net_cents: number }[];
  top: { product_id: string; name: string; qty_milli: number; gross_cents: number }[];
  payments: { method: keyof typeof paymentNames; amount_cents: number; pending_cents: number }[];
  stock: { low_count: number; value_cents: number };
  low: {
    id: string;
    name: string;
    sku: string;
    stock_milli: number;
    min_stock_milli: number;
    unit: string;
  }[];
};
export function Dashboard({ reports = false }: { reports?: boolean }) {
  const { tenant, user, go } = useSession();
  const localToday = today(tenant.timezone);
  const [range, setRange] = useState({ from: localToday, to: localToday });
  const [preset, setPreset] = useState('Hoy');
  const report = useQuery({
    queryKey: ['reports', range],
    queryFn: () => api<Report>(`/reports?from=${range.from}&to=${range.to}`),
  });
  const recent = useQuery({
    queryKey: ['sales', 'recent'],
    queryFn: () => api<Sale[]>('/sales?limit=5'),
    enabled: user.role !== 'stock',
  });
  const changeRange = (label: string) => {
    setPreset(label);
    const d = new Date(`${localToday}T12:00:00Z`);
    if (label === '7 días') d.setUTCDate(d.getUTCDate() - 6);
    if (label === 'Este mes') d.setUTCDate(1);
    setRange({ from: d.toISOString().slice(0, 10), to: localToday });
  };
  const r = report.data;
  return (
    <>
      <PageTitle
        eyebrow={reports ? 'INFORMACIÓN PARA DECIDIR' : 'VAMOS A HACER UN BUEN DÍA'}
        title={reports ? 'Reportes de tu comercio' : `Hola, ${user.name.split(' ')[0]}.`}
        description={
          reports
            ? 'Ventas, costos y movimientos, con números que podés seguir.'
            : 'Así está tu negocio. Todo lo importante, a primera vista.'
        }
        action={
          <>
            <Button
              variant="secondary"
              disabled={!r}
              onClick={() =>
                r &&
                downloadCsv(`reporte-${range.from}-${range.to}.csv`, [
                  ['Concepto', 'Importe ARS'],
                  ['Ventas brutas', r.totals.gross_cents / 100],
                  ['Descuentos', r.totals.discount_cents / 100],
                  ['Devoluciones', -r.totals.refunds_cents / 100],
                  ['Ventas netas', r.totals.net_cents / 100],
                  ['Costo estimado', r.totals.cost_cents / 100],
                  ['Resultado estimado', r.totals.estimated_profit_cents / 100],
                  [],
                  ['Fecha', 'Ventas netas ARS'],
                  ...r.daily.map((x) => [x.date, x.net_cents / 100]),
                ])
              }
            >
              <Download size={16} /> Exportar reporte
            </Button>
            <Button onClick={() => go('pos')}>
              <ShoppingBasket size={17} /> Nueva venta
            </Button>
          </>
        }
      />
      <div className="period-toolbar">
        <div className="segmented">
          {['Hoy', '7 días', 'Este mes'].map((p) => (
            <button
              key={p}
              className={preset === p ? 'selected' : ''}
              onClick={() => changeRange(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="date-range">
          <CalendarDays size={16} />
          <input
            type="date"
            aria-label="Desde"
            value={range.from}
            onChange={(e) => {
              setPreset('');
              setRange({ ...range, from: e.target.value });
            }}
          />
          <span>—</span>
          <input
            type="date"
            aria-label="Hasta"
            value={range.to}
            onChange={(e) => {
              setPreset('');
              setRange({ ...range, to: e.target.value });
            }}
          />
        </div>
        <span className="timezone">
          Hora del comercio · {tenant.timezone.split('/').pop()?.replaceAll('_', ' ')}
        </span>
      </div>
      {report.isPending ? (
        <Loading />
      ) : report.error ? (
        <ErrorState error={report.error} />
      ) : (
        r && (
          <>
            <div className="metric-grid">
              {[
                {
                  label: 'Ventas netas',
                  value: money(r.totals.net_cents),
                  hint: `${r.totals.returns} devoluciones en el período`,
                  icon: Wallet,
                  color: 'blue',
                },
                {
                  label: 'Operaciones',
                  value: r.totals.operations.toLocaleString('es-AR'),
                  hint: 'Ventas completadas',
                  icon: ReceiptText,
                  color: 'violet',
                },
                {
                  label: 'Ticket promedio',
                  value: money(
                    r.totals.operations
                      ? Math.round(
                          (r.totals.net_cents - r.totals.refunds_cents) / r.totals.operations,
                        )
                      : 0,
                  ),
                  hint: 'Ventas cobradas ÷ operaciones',
                  icon: ShoppingBasket,
                  color: 'cyan',
                },
                {
                  label: 'Resultado estimado',
                  value: money(r.totals.estimated_profit_cents),
                  hint: 'Ventas netas menos costo histórico',
                  icon: TrendingUp,
                  color: 'green',
                },
              ].map((m) => (
                <div key={m.label} className="metric-card">
                  <div className="metric-label">
                    {m.label}
                    <span className={`metric-icon ${m.color}`}>
                      <m.icon size={19} />
                    </span>
                  </div>
                  <strong>{m.value}</strong>
                  <small>{m.hint}</small>
                </div>
              ))}
            </div>
            <div className="dashboard-grid">
              <section className="panel sales-chart">
                <div className="panel-heading">
                  <div>
                    <h2>Evolución de ventas</h2>
                    <p>Ventas netas por día, en pesos argentinos</p>
                  </div>
                  <Badge tone="blue">
                    <span className="legend-dot" /> Ventas netas
                  </Badge>
                </div>
                {r.totals.operations === 0 && r.totals.returns === 0 ? (
                  <div className="chart-empty">
                    <div className="chart-empty-icon">
                      <ChartIcon />
                    </div>
                    <h3>Tu próxima venta empieza acá</h3>
                    <p>La evolución de tu comercio va a aparecer con cada operación.</p>
                    <Button variant="secondary" onClick={() => go('pos')}>
                      Ir al punto de venta <ArrowRight size={16} />
                    </Button>
                  </div>
                ) : (
                  <div className="chart-container">
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={r.daily} margin={{ top: 20, right: 15, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.22} />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="4 5"
                          vertical={false}
                          stroke="var(--border)"
                        />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'var(--muted)', fontSize: 11 }}
                        />
                        <YAxis
                          tickFormatter={(v) => `$${Number(v) / 100000}k`}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'var(--muted)', fontSize: 11 }}
                        />
                        <Tooltip
                          formatter={(v) => money(Number(v))}
                          labelFormatter={(l) => String(l)}
                          contentStyle={{
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: 10,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="net_cents"
                          name="Ventas netas"
                          stroke="#3b82f6"
                          strokeWidth={2.5}
                          fill="url(#salesFill)"
                          dot={r.daily.length === 1}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
              <section className="panel payment-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Medios de pago</h2>
                    <p>Importes registrados, netos de devoluciones</p>
                  </div>
                  <Wallet size={19} className="muted" />
                </div>
                {!r.payments.length ? (
                  <Empty
                    title="Sin pagos registrados"
                    description="Cada medio tendrá su propio detalle."
                  />
                ) : (
                  <div className="payment-list">
                    {r.payments.map((p, i) => (
                      <div key={p.method} className="payment-row">
                        <div>
                          <span
                            className="payment-dot"
                            style={{
                              background: ['#3b82f6', '#14b8a6', '#8b5cf6', '#f59e0b', '#ec4899'][
                                i % 5
                              ],
                            }}
                          />
                          {paymentNames[p.method]}
                          <strong>{money(p.amount_cents)}</strong>
                        </div>
                        <div className="progress-track">
                          <div
                            style={{
                              width: `${Math.max(0, Math.min(100, (p.amount_cents / Math.max(1, r.totals.net_cents)) * 100))}%`,
                              background: ['#3b82f6', '#14b8a6', '#8b5cf6', '#f59e0b', '#ec4899'][
                                i % 5
                              ],
                            }}
                          />
                        </div>
                        {p.pending_cents !== 0 && (
                          <small className="warning-text">
                            Pendiente: {money(p.pending_cents)}
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="panel-note">
                  Los pagos manuales no tienen verificación bancaria.
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Productos más vendidos</h2>
                    <p>Cantidades netas del período</p>
                  </div>
                  <button className="text-button" onClick={() => go('products')}>
                    Ver productos <ArrowUpRight size={15} />
                  </button>
                </div>
                {r.top.length ? (
                  <div className="top-products">
                    {r.top.map((p, i) => (
                      <div className="top-product" key={p.product_id}>
                        <span className="rank">{String(i + 1).padStart(2, '0')}</span>
                        <span className={`product-tile tone-${i % 4}`}>
                          <Package size={21} />
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>{qty(p.qty_milli)} unidades / kg</small>
                        </span>
                        <strong>{money(p.gross_cents)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="Todo listo para empezar"
                    description="Los productos vendidos van a aparecer acá."
                  />
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Atención al inventario</h2>
                    <p>Productos que llegaron al stock mínimo</p>
                  </div>
                  <Badge tone={r.stock.low_count ? 'amber' : 'green'}>
                    {r.stock.low_count} por reponer
                  </Badge>
                </div>
                {r.low.length ? (
                  <div className="low-stock-list">
                    {r.low.map((p) => (
                      <div key={p.id} className="low-stock-row">
                        <span className="low-icon">
                          <AlertTriangle size={17} />
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            SKU {p.sku} · Mínimo {qty(p.min_stock_milli)}
                          </small>
                        </span>
                        <Badge tone="amber">
                          {qty(p.stock_milli)} {p.unit === 'kg' ? 'kg' : 'un.'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="Tu stock está al día"
                    description="No hay productos por debajo del mínimo."
                  />
                )}
                <button className="panel-link" onClick={() => go('inventory')}>
                  Revisar inventario <ArrowRight size={15} />
                </button>
              </section>
            </div>
            {reports && (
              <div className="panel report-breakdown">
                <h2>Cómo se componen los resultados</h2>
                <div className="stat-line">
                  <span>Ventas brutas (antes de descuentos)</span>
                  <strong>{money(r.totals.gross_cents)}</strong>
                </div>
                <div className="stat-line">
                  <span>Descuentos</span>
                  <strong>− {money(r.totals.discount_cents)}</strong>
                </div>
                <div className="stat-line">
                  <span>Devoluciones (fecha de devolución)</span>
                  <strong>{money(r.totals.refunds_cents)}</strong>
                </div>
                <div className="stat-line">
                  <span>Costo histórico neto</span>
                  <strong>{money(r.totals.cost_cents)}</strong>
                </div>
                <div className="stat-line">
                  <span>Inventario valorizado al costo actual</span>
                  <strong>{money(r.stock.value_cents)}</strong>
                </div>
                <p className="muted">
                  El resultado estimado no incluye gastos operativos ni cálculo impositivo. Las
                  ventas a cuenta forman parte de las ventas; no representan cobros.
                </p>
              </div>
            )}
            {!reports && (
              <section className="panel recent-sales">
                <div className="panel-heading">
                  <div>
                    <h2>Últimas operaciones</h2>
                    <p>El movimiento más reciente de tu comercio</p>
                  </div>
                  <button className="text-button" onClick={() => go('sales')}>
                    Ver todas las ventas <ArrowRight size={15} />
                  </button>
                </div>
                {recent.data?.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Operación</th>
                          <th>Fecha y hora</th>
                          <th>Responsable</th>
                          <th>Estado</th>
                          <th className="right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recent.data.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <strong>#{String(s.number).padStart(6, '0')}</strong>
                            </td>
                            <td>{dateTime(s.created_at, tenant.timezone)}</td>
                            <td>{s.user_name}</td>
                            <td>
                              <Badge tone={s.returned ? 'amber' : 'green'}>
                                {s.returned ? 'Devuelta' : 'Completada'}
                              </Badge>
                            </td>
                            <td className="right strong">{money(s.total_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="Sin operaciones todavía"
                    description="Registrá tu primera venta desde el punto de venta."
                  />
                )}
              </section>
            )}
          </>
        )
      )}
    </>
  );
}
function ChartIcon() {
  return <TrendingUp size={31} />;
}
