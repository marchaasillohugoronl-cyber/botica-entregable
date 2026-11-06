import { MongoClient } from 'mongodb';

const clients = new Map();
export async function withDatabase(
  callback,
  uri = process.env.MONGODB_URI,
  name = process.env.MONGODB_DB,
) {
  if (!uri || !name) throw new Error('MONGODB_URI and MONGODB_DB are required');
  let pending = clients.get(uri);
  if (!pending) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      maxIdleTimeMS: 60000,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      waitQueueTimeoutMS: 10000,
      appName: 'nova-salud',
      ...(uri.startsWith('mongodb+srv:') || process.env.NODE_ENV === 'production'
        ? {
            tls: true,
            tlsAllowInvalidCertificates: false,
            tlsAllowInvalidHostnames: false,
          }
        : {}),
    });
    pending = client.connect().catch(async (error) => {
      clients.delete(uri);
      await client.close();
      throw error;
    });
    clients.set(uri, pending);
  }
  const client = await pending;
  return callback({ client, database: client.db(name) });
}

export async function closeDatabases() {
  const pending = [...clients.values()];
  clients.clear();
  await Promise.all(pending.map(async (connection) => (await connection).close()));
}

export async function transaction(db, callback) {
  const session = db.client.startSession();
  try {
    return await session.withTransaction(() => callback(session), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
      maxCommitTimeMS: 15000,
    });
  } finally {
    await session.endSession();
  }
}
