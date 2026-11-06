import { randomUUID } from 'node:crypto';
import { withDatabase } from '../server/db.js';
import { login, logout, requireSession } from '../server/auth.js';
import { createSale, readInventory, saveProduct } from '../server/inventory.js';
import { ensure, HttpError, integer } from '../server/validation.js';

async function readBody(req) {
  ensure(
    (req.headers['content-type'] || '').split(';')[0] === 'application/json',
    'Se requiere JSON.',
    415,
  );
  let body = req.body;
  if (body === undefined) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += Buffer.byteLength(chunk);
      ensure(bytes <= 32768, 'Solicitud demasiado grande.', 413);
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  }
  ensure(
    Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body)) <= 32768,
    'Solicitud demasiado grande.',
    413,
  );
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      throw new HttpError(400, 'JSON inválido.');
    }
  }
  ensure(body && typeof body === 'object' && !Array.isArray(body), 'Solicitud inválida.');
  return body;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const requestId = randomUUID();
  res.setHeader('X-Request-Id', requestId);
  try {
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action');
    const methods = {
      login: 'POST',
      logout: 'POST',
      session: 'GET',
      inventory: 'GET',
      product: 'POST',
      sale: 'POST',
    };
    ensure(Object.hasOwn(methods, action), 'Ruta no encontrada.', 404);
    if (req.method !== methods[action]) {
      res.setHeader('Allow', methods[action]);
      throw new HttpError(405, 'Método no permitido.');
    }
    if (!process.env.APP_ORIGIN || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH)
      throw new Error('Missing server configuration');
    if (
      process.env.NODE_ENV === 'production' &&
      new URL(process.env.APP_ORIGIN).protocol !== 'https:'
    )
      throw new Error('Production requires HTTPS');
    if (req.method === 'POST') {
      ensure(
        req.headers.origin === new URL(process.env.APP_ORIGIN).origin,
        'Origen no permitido.',
        403,
      );
    }
    const body = req.method === 'POST' ? await readBody(req) : null;
    const result = await withDatabase(async (db) => {
      if (action === 'login') return login(db, req, res, body);
      if (action === 'logout') return logout(db, req, res);
      await requireSession(db, req);
      if (action === 'session') return { authenticated: true };
      if (action === 'inventory')
        return readInventory(db, integer(Number(url.searchParams.get('page') || 1), 1, 1000000));
      if (action === 'product') return saveProduct(db, body);
      return createSale(db, body);
    });
    res.statusCode = 200;
    res.end(JSON.stringify(result));
  } catch (error) {
    let status = error instanceof HttpError ? error.status : 500;
    if (error.code === 11000) status = 409;
    if (status === 500)
      console.error(JSON.stringify({ requestId, code: error.code || 'INTERNAL_ERROR' }));
    res.statusCode = status;
    res.end(
      JSON.stringify({
        error:
          status === 500
            ? 'No se pudo completar la operación. Intenta nuevamente.'
            : status === 409 && !(error instanceof HttpError)
              ? 'Conflicto de datos. Actualiza e inténtalo nuevamente.'
              : error.message,
        requestId,
      }),
    );
  }
}
