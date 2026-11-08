import Database from 'better-sqlite3';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith('file:')) {
  throw new Error('DATABASE_URL must use a local SQLite file URL (file:...).');
}

const databasePath = resolve(databaseUrl.slice('file:'.length).split('?')[0]);
await mkdir(dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
try {
  db.pragma('foreign_keys = ON');
  const hasServiceTable = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Service'",
  ).get();

  if (!hasServiceTable) {
    const migration = await readFile(
      new URL('../prisma/migrations/20261106000000_init/migration.sql', import.meta.url),
      'utf8',
    );
    db.exec('BEGIN');
    try {
      db.exec(migration);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
} finally {
  db.close();
}

console.log(`Local database is ready: ${databasePath}`);
