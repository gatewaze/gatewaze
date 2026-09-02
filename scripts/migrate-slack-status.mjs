#!/usr/bin/env node
/**
 * Preserve mlops Slack-invite history onto the aaif Slack queue, so every user
 * who was ever sent a Slack invite (completed OR failed) is recorded in AAIF.
 *
 * Source (READ-ONLY): mlops  public.slack_invitation_queue (email, status, ...)
 * Target:             aaif   public.integrations_slack_invitation_queue
 *
 * Per distinct email we resolve ONE status:
 *   - ever completed  -> 'completed'   (they are in Slack; leave alone)
 *   - else ever failed -> 'failed'      (failed, no success -> re-invite later)
 *   - pending/processing only -> SKIPPED (not imported; would otherwise be
 *     mislabelled, and we never import 'pending' — the worker would try to send)
 *
 * NEVER inserts a 'pending' row, so the AAIF Slack worker (which only drains
 * 'pending') will not send anything as a result of this import.
 *
 * Idempotent: rows already carrying metadata.migrated_from =
 * 'mlops.slack_invitation_queue' are skipped, so re-runs don't duplicate.
 *
 * Dry-run by DEFAULT. Pass --commit to write.
 * Env: SRC_DB_* (mlops), DST_DB_* (aaif), *_DB_SSL.
 */
import { createRequire } from 'module';
const require = createRequire(new URL('../packages/api/package.json', import.meta.url));
const pg = require('pg');

const COMMIT = process.argv.includes('--commit');
const sslFor = (m) => (m === 'require' || m === 'true' ? { rejectUnauthorized: false } : false);
const conn = (p) => ({ host: process.env[`${p}_DB_HOST`], port: +(process.env[`${p}_DB_PORT`] || 5432), user: process.env[`${p}_DB_USER`], password: process.env[`${p}_DB_PASSWORD`], database: process.env[`${p}_DB_NAME`] || 'postgres', ssl: sslFor(process.env[`${p}_DB_SSL`]) });

async function main() {
  const src = new pg.Client(conn('SRC'));
  const dst = new pg.Client(conn('DST'));
  await src.connect(); await dst.connect();
  await src.query('SET default_transaction_read_only = on');
  await dst.query("SET statement_timeout = '600s'");
  console.log(`=== mlops slack status -> aaif   [${COMMIT ? 'COMMIT' : 'DRY-RUN'}] ===`);

  // resolve one status per email from mlops
  const rows = (await src.query(`
    SELECT lower(email) email,
      bool_or(status='completed') has_completed,
      bool_or(status='failed')    has_failed,
      count(*)::int attempts,
      max(invited_at) FILTER (WHERE status='completed') completed_at,
      max(invited_at) last_invited,
      max(created_at) last_created,
      (array_agg(error_message ORDER BY created_at DESC) FILTER (WHERE error_message IS NOT NULL))[1] last_error,
      (array_agg(account       ORDER BY created_at DESC) FILTER (WHERE account IS NOT NULL))[1] account
    FROM public.slack_invitation_queue WHERE email IS NOT NULL GROUP BY 1`)).rows;

  // existing already-migrated emails in aaif (idempotency)
  const already = new Set((await dst.query(
    `SELECT lower(email) e FROM public.integrations_slack_invitation_queue
      WHERE metadata->>'migrated_from' = 'mlops.slack_invitation_queue'`)).rows.map((r) => r.e));

  let completed = 0, failed = 0, skippedPending = 0, skippedExisting = 0;
  const payload = [];
  for (const r of rows) {
    if (already.has(r.email)) { skippedExisting++; continue; }
    let status, invited_at, error_message = null;
    if (r.has_completed) { status = 'completed'; invited_at = r.completed_at || r.last_invited; completed++; }
    else if (r.has_failed) { status = 'failed'; invited_at = r.last_invited; error_message = r.last_error; failed++; }
    else { skippedPending++; continue; }
    const metadata = JSON.stringify({ migrated_from: 'mlops.slack_invitation_queue', mlops_attempts: r.attempts, resolved_status: status });
    payload.push([r.email, r.account || 'default', status, error_message, invited_at, r.attempts, metadata, r.last_created || new Date().toISOString()]);
  }

  console.log(`\ndistinct emails in mlops slack queue : ${rows.length}`);
  console.log(`  -> completed (import)              : ${completed}`);
  console.log(`  -> failed (import)                 : ${failed}`);
  console.log(`  -> pending/processing only (skip)  : ${skippedPending}`);
  console.log(`  -> already migrated (skip)         : ${skippedExisting}`);
  console.log(`  TOTAL to insert                    : ${payload.length}`);

  if (!COMMIT) { console.log('\nDRY-RUN — no writes. Re-run with --commit.'); await src.end(); await dst.end(); return; }

  const cols = ['email', 'account', 'status', 'error_message', 'invited_at', 'retry_count', 'metadata', 'created_at'];
  let written = 0;
  for (let i = 0; i < payload.length; i += 1000) {
    const b = payload.slice(i, i + 1000);
    const ph = b.map((_, r) => `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(',')})`).join(',');
    const res = await dst.query(`INSERT INTO public.integrations_slack_invitation_queue (${cols.join(',')}) VALUES ${ph}`, b.flat());
    written += res.rowCount;
  }
  console.log(`\nCOMMIT: inserted ${written} rows (${completed} completed, ${failed} failed).`);

  // verify
  console.table((await dst.query(`SELECT status, count(*)::int n FROM public.integrations_slack_invitation_queue WHERE metadata->>'migrated_from'='mlops.slack_invitation_queue' GROUP BY 1 ORDER BY n DESC`)).rows);
  await src.end(); await dst.end();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
