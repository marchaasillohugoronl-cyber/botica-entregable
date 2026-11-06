import { useEffect, useRef, useState } from 'react';
import { money } from './inventory.js';
import { request } from './api.js';

const emptyProduct = { name: '', category: '', price: '', stock: '', minimum: '10', version: 0 };
const emptyData = { products: [], sales: [], salesCount: 0, todayTotal: 0, todayCount: 0 };
const pendingKey = 'nova-pending-sale';
function readPending() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingKey));
    return saved &&
      typeof saved.id === 'string' &&
      Array.isArray(saved.items) &&
      saved.items.length > 0 &&
      saved.items.every(
        (i) =>
          typeof i.id === 'string' &&
          Number.isSafeInteger(i.quantity) &&
          i.quantity > 0 &&
          Number.isSafeInteger(i.priceCents) &&
          i.priceCents > 0,
      )
      ? saved
      : null;
  } catch {
    return null;
  }
}

export default function Dashboard({ onSessionExpired }) {
  const [data, setData] = useState(emptyData);
  const [tab, setTab] = useState('Inventario');
  const [search, setSearch] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [form, setForm] = useState(null);
  const [cart, setCart] = useState(() => readPending()?.items || []);
  const [pendingSale, setPendingSale] = useState(readPending);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const lock = useRef(false);
  const [message, setMessage] = useState('');

  const lowStock = data.products.filter((p) => p.stock <= p.minimum);
  const filtered = data.products.filter(
    (p) =>
      `${p.name} ${p.category}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')) &&
      (!onlyLow || p.stock <= p.minimum),
  );
  const cartTotal = cart.reduce((sum, item) => sum + item.priceCents * item.quantity, 0) / 100;

  function report(error) {
    setMessage(error.message);
    if (error.status === 401) onSessionExpired();
  }

  async function refresh(nextPage = page) {
    const next = await request('inventory', undefined, nextPage);
    setData(next);
    if (!pendingSale)
      setCart((current) =>
        current.map((item) => {
          const product = next.products.find((p) => p.id === item.id);
          return product ? { ...item, priceCents: Math.round(product.price * 100) } : item;
        }),
      );
    setPage(nextPage);
    setLoading(false);
    return next;
  }

  useEffect(() => {
    let active = true;
    request('inventory')
      .then((next) => {
        if (active) {
          setData(next);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (active) {
          report(error);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveProduct(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await request('product', {
        ...form,
        price: Number(form.price),
        stock: Number(form.stock),
        minimum: Number(form.minimum),
      });
      setForm(null);
      setMessage('Producto guardado.');
      await refresh().catch((error) => {
        setMessage('Producto guardado. No se pudo actualizar la vista; pulsa Actualizar.');
        if (error.status === 401) onSessionExpired();
      });
    } catch (error) {
      report(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function addToCart(product) {
    if (busy || pendingSale) return;
    const current = cart.find((item) => item.id === product.id);
    if ((current?.quantity || 0) >= product.stock) {
      setMessage('No hay más unidades disponibles.');
      return;
    }
    setCart(
      current
        ? cart.map((item) =>
            item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
          )
        : [
            ...cart,
            {
              id: product.id,
              name: product.name,
              quantity: 1,
              priceCents: Math.round(product.price * 100),
            },
          ],
    );
    setMessage('');
  }

  async function checkout() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const payload = pendingSale || {
        id: crypto.randomUUID(),
        items: cart.map(({ id, quantity, priceCents }) => ({ id, quantity, priceCents })),
      };
      // Keep the UUID across a lost response or a page reload; retries cannot charge twice.
      sessionStorage.setItem(pendingKey, JSON.stringify(payload));
      setPendingSale(payload);
      await request('sale', payload);
      sessionStorage.removeItem(pendingKey);
      setPendingSale(null);
      setCart([]);
      setMessage('Venta registrada. El stock se actualizó correctamente.');
      await refresh(1).catch((error) => {
        setMessage('Venta registrada. No se pudo actualizar la vista; pulsa Actualizar.');
        if (error.status === 401) onSessionExpired();
      });
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && error.status !== 401) {
        sessionStorage.removeItem(pendingKey);
        setPendingSale(null);
      }
      report(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await request('logout', {});
      onSessionExpired();
    } catch (error) {
      report(error);
    }
  }

  function changeTab(next) {
    setTab(next);
    setSearch('');
    setOnlyLow(false);
    setMessage('');
    setForm(null);
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            changeTab('Inventario');
          }}
        >
          <span className="brand-icon">✚</span>
          <span>
            Nova Salud<small>GESTIÓN DE BOTICA</small>
          </span>
        </a>
        <p className="nav-label">ESPACIO DE TRABAJO</p>
        <nav aria-label="Navegación principal">
          {['Inventario', 'Nueva venta', 'Historial'].map((name, index) => (
            <button
              key={name}
              className={tab === name ? 'nav-item active' : 'nav-item'}
              aria-current={tab === name ? 'page' : undefined}
              onClick={() => changeTab(name)}
            >
              <span aria-hidden="true">{['▦', '＋', '◷'][index]}</span>
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" /> Acceso de administrador<p>Inventario centralizado.</p>
          <button className="text-button" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <span>
            Administración <span className="breadcrumb">/ {tab}</span>
          </span>
          <button className="secondary" onClick={logout}>
            Cerrar sesión
          </button>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">BOTICA NOVA SALUD</p>
              <h1>
                {tab === 'Inventario'
                  ? 'Tu inventario, al día.'
                  : tab === 'Nueva venta'
                    ? 'Una atención más ágil.'
                    : 'Cada venta, registrada.'}
              </h1>
              <p className="muted">
                {tab === 'Inventario'
                  ? 'Controla tus productos y anticipa lo que necesitas reponer.'
                  : tab === 'Nueva venta'
                    ? 'Selecciona los productos y confirma la venta para actualizar el stock.'
                    : 'Consulta el detalle de las operaciones de tu botica.'}
              </p>
            </div>
            {tab === 'Inventario' && (
              <button
                className="primary"
                onClick={() => setForm({ ...emptyProduct, id: crypto.randomUUID() })}
              >
                ＋ Nuevo producto
              </button>
            )}
          </div>

          <section className="stats" aria-label="Resumen">
            <article>
              <span>Productos registrados</span>
              <strong>
                {data.products.length}
                <i>▦</i>
              </strong>
              <small>En tu catálogo</small>
            </article>
            <article>
              <span>Unidades disponibles</span>
              <strong>
                {data.products.reduce((sum, p) => sum + p.stock, 0)}
                <i>↗</i>
              </strong>
              <small>Stock total actual</small>
            </article>
            <article>
              <span>Por reponer</span>
              <strong>
                {lowStock.length}
                <i className="amber">!</i>
              </strong>
              <small>Productos con stock bajo</small>
            </article>
            <article>
              <span>Ventas de hoy</span>
              <strong>{money(data.todayTotal)}</strong>
              <small>{data.todayCount} operaciones registradas</small>
            </article>
          </section>

          <div className="refresh-row">
            <span>
              {loading ? 'Cargando inventario…' : 'Actualiza para consultar los últimos cambios.'}
            </span>
            <button
              className="secondary"
              disabled={busy || loading}
              onClick={() => refresh().catch(report)}
            >
              Actualizar
            </button>
          </div>
          {pendingSale && tab !== 'Nueva venta' && (
            <div className="notice">
              Hay una venta pendiente de confirmación.
              <button onClick={() => changeTab('Nueva venta')}>Revisar →</button>
            </div>
          )}
          {message && (
            <div className="notice" role="status">
              {message}
              <button aria-label="Cerrar mensaje" onClick={() => setMessage('')}>
                ×
              </button>
            </div>
          )}

          {form && (
            <section className="panel product-form">
              <h2>{form.version ? 'Editar producto / reponer stock' : 'Nuevo producto'}</h2>
              <form onSubmit={saveProduct}>
                <div className="form-grid">
                  {[
                    ['name', 'Nombre del producto', 'text'],
                    ['category', 'Categoría', 'text'],
                    ['price', 'Precio (S/)', 'number'],
                    ['stock', 'Stock disponible', 'number'],
                    ['minimum', 'Stock mínimo', 'number'],
                  ].map(([key, label, type]) => (
                    <label key={key}>
                      {label}
                      <input
                        required
                        maxLength={type === 'text' ? 100 : undefined}
                        type={type}
                        min={key === 'price' ? '0.01' : '0'}
                        step={key === 'price' ? '0.01' : '1'}
                        value={form[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
                <div className="form-actions">
                  <button type="button" className="secondary" onClick={() => setForm(null)}>
                    Cancelar
                  </button>
                  <button className="primary" disabled={busy}>
                    {busy ? 'Guardando…' : 'Guardar producto'}
                  </button>
                </div>
              </form>
            </section>
          )}

          {tab === 'Inventario' && lowStock.length > 0 && (
            <div className="stock-alert">
              <span className="alert-icon">!</span>
              <div>
                <strong>Es momento de reponer</strong>
                <p>{lowStock.length} productos están en su stock mínimo o por debajo.</p>
              </div>
              <button onClick={() => setOnlyLow(!onlyLow)}>
                {onlyLow ? 'Ver todos' : 'Revisar productos'} →
              </button>
            </div>
          )}

          {tab !== 'Historial' ? (
            <div className={tab === 'Nueva venta' ? 'sale-layout' : ''}>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    {tab === 'Inventario' ? 'Todos los productos' : 'Catálogo de productos'}{' '}
                    <span className="count">{filtered.length}</span>
                  </h2>
                  <label className="search">
                    <span aria-hidden="true">⌕</span>
                    <input
                      aria-label="Buscar producto o categoría"
                      placeholder="Buscar producto o categoría…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Precio</th>
                        <th>Stock</th>
                        <th>Estado</th>
                        <th>
                          <span className="sr-only">Acciones</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="product-cell">
                              <span className="product-icon" aria-hidden="true">
                                ✚
                              </span>
                              <div>
                                <strong>{p.name}</strong>
                                <small>{p.category}</small>
                              </div>
                            </div>
                          </td>
                          <td>{money(p.price)}</td>
                          <td>
                            <strong>{p.stock}</strong>
                            <small>Mín. {p.minimum}</small>
                          </td>
                          <td>
                            <span className={`badge ${p.stock <= p.minimum ? 'low' : ''}`}>
                              {p.stock === 0
                                ? 'Agotado'
                                : p.stock <= p.minimum
                                  ? 'Stock bajo'
                                  : 'Disponible'}
                            </span>
                          </td>
                          <td>
                            {tab === 'Inventario' ? (
                              <button
                                className="text-button"
                                aria-label={`Editar ${p.name}`}
                                onClick={() => setForm({ ...p })}
                              >
                                Editar ↗
                              </button>
                            ) : (
                              <button
                                className="secondary"
                                disabled={p.stock === 0 || busy || !!pendingSale}
                                onClick={() => addToCart(p)}
                              >
                                Agregar
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtered.length === 0 && <p className="empty">No se encontraron productos.</p>}
                </div>
                <div className="panel-footer">
                  {filtered.length} productos · Precios en soles peruanos
                </div>
              </section>
              {tab === 'Nueva venta' && (
                <section className="panel cart">
                  <h2>Detalle de venta</h2>
                  {cart.length === 0 && (
                    <p className="empty">Agrega productos del catálogo para comenzar.</p>
                  )}
                  {cart.map((item) => {
                    const product = data.products.find((p) => p.id === item.id) || {
                      name: item.name || 'Producto',
                    };
                    return (
                      <div className="cart-item" key={item.id}>
                        <strong>{product.name}</strong>
                        <div>
                          <span>
                            {item.quantity} × {money(item.priceCents / 100)}
                          </span>
                          <button
                            className="text-button"
                            disabled={busy || !!pendingSale}
                            aria-label={`Quitar ${product.name}`}
                            onClick={() => setCart(cart.filter((entry) => entry.id !== item.id))}
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="cart-total">
                    <span>Total</span>
                    <strong>{money(cartTotal)}</strong>
                  </div>
                  <button className="primary" disabled={!cart.length || busy} onClick={checkout}>
                    {busy
                      ? 'Procesando…'
                      : pendingSale
                        ? 'Reintentar confirmación'
                        : 'Confirmar venta'}
                  </button>
                  <p className="muted">
                    {pendingSale
                      ? 'Hay una confirmación pendiente. Reintenta para consultar o completar la misma venta.'
                      : 'El stock se descuenta al confirmar.'}
                  </p>
                  {!pendingSale && (
                    <button className="text-button" disabled={busy} onClick={() => setCart([])}>
                      Vaciar carrito
                    </button>
                  )}
                </section>
              )}
            </div>
          ) : (
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  Historial de ventas <span className="count">{data.salesCount}</span>
                </h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Operación</th>
                      <th>Fecha y hora</th>
                      <th>Productos</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sales.map((sale) => (
                      <tr key={sale.id}>
                        <td>
                          <strong>Venta {sale.id.slice(0, 8)}</strong>
                        </td>
                        <td>
                          {new Date(sale.date).toLocaleString('es-PE', {
                            timeZone: 'America/Lima',
                          })}
                        </td>
                        <td>
                          {sale.items.map((item, i) => (
                            <small key={i}>
                              {item.quantity} × {item.name}
                            </small>
                          ))}
                        </td>
                        <td>
                          <strong>{money(sale.total)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.sales.length === 0 && (
                  <div className="empty">
                    <h3>Aún no hay ventas</h3>
                    <p>Las operaciones aparecerán aquí cuando confirmes tu primera venta.</p>
                    <button className="primary" onClick={() => changeTab('Nueva venta')}>
                      Registrar una venta
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
          {tab === 'Historial' && (
            <div className="pagination">
              <button
                className="secondary"
                disabled={busy || page <= 1}
                onClick={() => refresh(page - 1).catch(report)}
              >
                Anterior
              </button>
              <span>Página {page} · Hora de Lima</span>
              <button
                className="secondary"
                disabled={busy || page * 50 >= data.salesCount}
                onClick={() => refresh(page + 1).catch(report)}
              >
                Siguiente
              </button>
            </div>
          )}
          <footer>
            Nova Salud <span>·</span> Un mejor control, una mejor atención.
          </footer>
        </div>
      </main>
    </div>
  );
}
