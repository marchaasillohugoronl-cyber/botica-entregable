export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function ensure(condition, message, status = 400) {
  if (!condition) throw new HttpError(status, message);
}
export function uuid(value) {
  ensure(
    typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
    'Identificador inválido.',
  );
  return value.toLowerCase();
}
export function integer(value, min = 0, max = 1000000) {
  ensure(
    Number.isSafeInteger(value) && value >= min && value <= max,
    'Cantidad fuera del rango permitido.',
  );
  return value;
}
export function productInput(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  ensure(
    name.length > 0 && name.length <= 100 && category.length > 0 && category.length <= 100,
    'Nombre y categoría: entre 1 y 100 caracteres.',
  );
  const cents = Math.round(body.price * 100);
  ensure(
    typeof body.price === 'number' &&
      Number.isFinite(body.price) &&
      Math.abs(body.price * 100 - cents) < 0.000001,
    'Precio inválido: usa hasta dos decimales.',
  );
  integer(cents, 1, 100000000);
  return {
    id: uuid(body.id),
    name,
    category,
    cents,
    stock: integer(body.stock),
    minimum: integer(body.minimum),
    version: integer(body.version, 0, 2147483646),
  };
}
export function saleInput(body) {
  const id = uuid(body.id);
  ensure(
    Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 100,
    'La venta debe tener entre 1 y 100 productos.',
  );
  const items = body.items
    .map((item) => {
      ensure(item && typeof item === 'object', 'Producto inválido.');
      return {
        id: uuid(item.id),
        quantity: integer(item.quantity, 1),
        priceCents: integer(item.priceCents, 1, 100000000),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  ensure(new Set(items.map((i) => i.id)).size === items.length, 'Hay productos repetidos.');
  return { id, items };
}
