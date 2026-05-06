import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

// From dist/src/storage/sqlite.js → 4 levels up = engine root
const engineRoot = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const migrationsDir = join(engineRoot, 'migrations');

function stateDir(): string {
  return process.env.FOREFLOW_STATE_DIR ?? join(os.homedir(), '.foreflow-state');
}

export function openDb(): Database.Database {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'foreflow.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  runMigrations(db);
  try { chmodSync(dbPath, 0o600); } catch { /* already exists, permissions already set */ }
  return db;
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  if (!existsSync(migrationsDir)) return;

  const applied = new Set<string>(
    (db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map((r) => r.name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const insertMigration = db.prepare(
    'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.exec(sql);
    insertMigration.run(file, Math.floor(Date.now() / 1000));
  }
}
