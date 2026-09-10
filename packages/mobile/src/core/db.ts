/**
 * The local sqlite store: the offline outbox and the read-through cache
 * (spec-mobile-app.md "Offline model" — the schema is fixed by the spec).
 *
 * The store holds only the signed-in member's own data and is wiped on
 * sign-out. OS-level device encryption is the at-rest story in v1.
 */

import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('gatewaze.db');
    migrate(db);
  }
  return db;
}

function migrate(d: SQLite.SQLiteDatabase): void {
  d.execSync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS outbox (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      client_ref    TEXT NOT NULL UNIQUE,
      kind          TEXT NOT NULL,
      payload       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      last_error    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);

    CREATE TABLE IF NOT EXISTS cache (
      cache_key  TEXT PRIMARY KEY,
      body       TEXT NOT NULL,
      cached_at  INTEGER NOT NULL
    );
  `);

  // in_flight is not a trusted state across launches: if the app was killed
  // mid-request the row would be stranded. Reset to pending — safe because
  // client_ref idempotency makes a duplicate delivery a server-side no-op.
  d.runSync(`UPDATE outbox SET status = 'pending' WHERE status = 'in_flight'`);
}

/** Wipe everything local (sign-out, account deletion). */
export function wipeLocalStore(): void {
  const d = getDb();
  d.execSync(`DELETE FROM outbox; DELETE FROM cache;`);
}
