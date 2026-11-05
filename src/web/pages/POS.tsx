import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ScanLine,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  Pause,
  Play,
  ArrowRight,
  Wallet,
  Check,
  X,
  Keyboard,
  AlertTriangle,
} from 'lucide-react';
import { api, ApiError, notify, useAction } from '../api';
import { confirmSale } from '../sale-client';
import { useSession } from '../context';
import {
  Button,
  PageTitle,
  Modal,
  Field,
  Loading,
  ErrorState,
  Empty,
  Badge,
} from '../components/ui';
import { money, qty, lineTotal, sumMoney, parseDecimal, decimalInput } from '../../shared/money';
import { saleTotals } from '../../shared/totals';
import { saleSchema, productSchema } from '../../shared/domain';
import { can } from '../../shared/permissions';
import { paymentNames, paymentMethods } from '../../shared/payments';
import { type Product, type Shift, type SaleInput, type Sale } from '../../shared/domain';
import { Receipt } from '../components/Receipt';
function playScanSound() {
  try {
    const context = new AudioContext();
    const tone = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = 0.025;
    tone.frequency.value = 880;
    tone.connect(gain).connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.06);
    tone.onended = () => {
      void context.close();
    };
  } catch {
    /* visual feedback remains available */
  }
}
type CartItem = { product: Product; qty_milli: number };
type Held = { id: string; label: string; items: { product_id: string; qty_milli: number }[] };
type Customer = { id: string; name: string; balance_cents: number; credit_limit_cents: number };
function readStorage<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function productFields(product: Product | undefined) {
  if (!product) return {};
  const { id, stock_milli, updated_at, ...fields } = product;
  // Catalog contains server metadata and cashiers intentionally receive no cost.
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key in productSchema.shape));
}
export function POS() {
  const { user, tenant, go } = useSession();
  const qc = useQueryClient();
  const draftKey = `modulab-cart:${user.tenant_id}:${user.user_id}`;
  const pendingKey = `modulab-pending:${user.tenant_id}:${user.user_id}`;
  const [cart, updateCart] = useState<CartItem[]>(() => {
    const saved = readStorage<unknown>(draftKey, []);
    if (!Array.isArray(saved)) return [];
    const restored = saved
      .filter(
        (item) =>
          item &&
          productSchema.safeParse(productFields(item.product)).success &&
          typeof item.product.id === 'string' &&
          Number.isSafeInteger(item.qty_milli) &&
          item.qty_milli > 0 &&
          item.qty_milli <= 1_000_000_000,
      )
      .slice(0, 200);
    try {
      sumMoney(restored.map((i) => lineTotal(i.product.price_cents, i.qty_milli)));
      return restored;
    } catch {
      return [];
    }
  });
  const cartRef = useRef(cart);
  const setCart = useCallback((next: CartItem[] | ((previous: CartItem[]) => CartItem[])) => {
    try {
      const updated = typeof next === 'function' ? next(cartRef.current) : next;
      if (updated === cartRef.current) return false;
      if (updated.length > 200) throw new Error('Se permiten hasta 200 productos por venta.');
      sumMoney(updated.map((item) => lineTotal(item.product.price_cents, item.qty_milli)));
      cartRef.current = updated;
      updateCart(updated);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Carrito inválido.', 'error');
      return false;
    }
  }, []);
  const [pending, setPending] = useState<SaleInput | null>(() => {
    const parsed = saleSchema.safeParse(readStorage(pendingKey, null));
    return parsed.success ? parsed.data : null;
  });
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [posting, setPosting] = useState(false);
  const [scanning, setScanning] = useState(0);
  const scansInFlight = useRef(0);
  const [quantityEdit, setQuantityEdit] = useState<CartItem | null>(null);
  const [holdLabel, setHoldLabel] = useState('');
  const [suspend, setSuspend] = useState(false);
  const [lastAdded, setLastAdded] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const postingRef = useRef(false);
  const action = useAction();
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(cart));
    } catch {
      notify('No se pudo guardar el carrito en este navegador.', 'error');
    }
  }, [cart, draftKey]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 150);
    return () => clearTimeout(t);
  }, [search]);
  const products = useQuery({
    queryKey: ['products', 'pos', query, category],
    queryFn: () =>
      api<{ items: Product[]; total: number }>(
        `/products?q=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}&limit=60`,
      ),
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<string[]>('/products/categories'),
  });
  const shifts = useQuery({ queryKey: ['shifts'], queryFn: () => api<Shift[]>('/cash/shifts') });
  const shift = shifts.data?.find((s) => !s.closed_at && s.user_id === user.user_id);
  const held = useQuery({ queryKey: ['held'], queryFn: () => api<Held[]>('/held-sales') });
  const customers = useQuery({
    queryKey: ['customers'],
    queryFn: () => api<Customer[]>('/customers'),
  });
  const subtotal = sumMoney(cart.map((i) => lineTotal(i.product.price_cents, i.qty_milli)));
  const add = useCallback(
    (p: Product, clearSearch = true) => {
      if (pending || postingRef.current) return;
      const changed = setCart((prev) => {
        const old = prev.find((i) => i.product.id === p.id);
        if ((old && old.qty_milli >= 1_000_000_000) || (!old && prev.length >= 200)) {
          notify('Se alcanzó el límite de cantidad o productos por venta.', 'error');
          return prev;
        }
        return old
          ? prev.map((i) =>
              i.product.id === p.id ? { product: p, qty_milli: i.qty_milli + 1000 } : i,
            )
          : [...prev, { product: p, qty_milli: 1000 }];
      });
      if (!changed) return;
      playScanSound();
      setLastAdded(p.name);
      setTimeout(() => setLastAdded(''), 2200);
      if (clearSearch) setSearch('');
      input.current?.focus();
    },
    [pending],
  );
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (postingRef.current) return;
      if (event.key === pendingKey) {
        const saved = saleSchema.safeParse(readStorage(pendingKey, null));
        setPending(saved.success ? saved.data : null);
      }
      if (event.key === draftKey) {
        // Another tab owns the same operator draft. Reload validates it on entry.
        setCheckout(false);
        const saved = readStorage<CartItem[]>(draftKey, []);
        if (Array.isArray(saved)) setCart(saved);
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [draftKey, pendingKey]);
  const submit = useCallback(
    async (body: SaleInput) => {
      if (postingRef.current) return;
      postingRef.current = true;
      setPosting(true);
      try {
        const send = async () => {
          const saved = saleSchema.safeParse(readStorage(pendingKey, null));
          if (saved.success) body = saved.data;
          else {
            if (localStorage.getItem(pendingKey))
              throw new Error(
                'La venta pendiente guardada no se pudo leer. Conservá este navegador y contactá al administrador para recuperar la clave antes de cobrar.',
              );
            const stored = readStorage<CartItem[]>(draftKey, []);
            if (!stored.length)
              throw new Error('Este carrito ya fue cobrado o vaciado en otra pestaña.');
          }
          // Persist the exact intent BEFORE sending: a lost response must reuse the key and body.
          localStorage.setItem(pendingKey, JSON.stringify(body));
          setPending(body);
          const result = await confirmSale(body, user.user_id);
          localStorage.removeItem(pendingKey);
          localStorage.setItem(draftKey, '[]');
          setPending(null);
          setCart([]);
          setCheckout(false);
          setReceipt(result);
          await qc.invalidateQueries();
        };
        if (navigator.locks) await navigator.locks.request(pendingKey, send);
        else await send();
      } catch (e) {
        if (
          e instanceof ApiError &&
          e.status >= 400 &&
          e.status < 500 &&
          e.status !== 401 &&
          e.status !== 429
        ) {
          localStorage.removeItem(pendingKey);
          setPending(null);
        }
        notify(e instanceof Error ? e.message : 'No se pudo completar la venta.', 'error');
      } finally {
        postingRef.current = false;
        setPosting(false);
        // A competing tab may have completed this shared draft while we waited.
        try {
          if (localStorage.getItem(draftKey) === '[]') setCart([]);
        } catch {
          /* storage error was reported before sending */
        }
      }
    },
    [pendingKey, draftKey, qc, user.user_id],
  );
  const startCheckout = useCallback(async () => {
    if (scansInFlight.current) {
      notify('Esperá a que terminen de agregarse los códigos escaneados.', 'error');
      return;
    }
    if (pending) {
      setCheckout(true);
      return;
    }
    if (!cart.length) {
      input.current?.focus();
      return;
    }
    let readyShift = shift;
    if (!readyShift) {
      const refreshed = await shifts.refetch();
      if (refreshed.error) {
        notify(
          'No se pudo consultar la caja. Revisá la conexión al servidor e intentá de nuevo.',
          'error',
        );
        return;
      }
      readyShift = refreshed.data?.find((s) => !s.closed_at && s.user_id === user.user_id);
    }
    if (!readyShift) {
      notify('Abrí tu caja antes de cobrar.', 'error');
      return;
    }
    const updated = await action.run(async () =>
      Promise.all(
        cart.map(async (i) => ({ ...i, product: await api<Product>(`/products/${i.product.id}`) })),
      ),
    );
    if (updated) {
      setCart(updated);
      setCheckout(true);
    }
  }, [pending, cart, shift, shifts, user.user_id, action]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === 'F8' && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        void startCheckout();
      }
      if (e.key === 'Escape' && !checkout && !heldOpen && !suspend) {
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [startCheckout, checkout, heldOpen, suspend]);
  const scan = async () => {
    const code = search.trim();
    if (!code || pending || postingRef.current) return;
    // Capture each scanner input before awaiting I/O. Slow responses must never
    // drop a subsequent scan or clear a code the operator has just started typing.
    setSearch('');
    scansInFlight.current++;
    setScanning(scansInFlight.current);
    try {
      const result = await api<{ items: Product[] }>(
        `/products?q=${encodeURIComponent(code)}&limit=60`,
      );
      const exact = result.items.find(
        (p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase(),
      );
      if (exact) add(exact, false);
      else if (result.items.length === 1) add(result.items[0]!, false);
      else
        notify(
          result.items.length
            ? 'Seleccioná un producto de la lista.'
            : 'No encontramos ese producto.',
          'error',
        );
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo buscar el código.', 'error');
    } finally {
      scansInFlight.current--;
      setScanning(scansInFlight.current);
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="CADA VENTA, MÁS SIMPLE"
        title="Punto de venta"
        description="Buscá, escaneá y cobrá. El resto se actualiza solo."
        action={
          <>
            <Button variant="secondary" onClick={() => setHeldOpen(true)} disabled={!!pending}>
              <Pause size={16} /> Suspendidas <Badge>{held.data?.length ?? 0}</Badge>
            </Button>
            <Badge tone={shift ? 'green' : 'amber'}>
              {shifts.isPending ? 'Consultando caja…' : shift ? 'Caja abierta' : 'Sin caja abierta'}
            </Badge>
          </>
        }
      />
      {!shift && !shifts.isPending && (
        <div className="alert warning">
          <Wallet size={19} />
          <span>Necesitás abrir un turno de caja para completar ventas.</span>
          <button className="text-button" onClick={() => go('cash')}>
            Abrir caja <ArrowRight size={15} />
          </button>
        </div>
      )}
      {pending && (
        <div className="alert warning">
          <AlertTriangle size={19} />
          <span>
            Hay una venta pendiente de confirmar. Reintentá para consultar o completar la misma
            operación sin duplicarla.
          </span>
          <Button variant="secondary" busy={posting} onClick={() => submit(pending)}>
            Reintentar operación
          </Button>
        </div>
      )}
      <div className="pos-grid">
        <section className="pos-catalog">
          <form
            className="scan-search"
            onSubmit={(e) => {
              e.preventDefault();
              void scan();
            }}
          >
            <ScanLine size={23} />
            <input
              ref={input}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Escaneá un código o buscá por nombre / SKU"
              aria-label="Escanear o buscar productos"
              autoFocus
              disabled={!!pending}
            />
            {search && (
              <button
                type="button"
                className="icon-button"
                aria-label="Limpiar búsqueda"
                onClick={() => {
                  setSearch('');
                  input.current?.focus();
                }}
              >
                <X size={17} />
              </button>
            )}
            <kbd>F2</kbd>
          </form>
          <div className="category-tabs">
            <button className={!category ? 'selected' : ''} onClick={() => setCategory('')}>
              Todos los productos
            </button>
            {categories.data?.map((c) => (
              <button
                className={category === c ? 'selected' : ''}
                onClick={() => setCategory(c)}
                key={c}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="catalog-meta">
            <span>
              {products.data?.total ?? 0} productos{' '}
              {products.data &&
                (products.data.total > 60 ? '· Mostrando 60, refiná tu búsqueda' : '')}
            </span>
            <span className="added-feedback" role="status">
              {lastAdded && (
                <>
                  <Check size={14} />
                  {lastAdded} agregado
                </>
              )}
            </span>
          </div>
          {products.isPending ? (
            <Loading />
          ) : products.error ? (
            <ErrorState error={products.error} />
          ) : !products.data?.items.length ? (
            <Empty
              title="No encontramos productos"
              description="Probá con otro nombre, código de barras o SKU."
            />
          ) : (
            <div className="product-grid">
              {products.data.items.map((p, index) => (
                <button
                  className="product-card"
                  key={p.id}
                  onClick={() =>
                    p.unit === 'kg' ? setQuantityEdit({ product: p, qty_milli: 1000 }) : add(p)
                  }
                  disabled={!!pending || posting}
                >
                  <div
                    className={`product-art tone-${category ? (categories.data?.indexOf(category) ?? 0) % 4 : index % 4}`}
                  >
                    <ProductGlyph category={p.category} />
                    <span className="product-add">
                      <Plus size={17} />
                    </span>
                  </div>
                  <div className="product-card-info">
                    <small>{p.category}</small>
                    <strong>{p.name}</strong>
                    <div>
                      <b>
                        {money(p.price_cents)}
                        {p.unit === 'kg' && <small> / kg</small>}
                      </b>
                      <span className={p.stock_milli <= p.min_stock_milli ? 'low-qty' : ''}>
                        {qty(p.stock_milli)} {p.unit === 'kg' ? 'kg' : 'un.'}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="keyboard-hint">
            <Keyboard size={16} />
            <span>
              <kbd>F2</kbd> Buscar producto
            </span>
            <span>
              <kbd>F8</kbd> Cobrar venta
            </span>
            <span>
              <kbd>Enter</kbd> Agregar por código
            </span>
          </div>
        </section>
        <aside className="cart-panel">
          <div className="cart-heading">
            <span className="cart-icon">
              <ShoppingCart size={20} />
            </span>
            <div>
              <h2>Venta actual</h2>
              <small>
                {cart.length} {cart.length === 1 ? 'producto' : 'productos'}
              </small>
            </div>
            <button
              className="icon-button"
              title="Vaciar carrito"
              aria-label="Vaciar carrito"
              disabled={!cart.length || !!pending}
              onClick={() => {
                if (confirm('¿Vaciar el carrito actual?')) setCart([]);
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
          <div className="cart-lines">
            {!cart.length ? (
              <div className="empty-cart">
                <div>
                  <ShoppingCart size={35} />
                </div>
                <h3>Tu carrito está listo</h3>
                <p>Escaneá un código o elegí un producto para empezar una venta.</p>
              </div>
            ) : (
              cart.map((i) => (
                <div className="cart-item" key={i.product.id}>
                  <div className="cart-item-title">
                    <strong>{i.product.name}</strong>
                    <button
                      className="icon-button"
                      aria-label={`Eliminar ${i.product.name}`}
                      disabled={!!pending}
                      onClick={() => setCart(cart.filter((x) => x !== i))}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <small>
                    {money(i.product.price_cents)}
                    {i.product.unit === 'kg' ? ' / kg' : ' por unidad'}
                  </small>
                  <div className="cart-item-bottom">
                    <div className="quantity-control">
                      <button
                        aria-label={`Quitar una unidad de ${i.product.name}`}
                        disabled={!!pending}
                        onClick={() =>
                          setCart(
                            cart.flatMap((x) =>
                              x !== i
                                ? [x]
                                : i.qty_milli > 1000
                                  ? [{ ...i, qty_milli: i.qty_milli - 1000 }]
                                  : [],
                            ),
                          )
                        }
                      >
                        <Minus size={13} />
                      </button>
                      <button
                        className="qty-value"
                        disabled={!!pending}
                        onClick={() => setQuantityEdit(i)}
                      >
                        {qty(i.qty_milli)}
                        {i.product.unit === 'kg' ? ' kg' : ''}
                      </button>
                      <button
                        aria-label={`Agregar una unidad de ${i.product.name}`}
                        disabled={!!pending}
                        onClick={() => add(i.product)}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <strong>{money(lineTotal(i.product.price_cents, i.qty_milli))}</strong>
                  </div>
                  {!tenant.allow_negative_stock && i.qty_milli > i.product.stock_milli && (
                    <small className="warning-text">La cantidad supera el stock disponible.</small>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="cart-summary">
            <div>
              <span>Subtotal</span>
              <strong>{money(subtotal)}</strong>
            </div>
            <small>Los descuentos se aplican al cobrar.</small>
            <div className="cart-total">
              <span>Total</span>
              <strong>{money(subtotal)}</strong>
            </div>
            <Button
              className="checkout-button"
              disabled={(!cart.length && !pending) || !shift || scanning > 0}
              busy={posting || action.busy || scanning > 0}
              onClick={() => void startCheckout()}
            >
              Cobrar venta{' '}
              <span>
                F8 <ArrowRight size={17} />
              </span>
            </Button>
            <Button
              variant="secondary"
              disabled={!cart.length || !!pending}
              onClick={() => setSuspend(true)}
            >
              <Pause size={15} /> Suspender venta
            </Button>
          </div>
        </aside>
      </div>
      {quantityEdit && (
        <Modal
          title={quantityEdit.product.unit === 'kg' ? 'Cantidad por peso' : 'Modificar cantidad'}
          onClose={() => setQuantityEdit(null)}
        >
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const q = parseDecimal(String(f.get('qty')), 3);
                if (
                  q < 1 ||
                  q > 1_000_000_000 ||
                  (quantityEdit.product.unit === 'unit' && q % 1000 !== 0)
                )
                  throw new Error('Ingresá una cantidad válida.');
                setCart((prev) =>
                  prev.some((i) => i.product.id === quantityEdit.product.id)
                    ? prev.map((i) =>
                        i.product.id === quantityEdit.product.id ? { ...i, qty_milli: q } : i,
                      )
                    : [...prev, { ...quantityEdit, qty_milli: q }],
                );
                setQuantityEdit(null);
              } catch (err) {
                notify((err as Error).message, 'error');
              }
            }}
          >
            <p>
              {quantityEdit.product.name} · {money(quantityEdit.product.price_cents)}
              {quantityEdit.product.unit === 'kg' ? ' / kg' : ''}
            </p>
            <Field
              label={
                quantityEdit.product.unit === 'kg' ? 'Peso en kilogramos' : 'Cantidad de unidades'
              }
            >
              <input
                name="qty"
                autoFocus
                required
                inputMode="decimal"
                defaultValue={decimalInput(quantityEdit.qty_milli, 3)}
              />
            </Field>
            <Button type="submit">Confirmar cantidad</Button>
          </form>
        </Modal>
      )}
      {suspend && (
        <Modal title="Suspender venta" onClose={() => setSuspend(false)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await action.run(
                () =>
                  api('/held-sales', {
                    label: holdLabel,
                    items: cart.map((i) => ({ product_id: i.product.id, qty_milli: i.qty_milli })),
                  }),
                'Venta suspendida.',
              );
              if (result) {
                setCart([]);
                setSuspend(false);
                setHoldLabel('');
              }
            }}
          >
            <Field label="Nombre o referencia">
              <input
                value={holdLabel}
                onChange={(e) => setHoldLabel(e.target.value)}
                required
                maxLength={80}
                placeholder="Ej.: cliente vuelve en un rato"
                autoFocus
              />
            </Field>
            <p className="muted">La venta suspendida no reserva stock ni conserva precios.</p>
            <Button type="submit" busy={action.busy}>
              Guardar y continuar
            </Button>
          </form>
        </Modal>
      )}
      {heldOpen && (
        <Modal title="Ventas suspendidas" onClose={() => setHeldOpen(false)}>
          {!held.data?.length ? (
            <Empty title="No hay ventas suspendidas" />
          ) : (
            <div className="held-list">
              {held.data.map((h) => (
                <div key={h.id}>
                  <span>
                    <strong>{h.label}</strong>
                    <small>{h.items.length} productos · precios al recuperar</small>
                  </span>
                  <Button
                    variant="secondary"
                    busy={action.busy}
                    onClick={async () => {
                      if (cart.length && !confirm('¿Reemplazar el carrito actual con esta venta?'))
                        return;
                      const data = await action.run(async () => {
                        const items = await Promise.all(
                          h.items.map(async (i) => ({
                            product: await api<Product>(`/products/${i.product_id}`),
                            qty_milli: i.qty_milli,
                          })),
                        );
                        localStorage.setItem(draftKey, JSON.stringify(items));
                        setCart(items);
                        await api(`/held-sales/${h.id}`, {}, 'DELETE');
                        return true;
                      });
                      if (data) setHeldOpen(false);
                    }}
                  >
                    <Play size={14} /> Recuperar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
      {checkout && (
        <Checkout
          cart={cart}
          shift={shift}
          customers={customers.data ?? []}
          pending={pending}
          busy={posting}
          onSubmit={submit}
          onClose={() => setCheckout(false)}
        />
      )}
      {receipt && (
        <Receipt
          sale={receipt}
          success
          onClose={() => {
            setReceipt(null);
            input.current?.focus();
          }}
        />
      )}
    </>
  );
}
function ProductGlyph({ category }: { category: string }) {
  const symbols: Record<string, string> = {
    Bebidas: '◒',
    Golosinas: '▧',
    Almacén: '▱',
    Snacks: '◈',
    Limpieza: '◐',
    Lácteos: '▥',
  };
  return <span className="product-glyph">{symbols[category] ?? '◈'}</span>;
}
function Checkout({
  cart,
  shift,
  customers,
  pending,
  busy,
  onSubmit,
  onClose,
}: {
  cart: CartItem[];
  shift: Shift | undefined;
  customers: Customer[];
  pending: SaleInput | null;
  busy: boolean;
  onSubmit: (b: SaleInput) => Promise<void>;
  onClose: () => void;
}) {
  const { user, tenant } = useSession();
  const subtotal = sumMoney(cart.map((i) => lineTotal(i.product.price_cents, i.qty_milli)));
  const [discount, setDiscount] = useState('0');
  const [customer, setCustomer] = useState('');
  const [methods, setMethods] = useState<
    Array<{ method: (typeof paymentMethods)[number]; amount: string; status: 'manual' | 'pending' }>
  >([{ method: 'cash', amount: decimalInput(subtotal), status: 'manual' }]);
  const [tendered, setTendered] = useState('');
  let discountCents = 0;
  try {
    discountCents = parseDecimal(discount || '0');
  } catch {
    /* invalid form gets explicit error on submission */
  }
  const total = subtotal - discountCents;
  let includedTax = 0;
  try {
    includedTax = saleTotals(
      cart.map((i) => ({
        id: i.product.id,
        price_cents: i.product.price_cents,
        qty_milli: i.qty_milli,
        tax_rate_bps: i.product.tax_rate_bps ?? tenant.tax_rate_bps,
      })),
      discountCents,
    ).tax_cents;
  } catch {
    /* validated on submit */
  }
  let applied = 0;
  try {
    applied = sumMoney(methods.map((p) => parseDecimal(p.amount || '0')));
  } catch {
    /* form validation reports invalid amounts on submit */
  }
  let cashChange = 0;
  try {
    cashChange =
      parseDecimal(tendered || '0') -
      (methods.find((m) => m.method === 'cash')
        ? parseDecimal(methods.find((m) => m.method === 'cash')!.amount)
        : 0);
  } catch {
    /* form validation reports invalid amounts on submit */
  }
  return (
    <Modal title={pending ? 'Confirmar operación pendiente' : 'Cobrar venta'} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) {
            void onSubmit(pending);
            return;
          }
          if (!shift) return;
          try {
            const d = parseDecimal(discount || '0');
            const body: SaleInput = {
              idempotency_key: crypto.randomUUID(),
              shift_id: shift.id,
              customer_id: customer || null,
              discount_cents: d,
              items: cart.map((i) => ({ product_id: i.product.id, qty_milli: i.qty_milli })),
              payments: methods.map((p) => {
                const amount = parseDecimal(p.amount);
                return {
                  method: p.method,
                  amount_cents: amount,
                  tendered_cents: p.method === 'cash' && tendered ? parseDecimal(tendered) : amount,
                  status: p.status,
                };
              }),
            };
            saleSchema.parse(body);
            saleTotals(
              cart.map((i) => ({
                id: i.product.id,
                price_cents: i.product.price_cents,
                qty_milli: i.qty_milli,
                tax_rate_bps: i.product.tax_rate_bps ?? tenant.tax_rate_bps,
              })),
              d,
            );
            if (body.payments.some((p) => !p.amount_cents))
              throw new Error('Los pagos deben ser mayores a cero.');
            if (sumMoney(body.payments.map((p) => p.amount_cents)) !== subtotal - d)
              throw new Error('Los pagos deben cubrir exactamente el total.');
            void onSubmit(body);
          } catch (err) {
            notify((err as Error).message, 'error');
          }
        }}
      >
        <div className="checkout-total">
          <small>Total a cobrar</small>
          <strong>
            {money(
              pending ? sumMoney(pending.payments.map((p) => p.amount_cents)) : Math.max(0, total),
            )}
          </strong>
          <span>{cart.length} productos · ARS</span>
          {!pending && <small>Impuestos incluidos: {money(includedTax)}</small>}
        </div>
        {pending ? (
          <div className="alert warning">
            Se consultará o completará la operación guardada con los mismos productos y pagos.
          </div>
        ) : (
          <>
            <div className="form-grid">
              <Field label="Cliente">
                <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
                  <option value="">Consumidor final</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              {can(user.role, 'discount') && (
                <Field label="Descuento en pesos">
                  <input
                    value={discount}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDiscount(value);
                      if (methods.length === 1) {
                        try {
                          setMethods([
                            {
                              ...methods[0]!,
                              amount: decimalInput(
                                Math.max(0, subtotal - parseDecimal(value || '0')),
                              ),
                            },
                          ]);
                        } catch {
                          /* keep last amount while editing */
                        }
                      }
                    }}
                    inputMode="decimal"
                  />
                </Field>
              )}
            </div>
            <div className="payment-editor">
              <div className="section-title">
                <h3>Medios de pago</h3>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={methods.length >= 6}
                  onClick={() => {
                    const method = paymentMethods.find(
                      (m) => !methods.some((p) => p.method === m),
                    )!;
                    setMethods([
                      ...methods,
                      {
                        method,
                        amount: decimalInput(Math.max(0, total - applied)),
                        status: 'manual',
                      },
                    ]);
                  }}
                >
                  <Plus size={14} /> Combinar
                </Button>
              </div>
              {methods.map((p, index) => (
                <div className="payment-edit-row" key={index}>
                  <select
                    aria-label={`Medio de pago ${index + 1}`}
                    value={p.method}
                    onChange={(e) =>
                      setMethods(
                        methods.map((x, i) =>
                          i === index
                            ? { ...x, method: e.target.value as typeof p.method, status: 'manual' }
                            : x,
                        ),
                      )
                    }
                  >
                    {paymentMethods
                      .filter((m) => m === p.method || !methods.some((x) => x.method === m))
                      .map((m) => (
                        <option key={m} value={m}>
                          {paymentNames[m]}
                        </option>
                      ))}
                  </select>
                  <input
                    aria-label={`Importe del pago ${index + 1}`}
                    inputMode="decimal"
                    value={p.amount}
                    required
                    onChange={(e) =>
                      setMethods(
                        methods.map((x, i) => (i === index ? { ...x, amount: e.target.value } : x)),
                      )
                    }
                  />
                  {!['cash', 'account'].includes(p.method) && (
                    <select
                      aria-label={`Estado del pago ${index + 1}`}
                      value={p.status}
                      onChange={(e) =>
                        setMethods(
                          methods.map((x, i) =>
                            i === index ? { ...x, status: e.target.value as typeof p.status } : x,
                          ),
                        )
                      }
                    >
                      <option value="manual">Registro manual</option>
                      <option value="pending">Pendiente</option>
                    </select>
                  )}
                  {methods.length > 1 && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Quitar medio de pago"
                      onClick={() => setMethods(methods.filter((_, i) => i !== index))}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
              <div className="stat-line">
                <span>{applied === total ? 'Total cubierto' : 'Falta cubrir'}</span>
                <strong className={applied === total ? 'success-text' : 'warning-text'}>
                  {money(total - applied)}
                </strong>
              </div>
            </div>
            {methods.some((p) => p.method === 'cash') && (
              <Field
                label="Efectivo recibido (opcional)"
                hint="Si no lo completás, se registra el importe exacto."
              >
                <input
                  inputMode="decimal"
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  placeholder="Importe que entrega el cliente"
                />
              </Field>
            )}
            {tendered && (
              <div className="stat-line">
                <span>Vuelto</span>
                <strong>{money(Math.max(0, cashChange))}</strong>
              </div>
            )}
            <p className="form-note">
              Transferencias, tarjetas y billeteras se registran manualmente. Confirmá la
              acreditación por tu canal habitual. Este ticket no es una factura fiscal.
            </p>
          </>
        )}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="submit" busy={busy} disabled={!shift}>
            <Check size={17} />
            {pending ? 'Reintentar la misma operación' : 'Confirmar venta'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
