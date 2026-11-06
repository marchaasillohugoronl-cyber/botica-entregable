import { withDatabase, closeDatabases } from '../server/db.js';
import { initializeDatabase } from '../db/001_initial.js';

try {
  await withDatabase(initializeDatabase);
  console.log('Colecciones, validadores e índices de MongoDB preparados.');
} finally {
  await closeDatabases();
}
