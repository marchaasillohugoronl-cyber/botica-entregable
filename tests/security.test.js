import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { productInput, saleInput } from '../server/validation.js';
import { hashPassword, verifyPassword } from '../server/auth.js';

const product = () => ({
  id: randomUUID(),
  name: 'Producto',
  category: 'Categoría',
  price: 1.8,
  stock: 10,
  minimum: 2,
  version: 0,
});
test('valida precios, cantidades y campos obligatorios en el servidor', () => {
  assert.equal(productInput(product()).cents, 180);
  for (const invalid of [
    { price: 0 },
    { price: 1.234 },
    { price: '1.80' },
    { stock: -1 },
    { stock: 1.5 },
    { name: ' ' },
    { category: 'a'.repeat(101) },
    { version: -1 },
  ]) {
    assert.throws(() => productInput({ ...product(), ...invalid }));
  }
});
test('rechaza ventas vacías, cantidades inválidas y productos duplicados', () => {
  const id = randomUUID();
  const item = { id: randomUUID(), quantity: 1, priceCents: 180 };
  for (const items of [
    [],
    [item, item],
    [{ ...item, quantity: 0 }],
    [{ ...item, quantity: 1.2 }],
    [null],
    [{ ...item, priceCents: -1 }],
  ]) {
    assert.throws(() => saleInput({ id, items }));
  }
});
test('la contraseña usa salt aleatorio y verifica el hash', async () => {
  const password = 'clave-de-prueba-no-real';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('incorrecta', first), false);
});
