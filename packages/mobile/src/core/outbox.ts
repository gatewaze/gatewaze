/**
 * The offline outbox (spec-mobile-app.md "Offline model").
 *
 * Typed by `kind`, never by raw HTTP request: replay goes through the
 * owning module's registered handler (manifest `outboxKinds`), which calls
 * the typed client with a fresh token and the current contract. client_ref
 * is generated once per logical action and reused across retries — that is
 * what makes retries idempotent server-side.
 *
 * Failure policy per the taxonomy:
 *  - 'client' failures (4xx) mark the row failed — user-facing retry/discard
 *    in the Sync Status screen. A 409 on an idempotent replay is treated by
 *    handlers as success.
 *  - 'offline'/'server' failures leave the row pending for the next flush,
 *    with exponential backoff via attempt_count.
 */

import { getDb } from './db';

export interface OutboxRow {
  id: number;
  client_ref: string;
  kind: string;
  payload: string;
  status: 'pending' | 'in_flight' | 'failed';
  attempt_count: number;
  created_at: number;
  last_error: string | null;
}

type Handler = (payload: unknown, clientRef: string) => Promise<void>;

const handlers = new Map<string, Handler>();
let flushing = false;
const listeners = new Set<() => void>();

export function registerOutboxKind(kind: string, handler: Handler): void {
  handlers.set(kind, handler);
}

export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}

export async function enqueue(kind: string, payload: unknown, clientRef: string): Promise<void> {
  getDb().runSync(
    `INSERT INTO outbox (client_ref, kind, payload, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)
     ON CONFLICT(client_ref) DO NOTHING`,
    [clientRef, kind, JSON.stringify(payload), Date.now()]
  );
  notify();
  void flush();
}

export function outboxCounts(): { pending: number; failed: number } {
  const db = getDb();
  const pending =
    db.getFirstSync<{ n: number }>(
      `SELECT COUNT(*) as n FROM outbox WHERE status IN ('pending','in_flight')`
    )?.n ?? 0;
  const failed =
    db.getFirstSync<{ n: number }>(`SELECT COUNT(*) as n FROM outbox WHERE status = 'failed'`)
      ?.n ?? 0;
  return { pending, failed };
}

export function failedRows(): OutboxRow[] {
  return getDb().getAllSync<OutboxRow>(
    `SELECT * FROM outbox WHERE status = 'failed' ORDER BY created_at DESC`
  );
}

/** User action from the Sync Status screen: back to pending, fresh budget. */
export function retryRow(id: number): void {
  getDb().runSync(
    `UPDATE outbox SET status = 'pending', attempt_count = 0, last_error = NULL WHERE id = ?`,
    [id]
  );
  notify();
  void flush();
}

/** User action from the Sync Status screen, behind a confirmation. */
export function discardRow(id: number): void {
  getDb().runSync(`DELETE FROM outbox WHERE id = ?`, [id]);
  notify();
}

function backoffMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** attempts) + Math.floor(Math.random() * 500);
}

const MAX_TRANSIENT_ATTEMPTS = 8;

/** Flush pending rows through their registered handlers, oldest first. */
export async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const db = getDb();
    const rows = db.getAllSync<OutboxRow>(
      `SELECT * FROM outbox WHERE status = 'pending' ORDER BY id ASC`
    );
    for (const row of rows) {
      const handler = handlers.get(row.kind);
      if (!handler) continue; // module not baked into this build — leave it

      db.runSync(`UPDATE outbox SET status = 'in_flight' WHERE id = ?`, [row.id]);
      notify();
      try {
        let payload: unknown;
        try {
          payload = JSON.parse(row.payload);
        } catch {
          throw Object.assign(new Error('Corrupt outbox payload'), { kind: 'client' });
        }
        await handler(payload, row.client_ref);
        db.runSync(`DELETE FROM outbox WHERE id = ?`, [row.id]);
      } catch (err) {
        const kind = (err as { kind?: string }).kind;
        const message = err instanceof Error ? err.message : String(err);
        if (kind === 'client') {
          db.runSync(`UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ?`, [
            message,
            row.id,
          ]);
        } else {
          const attempts = row.attempt_count + 1;
          const failed = attempts >= MAX_TRANSIENT_ATTEMPTS;
          db.runSync(
            `UPDATE outbox SET status = ?, attempt_count = ?, last_error = ? WHERE id = ?`,
            [failed ? 'failed' : 'pending', attempts, message, row.id]
          );
          if (!failed) {
            // Stop this flush pass; try again after backoff.
            setTimeout(() => void flush(), backoffMs(attempts));
            break;
          }
        }
      } finally {
        notify();
      }
    }
  } finally {
    flushing = false;
  }
}
