#!/usr/bin/env node
/**
 * Port the mlops "Event Updates" (topic_8) subscription list onto the aaif
 * production `event-updates` list, subscribing every person in the aaif DB
 * while preserving unsubscribes from BOTH systems.
 *
 * Source (READ-ONLY): mlops prod  email_subscriptions where list_id='topic_8'
 * Target: aaif prod    list_subscriptions for list slug 'event-updates'
 *
 * Final state per aaif person (matched by lower(email)):
 *   - If the person ALREADY has an aaif event-updates row  -> left untouched
 *     (ON CONFLICT (list_id,email) DO NOTHING). This preserves every existing
 *     aaif subscribe AND unsubscribe made via the subscription-centre.
 *   - Otherwise insert a new row:
 *       * subscribed = FALSE  if the email is unsubscribed in mlops topic_8
 *         (carry mlops subscribed_at / unsubscribed_at)               -> preserve mlops unsubscribe
 *       * subscribed = TRUE   for everyone else                       -> "subscribe everyone"
 *
 * SAFETY:
 *   - Source session is READ ONLY; never writes to mlops.
 *   - Never touches auth.users; no emails are sent (pure list_subscriptions insert).
 *   - Idempotent: ON CONFLICT DO NOTHING, re-runs insert only what's missing and
 *     never mutates an existing subscription row.
 *   - Dry-run by DEFAULT. Pass --commit to write.
 *
 * Env (supplied by a wrapper from the env files):
 *   SRC_DB_HOST SRC_DB_PORT SRC_DB_USER SRC_DB_PASSWORD  SRC_DB_SSL(=require)
 *   DST_DB_HOST DST_DB_PORT DST_DB_USER DST_DB_PASSWORD  DST_DB_SSL(=require)
 *
 * Flags:
 *   --commit       apply changes (default: dry-run analysis only)
 *   --topic ID     source list_id for Event Updates (default topic_8)
 *   --slug SLUG    target list slug (default event-updates)
 *   --batch N      insert batch size (default 2000; 8 cols -> <65535 params)
 */
import { createRequire } from 'module';
const require = createRequire(new URL('../packages/api/package.json', import.meta.url));
const pg = require('pg');

function parseArgs(argv) {
  const a = { commit: false, topic: 'topic_8', slug: 'event-updates', batch: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--commit') a.commit = true;
    else if (t === '--topic') a.topic = argv[++i];
    else if (t === '--slug') a.slug = argv[++i];
    else if (t === '--batch') a.batch = Number(argv[++i]);
    else throw new Error(`Unknown arg: ${t}`);
  }
  return a;
}
const sslFor = (m) => (m === 'require' || m === 'true' ? { rejectUnauthorized: false } : false);
function conn(prefix) {
  const host = process.env[`${prefix}_DB_HOST`];
  if (!host) throw new Error(`Missing ${prefix}_DB_HOST`);
  return {
    host, port: Number(process.env[`${prefix}_DB_PORT`] || 5432),
    user: process.env[`${prefix}_DB_USER`], password: process.env[`${prefix}_DB_PASSWORD`],
    database: process.env[`${prefix}_DB_NAME`] || 'postgres', ssl: sslFor(process.env[`${prefix}_DB_SSL`]),
  };
}
const lc = (s) => (s == null ? s : String(s).trim().toLowerCase());

async function insertBatch(dst, cols, rows) {
  if (!rows.length) return 0;
  const ph = rows.map((_, r) => `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(',')})`).join(',');
  const sql = `INSERT INTO public.list_subscriptions (${cols.join(',')}) VALUES ${ph}
               ON CONFLICT (list_id, email) DO NOTHING`;
  const res = await dst.query(sql, rows.flat());
  return res.rowCount;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const src = new pg.Client(conn('SRC'));
  const dst = new pg.Client(conn('DST'));
  await src.connect(); await dst.connect();
  await src.query('SET default_transaction_read_only = on');
  await dst.query("SET statement_timeout = '600s'");

  console.log('============================================================');
  console.log(` mlops Event Updates -> aaif event-updates   [${args.commit ? 'COMMIT' : 'DRY-RUN'}]`);
  console.log(`   source : ${conn('SRC').host}  (topic ${args.topic})`);
  console.log(`   target : ${conn('DST').host}:${conn('DST').port}  (slug ${args.slug})`);
  console.log('============================================================');

  // Resolve target list id.
  const lr = await dst.query('SELECT id, name FROM public.lists WHERE slug = $1', [args.slug]);
  if (!lr.rows.length) throw new Error(`target has no list with slug='${args.slug}'`);
  const listId = lr.rows[0].id;
  console.log(`target list: ${lr.rows[0].name} (${listId})`);

  // 1) Load mlops topic_8 into a map: lower(email) -> {subscribed, subscribed_at, unsubscribed_at}
  //    On duplicate emails keep the "most subscribed / most recent" row: a
  //    subscribed=true beats false; otherwise the later updated_at wins.
  const mlops = new Map();
  {
    const r = await src.query(
      `SELECT lower(email) e, subscribed, subscribed_at, unsubscribed_at, updated_at
         FROM public.email_subscriptions WHERE list_id = $1 AND email IS NOT NULL`, [args.topic]);
    for (const row of r.rows) {
      const prev = mlops.get(row.e);
      if (!prev) { mlops.set(row.e, row); continue; }
      const better = (row.subscribed && !prev.subscribed) ||
        (row.subscribed === prev.subscribed && (row.updated_at?.getTime() || 0) > (prev.updated_at?.getTime() || 0));
      if (better) mlops.set(row.e, row);
    }
    let sub = 0, unsub = 0;
    for (const v of mlops.values()) (v.subscribed ? sub++ : unsub++);
    console.log(`\nmlops topic '${args.topic}': ${mlops.size} distinct emails (${sub} subscribed, ${unsub} unsubscribed)`);
  }

  // 2) Existing aaif event-updates emails (to skip / preserve).
  const existing = new Set();
  {
    const r = await dst.query('SELECT lower(email) e FROM public.list_subscriptions WHERE list_id = $1', [listId]);
    for (const row of r.rows) existing.add(row.e);
    console.log(`aaif event-updates existing rows: ${existing.size} (left untouched)`);
  }

  // 3) Stream every aaif person; classify.
  const cols = ['list_id', 'person_id', 'email', 'subscribed', 'subscribed_at', 'unsubscribed_at', 'source', 'metadata'];
  const meta = JSON.stringify({ migrated_from: `mlops.email_subscriptions/${args.topic}`, origin: 'event-updates-backfill' });
  let scanned = 0, skipExistingRow = 0, skipDupEmail = 0, planTrue = 0, planFalse = 0, written = 0;
  const existingRows = new Set(existing); // snapshot of REAL pre-existing aaif rows
  let batch = [];
  const flush = async () => {
    if (args.commit && batch.length) written += await insertBatch(dst, cols, batch);
    batch = [];
  };

  let last = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const r = await dst.query(
      `SELECT id, email FROM public.people
        WHERE id > $1 AND email IS NOT NULL
        ORDER BY id LIMIT 5000`, [last]);
    if (!r.rows.length) break;
    for (const p of r.rows) {
      scanned++;
      last = p.id;
      const e = lc(p.email);
      if (existing.has(e)) {
        if (existingRows.has(e)) skipExistingRow++; else skipDupEmail++;
        continue;
      }
      // Guard against duplicate emails within people (avoid same-batch conflict).
      existing.add(e);
      const m = mlops.get(e);
      if (m && !m.subscribed) {
        planFalse++;
        batch.push([listId, p.id, p.email, false, m.subscribed_at, m.unsubscribed_at, 'import', meta]);
      } else {
        planTrue++;
        batch.push([listId, p.id, p.email, true, m?.subscribed_at ?? null, null, 'import', meta]);
      }
      if (batch.length >= args.batch) await flush();
    }
  }
  await flush();

  console.log('\n──────────────── RESULT ────────────────');
  console.log(`aaif people scanned              : ${scanned}`);
  console.log(`  already had aaif row (untouched): ${skipExistingRow}`);
  console.log(`  duplicate email in people (skip): ${skipDupEmail}`);
  console.log(`  plan SUBSCRIBED (true)         : ${planTrue}`);
  console.log(`  plan UNSUBSCRIBED (false)      : ${planFalse}   <- preserved mlops unsubscribes`);
  console.log(`  total new rows to insert       : ${planTrue + planFalse}`);
  if (args.commit) console.log(`  rows actually inserted         : ${written}`);
  else console.log(`\nDRY-RUN: no writes. Re-run with --commit to apply.`);

  await src.end(); await dst.end();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
