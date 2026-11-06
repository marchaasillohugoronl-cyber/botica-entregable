import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeDatabase } from '../db/001_initial.js';
import { withDatabase, closeDatabases } from '../server/db.js';
import { hashPassword, credentialHash } from '../server/auth.js';
import { createSale, saveProduct } from '../server/inventory.js';
import handler from '../api/index.js';

// Only this randomly named, disposable database is created and dropped.
const url = process.env.TEST_MONGODB_URI;
if (!url) throw new Error('Configura TEST_MONGODB_URI con un clúster de pruebas.');
process.env.MONGODB_URI = url;
process.env.MONGODB_DB = `nova_test_${randomUUID().replaceAll('-', '')}`;
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.ADMIN_USERNAME = 'test-admin';
process.env.ADMIN_PASSWORD_HASH = await hashPassword('test-only-password-long');

async function call(
  action,
  { method = 'GET', body, cookie, origin = process.env.APP_ORIGIN } = {},
) {
  const headers = {};
  let result;
  const res = {
    statusCode: 200,
    setHeader: (key, value) => {
      headers[key.toLowerCase()] = value;
    },
    end: (text) => {
      result = JSON.parse(text);
    },
  };
  await handler(
    {
      url: `/api/index?action=${action}`,
      method,
      headers: { 'content-type': 'application/json', origin, cookie },
      body,
    },
    res,
  );
  return { status: res.statusCode, body: result, headers };
}

await test('API y transacciones sobre MongoDB real', async (t) => {
  try {
    await withDatabase(initializeDatabase);
    await withDatabase(initializeDatabase);
    let cookie;
    await t.test('rechaza accesos sin sesión, métodos y orígenes ajenos', async () => {
      assert.equal((await call('inventory')).status, 401);
      assert.equal((await call('product')).status, 405);
      assert.equal(
        (await call('login', { method: 'POST', body: {}, origin: 'https://evil.example' })).status,
        403,
      );
      assert.equal((await call('login', { method: 'POST', body: '{' })).status, 400);
    });
    await t.test('autentica y emite una cookie HttpOnly', async () => {
      assert.equal(
        (
          await call('login', {
            method: 'POST',
            body: { username: 'test-admin', password: 'wrong' },
          })
        ).status,
        401,
      );
      const response = await call('login', {
        method: 'POST',
        body: { username: 'test-admin', password: 'test-only-password-long' },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers['set-cookie'], /HttpOnly; SameSite=Strict/);
      cookie = response.headers['set-cookie'].split(';')[0];
      assert.equal((await call('session', { cookie })).status, 200);
      assert.equal((await call('inventory', { cookie })).headers['cache-control'], 'no-store');
    });
    const product = {
      id: randomUUID(),
      name: 'Prueba',
      category: 'Prueba',
      price: 1.8,
      stock: 5,
      minimum: 2,
      version: 0,
    };
    await t.test('crea un producto y rechaza cantidades manipuladas', async () => {
      assert.equal(
        (await call('product', { method: 'POST', cookie, body: { ...product, stock: -1 } })).status,
        400,
      );
      assert.equal((await call('product', { method: 'POST', cookie, body: product })).status, 200);
    });
    const payload = () => ({
      id: randomUUID(),
      items: [{ id: product.id, quantity: 4, priceCents: 180 }],
    });
    await t.test('dos ventas concurrentes no venden el mismo stock', async () => {
      const results = await Promise.all(
        [payload(), payload()].map((body) => call('sale', { method: 'POST', cookie, body })),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const state = (await call('inventory', { cookie })).body;
      assert.equal(state.products[0].stock, 1);
      assert.equal(state.salesCount, 1);
      assert.equal(state.sales[0].total, 7.2);
    });
    await t.test('un formulario obsoleto no sobrescribe una venta', async () => {
      assert.equal(
        (
          await call('product', {
            method: 'POST',
            cookie,
            body: { ...product, version: 1, stock: 100 },
          })
        ).status,
        409,
      );
    });
    await t.test('reintentos simultáneos solo registran una venta', async () => {
      const body = payload();
      body.items[0].quantity = 1;
      const results = await Promise.all(
        [1, 2].map(() => call('sale', { method: 'POST', cookie, body })),
      );
      assert.deepEqual(
        results.map((r) => r.status),
        [200, 200],
      );
      assert.equal(results[0].body.sale.id, results[1].body.sale.id);
      assert.equal((await call('inventory', { cookie })).body.salesCount, 2);
      const changed = { ...body, items: [{ ...body.items[0], quantity: 2 }] };
      assert.equal((await call('sale', { method: 'POST', cookie, body: changed })).status, 409);
    });
    await t.test('rollback completo y precio calculado en el servidor', async () => {
      const first = { ...product, id: '11111111-1111-4111-8111-111111111111', stock: 5 };
      const second = { ...product, id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', stock: 0 };
      await withDatabase(async (db) => {
        await saveProduct(db, first);
        await saveProduct(db, second);
      });
      const body = {
        id: randomUUID(),
        items: [
          { id: first.id, quantity: 1, priceCents: 180 },
          { id: second.id, quantity: 1, priceCents: 180 },
        ],
      };
      await assert.rejects(withDatabase((db) => createSale(db, body)));
      const state = (await call('inventory', { cookie })).body;
      assert.equal(state.products.find((p) => p.id === first.id).stock, 5);
      assert.equal(state.salesCount, 2);
      body.items = [{ id: first.id, quantity: 1, priceCents: 1 }];
      assert.equal((await call('sale', { method: 'POST', cookie, body })).status, 409);
    });
    await t.test('historial paginado e importes diarios independientes de la página', async () => {
      const state = (await call('inventory&page=2', { cookie })).body;
      assert.equal(state.sales.length, 0);
      assert.equal(state.salesCount, 2);
      assert.equal(state.todayTotal, 9);
    });
    await t.test('cierra sesiones y rechaza sesiones expiradas', async () => {
      assert.equal((await call('logout', { method: 'POST', cookie, body: {} })).status, 200);
      assert.equal((await call('session', { cookie })).status, 401);
      const expired = 'a'.repeat(64);
      const { digest } = await import('../server/auth.js');
      await withDatabase((db) =>
        db.database.collection('sessions').insertOne({
          _id: digest(expired),
          credential_hash: credentialHash(),
          expires_at: new Date(Date.now() - 1000),
        }),
      );
      const name = process.env.NODE_ENV === 'production' ? '__Host-nova-session' : 'nova-session';
      assert.equal((await call('session', { cookie: `${name}=${expired}` })).status, 401);
    });
    await t.test('limita intentos de inicio de sesión de forma persistente', async () => {
      await withDatabase((db) =>
        db.database
          .collection('login_limits')
          .updateOne({ _id: 'admin' }, { $set: { attempts: 20 } }),
      );
      const response = await call('login', {
        method: 'POST',
        body: { username: 'test-admin', password: 'test-only-password-long' },
      });
      assert.equal(response.status, 429);
      assert.equal(response.headers['retry-after'], '900');
    });
  } finally {
    try {
      await withDatabase((db) => db.database.dropDatabase());
    } finally {
      await closeDatabases();
    }
  }
});
