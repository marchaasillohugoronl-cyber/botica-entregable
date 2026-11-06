import { transaction } from './db.js';
import { digest } from './auth.js';
import { ensure, productInput, saleInput } from './validation.js';

const productView = (p) => ({
  id: p._id,
  name: p.name,
  category: p.category,
  price: p.price_cents / 100,
  stock: p.stock,
  minimum: p.minimum,
  version: p.version,
});
const saleView = (s) => ({ id: s._id, date: s.date, items: s.items, total: s.total_cents / 100 });

export async function readInventory(db, page = 1) {
  return transaction(db, async (session) => {
    const products = await db.database
      .collection('products')
      .find({}, { session })
      .sort({ name: 1, _id: 1 })
      .toArray();
    const sales = await db.database
      .collection('sales')
      .find({}, { session })
      .sort({ date: -1, _id: 1 })
      .skip((page - 1) * 50)
      .limit(50)
      .toArray();
    const today = {
      $eq: [
        { $dateToString: { date: '$date', format: '%Y-%m-%d', timezone: 'America/Lima' } },
        { $dateToString: { date: '$$NOW', format: '%Y-%m-%d', timezone: 'America/Lima' } },
      ],
    };
    const [totals] = await db.database
      .collection('sales')
      .aggregate(
        [
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              today_count: { $sum: { $cond: [today, 1, 0] } },
              today_total: { $sum: { $cond: [today, '$total_cents', 0] } },
            },
          },
        ],
        { session },
      )
      .toArray();
    return {
      products: products.map(productView),
      sales: sales.map(saleView),
      page,
      salesCount: totals?.count || 0,
      todayCount: totals?.today_count || 0,
      todayTotal: (totals?.today_total || 0) / 100,
    };
  });
}

export async function saveProduct(db, body) {
  const p = productInput(body);
  return transaction(db, async (session) => {
    const products = db.database.collection('products');
    const before = await products.findOne({ _id: p.id }, { session });
    const after = {
      _id: p.id,
      name: p.name,
      category: p.category,
      price_cents: p.cents,
      stock: p.stock,
      minimum: p.minimum,
      version: p.version + 1,
      updated_at: new Date(),
    };
    if (p.version === 0) {
      ensure(!before, 'El producto ya existe. Actualiza el inventario.', 409);
      await products.insertOne(after, { session });
    } else {
      ensure(
        before?.version === p.version,
        'El producto cambió en otra operación. Actualiza y vuelve a editarlo.',
        409,
      );
      const result = await products.replaceOne({ _id: p.id, version: p.version }, after, {
        session,
      });
      ensure(result.matchedCount === 1, 'El producto cambió. Actualiza el inventario.', 409);
    }
    await db.database.collection('inventory_audit').insertOne(
      {
        product_id: p.id,
        action: p.version === 0 ? 'create' : 'edit',
        date: new Date(),
        before_data: before,
        after_data: after,
      },
      { session },
    );
    return { product: productView(after) };
  });
}

export async function createSale(db, body) {
  const { id, items } = saleInput(body);
  const hash = digest(JSON.stringify(items));
  const existingResult = (sale) => {
    ensure(sale.request_hash === hash, 'Este identificador ya pertenece a otra venta.', 409);
    return { sale: saleView(sale) };
  };
  try {
    return await transaction(db, async (session) => {
      const sales = db.database.collection('sales');
      const existing = await sales.findOne({ _id: id }, { session });
      if (existing) return existingResult(existing);
      const detail = [];
      let total = 0;
      for (const item of items) {
        const products = db.database.collection('products');
        const product = await products.findOne({ _id: item.id }, { session });
        ensure(
          product && product.stock >= item.quantity,
          'Stock insuficiente. Actualiza el inventario y revisa la venta.',
          409,
        );
        ensure(
          product.price_cents === item.priceCents,
          'Un precio cambió. Actualiza el inventario antes de confirmar.',
          409,
        );
        total += product.price_cents * item.quantity;
        ensure(Number.isSafeInteger(total), 'El importe supera el límite permitido.');
        detail.push({
          id: product._id,
          name: product.name,
          price: product.price_cents / 100,
          quantity: item.quantity,
        });
        const updated = await products.findOneAndUpdate(
          { _id: item.id, version: product.version, stock: { $gte: item.quantity } },
          { $inc: { stock: -item.quantity, version: 1 }, $set: { updated_at: new Date() } },
          { session, returnDocument: 'after', includeResultMetadata: false },
        );
        ensure(updated, 'El producto cambió. Actualiza el inventario.', 409);
        await db.database.collection('inventory_audit').insertOne(
          {
            product_id: item.id,
            action: `sale:${id}`,
            date: new Date(),
            before_data: product,
            after_data: updated,
          },
          { session },
        );
      }
      const sale = {
        _id: id,
        request_hash: hash,
        items: detail,
        total_cents: total,
        date: new Date(),
      };
      await sales.insertOne(sale, { session });
      return { sale: saleView(sale) };
    });
  } catch (error) {
    // A competing request may commit the same sale UUID before this transaction inserts it.
    if (error.code === 11000) {
      const existing = await db.database.collection('sales').findOne({ _id: id });
      if (existing) return existingResult(existing);
    }
    throw error;
  }
}
