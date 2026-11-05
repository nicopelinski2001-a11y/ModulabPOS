import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  Download,
  Upload,
  Package,
  Pencil,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  CheckCircle2,
} from 'lucide-react';
import { api, notify, useAction } from '../api';
import {
  PageTitle,
  Button,
  SearchBox,
  Loading,
  ErrorState,
  Empty,
  Badge,
  Modal,
  Field,
} from '../components/ui';
import { money, qty, parseDecimal, decimalInput } from '../../shared/money';
import { productSchema, type Product } from '../../shared/domain';
import { downloadCsv, parseCsv } from '../csv';
export function productBody(p: Product) {
  return {
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    description: p.description,
    category: p.category,
    brand: p.brand,
    supplier_id: p.supplier_id,
    unit: p.unit,
    price_cents: p.price_cents,
    cost_cents: p.cost_cents,
    min_stock_milli: p.min_stock_milli,
    active: p.active,
    tax_rate_bps: p.tax_rate_bps,
  };
}
export function Products() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [prices, setPrices] = useState(false);
  const [pricesKey, setPricesKey] = useState('');
  const action = useAction();
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setOffset(0);
    }, 180);
    return () => clearTimeout(t);
  }, [search]);
  const products = useQuery({
    queryKey: ['products', 'management', q, offset],
    queryFn: () =>
      api<{ items: Product[]; total: number }>(
        `/products?all=true&limit=100&offset=${offset}&q=${encodeURIComponent(q)}`,
      ),
  });
  const exportAll = () =>
    action.run(async () => {
      const all: Product[] = [];
      let cursor = 0;
      for (;;) {
        const data = await api<{ items: Product[]; total: number }>(
          `/products?all=true&limit=500&offset=${cursor}`,
        );
        all.push(...data.items);
        cursor += data.items.length;
        if (cursor >= data.total || !data.items.length) break;
      }
      downloadCsv('productos-modulab.csv', [
        [
          'sku',
          'codigo_barras',
          'nombre',
          'categoria',
          'unidad',
          'precio',
          'impuesto_incluido_porcentaje',
          'costo',
          'stock',
          'stock_minimo',
          'activo',
        ],
        ...all.map((p) => [
          p.sku,
          p.barcode,
          p.name,
          p.category,
          p.unit,
          decimalInput(p.price_cents),
          p.tax_rate_bps == null ? '' : decimalInput(p.tax_rate_bps),
          decimalInput(p.cost_cents),
          decimalInput(p.stock_milli, 3),
          decimalInput(p.min_stock_milli, 3),
          p.active ? 'si' : 'no',
        ]),
      ]);
    });
  return (
    <>
      <PageTitle
        eyebrow="TU CATÁLOGO, ORGANIZADO"
        title="Productos"
        description="Precios, costos y disponibilidad en un mismo lugar."
        action={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Importar
            </Button>
            <Button variant="secondary" busy={action.busy} onClick={exportAll}>
              <Download size={16} /> Exportar CSV
            </Button>
            <Button onClick={() => setEditing(null)}>
              <Plus size={17} /> Nuevo producto
            </Button>
          </>
        }
      />
      <section className="panel">
        <div className="list-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nombre, SKU o código de barras"
          />
          <span className="muted">{products.data?.total ?? 0} productos</span>
          <Button
            variant="secondary"
            onClick={() => {
              setPricesKey(crypto.randomUUID());
              setPrices(true);
            }}
          >
            <TrendingUp size={16} /> Actualizar precios
          </Button>
        </div>
        {products.isPending ? (
          <Loading />
        ) : products.error ? (
          <ErrorState error={products.error} />
        ) : !products.data?.items.length ? (
          <Empty
            title="No hay productos para mostrar"
            description="Agregá un producto o importá tu catálogo desde un archivo CSV."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th className="right">Costo</th>
                  <th className="right">Precio de venta</th>
                  <th className="right">Stock</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.data.items.map((p, i) => (
                  <tr key={p.id}>
                    <td>
                      <div className="table-product">
                        <span className={`product-tile tone-${i % 4}`}>
                          <Package size={20} />
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {p.sku}
                            {p.barcode && ` · ${p.barcode}`}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>{p.category}</td>
                    <td className="right">{money(p.cost_cents)}</td>
                    <td className="right strong">{money(p.price_cents)}</td>
                    <td
                      className={`right ${p.stock_milli <= p.min_stock_milli ? 'warning-text' : ''}`}
                    >
                      {qty(p.stock_milli)} {p.unit === 'kg' ? 'kg' : 'un.'}
                    </td>
                    <td>
                      <Badge tone={p.active ? 'green' : 'neutral'}>
                        {p.active ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Editar ${p.name}`}
                        onClick={() => setEditing(p)}
                      >
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>
            {products.data?.total
              ? `${offset + 1}–${Math.min(offset + 100, products.data.total)} de ${products.data.total}`
              : '0 productos'}
          </span>
          <Button
            variant="ghost"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            <ChevronLeft size={16} /> Anterior
          </Button>
          <Button
            variant="ghost"
            disabled={!products.data || offset + 100 >= products.data.total}
            onClick={() => setOffset(offset + 100)}
          >
            Siguiente <ChevronRight size={16} />
          </Button>
        </div>
      </section>
      {editing !== undefined && (
        <ProductForm product={editing} onClose={() => setEditing(undefined)} />
      )}
      {importOpen && <ImportProducts onClose={() => setImportOpen(false)} />}
      {prices && (
        <Modal title="Actualización masiva de precios" onClose={() => setPrices(false)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const raw = String(f.get('percent'));
                const bp = parseDecimal(raw.replace(/^[+-]/, '')) * (raw.startsWith('-') ? -1 : 1);
                if (
                  !confirm(
                    `¿Aplicar ${raw}% a los productos seleccionados? La acción quedará auditada.`,
                  )
                )
                  return;
                const r = await action.run(() =>
                  api<{ count: number }>('/products/prices', {
                    category: f.get('category'),
                    increase_basis_points: bp,
                    idempotency_key: pricesKey,
                  }),
                );
                if (r) {
                  notify(`Se actualizaron ${r.count} precios.`);
                  setPrices(false);
                }
              } catch (err) {
                notify((err as Error).message, 'error');
              }
            }}
          >
            <Field label="Categoría exacta" hint="Dejá vacío para incluir todo el catálogo activo.">
              <input name="category" />
            </Field>
            <Field
              label="Variación porcentual"
              hint="Ej.: 10 para aumentar 10%; -5 para reducir 5%."
            >
              <input name="percent" required inputMode="decimal" placeholder="10" />
            </Field>
            <Button type="submit" busy={action.busy}>
              Aplicar actualización
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
function ProductForm({ product: p, onClose }: { product: Product | null; onClose: () => void }) {
  const action = useAction();
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<{ id: string; name: string }[]>('/suppliers'),
  });
  return (
    <Modal title={p ? 'Editar producto' : 'Nuevo producto'} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            const body = {
              sku: f.get('sku'),
              barcode: f.get('barcode') || null,
              name: f.get('name'),
              description: f.get('description'),
              category: f.get('category') || 'General',
              brand: f.get('brand'),
              supplier_id: f.get('supplier_id') || null,
              unit: f.get('unit'),
              price_cents: parseDecimal(String(f.get('price'))),
              tax_rate_bps: f.get('tax_rate') ? parseDecimal(String(f.get('tax_rate'))) : null,
              cost_cents: parseDecimal(String(f.get('cost') || '0')),
              min_stock_milli: parseDecimal(String(f.get('min') || '0'), 3),
              active: f.get('active') === 'on',
              ...(!p
                ? { initial_stock_milli: parseDecimal(String(f.get('stock') || '0'), 3) }
                : {}),
            };
            const result = await action.run(
              () => api(p ? `/products/${p.id}` : '/products', body, p ? 'PUT' : 'POST'),
              p ? 'Producto actualizado.' : 'Producto creado.',
            );
            if (result) onClose();
          } catch (err) {
            notify((err as Error).message, 'error');
          }
        }}
      >
        <div className="form-grid">
          <Field label="Nombre del producto">
            <input name="name" required maxLength={160} defaultValue={p?.name} autoFocus />
          </Field>
          <Field label="SKU interno">
            <input name="sku" required maxLength={50} defaultValue={p?.sku} />
          </Field>
          <Field label="Código de barras (opcional)">
            <input name="barcode" maxLength={80} defaultValue={p?.barcode ?? ''} />
          </Field>
          <Field label="Categoría">
            <input name="category" required defaultValue={p?.category ?? 'General'} />
          </Field>
          <Field label="Marca">
            <input name="brand" defaultValue={p?.brand} />
          </Field>
          <Field label="Proveedor principal">
            <select name="supplier_id" defaultValue={p?.supplier_id ?? ''}>
              <option value="">Sin asignar</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Precio de venta (ARS)">
            <input
              name="price"
              required
              inputMode="decimal"
              defaultValue={p ? decimalInput(p.price_cents) : ''}
            />
          </Field>
          <Field
            label="Impuesto incluido (%)"
            hint="Vacío usa la tasa del comercio. 0 es sin impuesto."
          >
            <input
              name="tax_rate"
              inputMode="decimal"
              defaultValue={p?.tax_rate_bps == null ? '' : decimalInput(p.tax_rate_bps)}
            />
          </Field>
          <Field label="Costo (ARS)">
            <input
              name="cost"
              inputMode="decimal"
              defaultValue={p ? decimalInput(p.cost_cents) : '0'}
            />
          </Field>
          <Field label="Unidad de medida">
            <select name="unit" defaultValue={p?.unit ?? 'unit'}>
              <option value="unit">Unidad</option>
              <option value="kg">Kilogramo</option>
            </select>
          </Field>
          <Field label="Stock mínimo">
            <input
              name="min"
              inputMode="decimal"
              defaultValue={p ? decimalInput(p.min_stock_milli, 3) : '0'}
            />
          </Field>
          {!p && (
            <Field label="Stock inicial">
              <input name="stock" inputMode="decimal" defaultValue="0" />
            </Field>
          )}
        </div>
        <Field label="Descripción">
          <textarea name="description" rows={2} maxLength={1000} defaultValue={p?.description} />
        </Field>
        <label className="checkbox">
          <input name="active" type="checkbox" defaultChecked={p?.active ?? true} /> Producto activo
          y disponible para vender
        </label>
        {p && (
          <p className="form-note">
            El stock se modifica mediante movimientos de inventario. Desactivar un producto conserva
            todas sus operaciones.
          </p>
        )}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" busy={action.busy}>
            {p ? 'Guardar cambios' : 'Crear producto'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function ImportProducts({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState('');
  const action = useAction();
  const load = async (file: File) => {
    setError('');
    setRows([]);
    try {
      const parsed = parseCsv(await file.text());
      const headers = parsed.shift()!.map((h) => h.trim().toLowerCase());
      for (const h of ['sku', 'nombre', 'precio'])
        if (!headers.includes(h)) throw new Error(`Falta la columna obligatoria: ${h}`);
      if (parsed.length > 500) throw new Error('Importá hasta 500 productos por archivo.');
      if (!parsed.length) throw new Error('El archivo no contiene productos.');
      const result = parsed.map((cells, index) => {
        const data = Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()]));
        try {
          const p = productSchema.parse({
            sku: data.sku,
            name: data.nombre,
            barcode: data.codigo_barras || null,
            category: data.categoria || 'General',
            unit: data.unidad || 'unit',
            price_cents: parseDecimal(data.precio!),
            tax_rate_bps: data.impuesto_incluido_porcentaje
              ? parseDecimal(data.impuesto_incluido_porcentaje)
              : null,
            cost_cents: parseDecimal(data.costo || '0'),
            min_stock_milli: parseDecimal(data.stock_minimo || '0', 3),
            active: data.activo !== 'no',
          });
          const stock = parseDecimal(data.stock || '0', 3);
          if (p.unit === 'unit' && stock % 1000 !== 0)
            throw new Error('El stock de productos por unidad debe ser entero.');
          return { ...p, initial_stock_milli: stock };
        } catch (e) {
          throw new Error(`Fila ${index + 2}: ${(e as Error).message}`, { cause: e });
        }
      });
      if (new Set(result.map((r) => r.sku)).size !== result.length)
        throw new Error('Hay SKU repetidos dentro del archivo.');
      setRows(result);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="Importar catálogo desde CSV" onClose={onClose} wide>
      <div className="form">
        <p>
          Importá hasta 500 productos nuevos por archivo. Se validan todas las filas antes de
          guardar. Si hay un error, no se importa ninguna.
        </p>
        <Button
          variant="secondary"
          onClick={() =>
            downloadCsv('plantilla-productos.csv', [
              [
                'sku',
                'codigo_barras',
                'nombre',
                'categoria',
                'unidad',
                'precio',
                'costo',
                'stock',
                'stock_minimo',
              ],
              [
                'EJ-001',
                '',
                'Producto de ejemplo',
                'General',
                'unit',
                '1500.00',
                '1000.00',
                '10',
                '3',
              ],
            ])
          }
        >
          <Download size={16} /> Descargar plantilla
        </Button>
        <Field
          label="Archivo CSV"
          hint="Separador punto y coma, coma o tabulación. Precios sin separadores de miles. Unidades: unit o kg."
        >
          <input
            type="file"
            accept=".csv,.tsv,text/csv"
            onChange={(e) => {
              if (e.target.files?.[0]) void load(e.target.files[0]);
            }}
          />
        </Field>
        {error && <div className="alert error">{error}</div>}
        {rows.length > 0 && (
          <>
            <div className="alert success">
              <CheckCircle2 size={18} />
              {rows.length} productos validados. Se crearán los movimientos de stock inicial.
            </div>
            <div className="table-scroll import-preview">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Nombre</th>
                    <th className="right">Precio</th>
                    <th className="right">Stock inicial</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((r, i) => (
                    <tr key={i}>
                      <td>{String(r.sku)}</td>
                      <td>{String(r.name)}</td>
                      <td className="right">{money(r.price_cents as number)}</td>
                      <td className="right">{qty(r.initial_stock_milli as number)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="form-note">
              Vista previa de las primeras 20 filas. Un SKU o código de barras existente cancela el
              lote. No se modifican productos existentes.
            </p>
          </>
        )}
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!rows.length || !!error}
            busy={action.busy}
            onClick={async () => {
              const r = await action.run(
                () => api('/products/import', { products: rows }),
                'Importación completada.',
              );
              if (r) onClose();
            }}
          >
            <Upload size={16} /> Importar {rows.length || ''} productos
          </Button>
        </div>
      </div>
    </Modal>
  );
}
