const number = { bsonType: ['int', 'long', 'double', 'decimal'] };
const integer = (minimum, maximum) => ({ ...number, minimum, maximum, multipleOf: 1 });
const text = { bsonType: 'string', minLength: 1, maxLength: 100 };
const schemas = {
  products: {
    required: [
      '_id',
      'name',
      'category',
      'price_cents',
      'stock',
      'minimum',
      'version',
      'updated_at',
    ],
    properties: {
      _id: { bsonType: 'string' },
      name: text,
      category: text,
      price_cents: integer(1, 100000000),
      stock: integer(0, 1000000),
      minimum: integer(0, 1000000),
      version: integer(1, Number.MAX_SAFE_INTEGER),
      updated_at: { bsonType: 'date' },
    },
  },
  sales: {
    required: ['_id', 'request_hash', 'date', 'items', 'total_cents'],
    properties: {
      _id: { bsonType: 'string' },
      request_hash: { bsonType: 'string' },
      date: { bsonType: 'date' },
      items: { bsonType: 'array', minItems: 1 },
      total_cents: integer(1, Number.MAX_SAFE_INTEGER),
    },
  },
  sessions: {
    required: ['_id', 'credential_hash', 'expires_at'],
    properties: {
      _id: { bsonType: 'string' },
      credential_hash: { bsonType: 'string' },
      expires_at: { bsonType: 'date' },
    },
  },
  login_limits: {
    required: ['_id', 'attempts', 'reset_at'],
    properties: {
      _id: { bsonType: 'string' },
      attempts: integer(1, Number.MAX_SAFE_INTEGER),
      reset_at: { bsonType: 'date' },
    },
  },
  inventory_audit: {
    required: ['product_id', 'action', 'date', 'before_data', 'after_data'],
    properties: {
      product_id: { bsonType: 'string' },
      action: { bsonType: 'string' },
      date: { bsonType: 'date' },
      before_data: { bsonType: ['object', 'null'] },
      after_data: { bsonType: 'object' },
    },
  },
};

// DDL is deliberately outside transactions. Each step can safely be repeated.
export async function initializeDatabase({ database }) {
  for (const [name, schema] of Object.entries(schemas)) {
    const options = {
      validator: { $jsonSchema: { bsonType: 'object', ...schema } },
      validationLevel: 'strict',
      validationAction: 'error',
    };
    try {
      await database.createCollection(name, options);
    } catch (error) {
      if (error.code !== 48) throw error;
      await database.command({ collMod: name, ...options });
    }
  }
  await database.collection('products').createIndex({ name: 1, _id: 1 });
  await database.collection('sales').createIndex({ date: -1, _id: 1 });
  await database.collection('sessions').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  await database.collection('inventory_audit').createIndex({ product_id: 1, date: -1 });
}
