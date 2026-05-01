#!/usr/bin/env tsx
/**
 * Pre-upgrade migration runner. Called by the Helm pre-upgrade Job
 * (see helm/gatewaze/templates/migrations-job.yaml). Uses a Postgres
 * advisory lock so concurrent helm upgrades serialise instead of
 * racing.
 *
 * Workflow:
 *   1. Acquire pg_try_advisory_lock(<key>) — non-blocking.
 *      If another process holds the lock, wait up to LOCK_TIMEOUT_MS
 *      then exit non-zero (Helm rolls back).
 *   2. Apply core migrations via `supabase db push --include-all`
 *      (or whatever the project's standard runner is).
 *   3. Apply module migrations via the existing module migration
 *      tooling.
 *   4. Release the lock.
 *
 * Required env: DATABASE_URL (or SUPABASE_DB_URL), plus SUPABASE_*
 * for the module path.
 */

import { Client } from 'pg';
import { execFileSync } from 'child_process';

const LOCK_KEY = 'gatewaze.migrations'; // hashed to int64 via hashtext()
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

function getConnString(): string {
  const url = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('DATABASE_URL or SUPABASE_DB_URL must be set');
  return url;
}

async function acquireLock(client: Client): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    const { rows } = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`,
      [LOCK_KEY],
    );
    if (rows[0]?.acquired) return;
    console.log(`[migrations] lock held by another process; retrying in ${POLL_INTERVAL_MS}ms`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Could not acquire migration lock within ${LOCK_TIMEOUT_MS}ms`);
}

async function releaseLock(client: Client): Promise<void> {
  await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [LOCK_KEY]);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: getConnString() });
  await client.connect();

  try {
    console.log('[migrations] acquiring advisory lock...');
    await acquireLock(client);
    console.log('[migrations] lock acquired');

    console.log('[migrations] applying core supabase migrations...');
    execFileSync('supabase', ['db', 'push', '--include-all'], { stdio: 'inherit' });

    console.log('[migrations] applying module migrations...');
    execFileSync('pnpm', ['exec', 'tsx', 'scripts/apply-module-migrations.ts'], {
      stdio: 'inherit',
    });

    console.log('[migrations] complete');
  } finally {
    try {
      await releaseLock(client);
    } catch (err) {
      console.error('[migrations] failed to release lock:', err);
    }
    await client.end();
  }
}

main().catch(err => {
  console.error('[migrations] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
