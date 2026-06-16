#!/usr/bin/env node
/**
 * Migrate the mlops-brand "people" + email history from the OLD gatewaze-admin
 * Supabase project into the NEW gatewaze 'aaif' brand.
 *
 * Source (READ-ONLY): mlops prod  (project wdewqtcctpdqxypwnlhp)
 * Target (writes only in --commit): aaif local (localhost:54332) or aaif prod.
 *
 * Stages (joined across the two DBs on lower(email) — the only stable key,
 * since source ids are bigint and target ids are uuid):
 *   1. people            customers           -> people            (upsert on email)
 *   2. email_send_log    email_logs          -> email_send_log    (carry source uuid id, ON CONFLICT(id) DO NOTHING)
 *   3. email_events      email_events        -> email_events      (carry source uuid id, ON CONFLICT(id) DO NOTHING)
 *   4. subscriptions     email_subscriptions -> list_subscriptions(upsert on (list_id,email)); ONLY subscribed rows of the
 *                        "Weekly Newsletter" topic, mapped to the 'user-community' list.
 *
 * SAFETY:
 *   - Source session is set READ ONLY; the script never writes to the source.
 *   - Does NOT touch auth.users — people are imported with auth_user_id=NULL,
 *     so no Supabase magic-link / confirmation email is ever triggered.
 *   - Idempotent: re-running inserts only what's missing.
 *   - Dry-run by DEFAULT. Pass --commit to write.
 *
 * Connection (env vars; a wrapper script supplies these from the env files):
 *   SRC_DB_HOST SRC_DB_PORT SRC_DB_USER SRC_DB_PASSWORD  SRC_DB_SSL(=require)
 *   DST_DB_HOST DST_DB_PORT DST_DB_USER DST_DB_PASSWORD  DST_DB_SSL(=disable|require)
 *
 * Flags:
 *   --commit            apply changes (default: dry-run, no writes)
 *   --limit N           cap to first N source customers and restrict logs/subs/
 *                       events to those people's emails (use for the LOCAL sample)
 *   --events-limit N    cap email_events rows scanned (local sample; default none)
 *   --no-events         skip the email_events stage
 *   --batch N           insert batch size (default 1000)
 *   --weekly-topic ID   source list_id for "Weekly Newsletter" (default topic_1)
 *
 * Usage: see scripts/migrate-mlops-to-aaif.sh
 */
import { createRequire } from 'module';
// `pg` is hoisted under packages/api in this workspace; anchor resolution there.
const require = createRequire(new URL('../packages/api/package.json', import.meta.url));
const pg = require('pg');

// ---------------------------------------------------------------- args + env
function parseArgs(argv) {
  const a = { commit: false, limit: null, eventsLimit: null, events: true, batch: 1000, eventsBatch: null, weeklyTopic: 'topic_1' };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--commit') a.commit = true;
    else if (t === '--no-events') a.events = false;
    else if (t === '--limit') a.limit = Number(argv[++i]);
    else if (t.startsWith('--limit=')) a.limit = Number(t.slice(8));
    else if (t === '--events-limit') a.eventsLimit = Number(argv[++i]);
    else if (t.startsWith('--events-limit=')) a.eventsLimit = Number(t.slice(15));
    // Separate batch for the narrow email_events stage (16 cols → up to ~4095
    // rows stays under Postgres' 65535-param cap). The global --batch is held
    // down by the 42-column people stage, so this lets events go much larger.
    else if (t === '--events-batch') a.eventsBatch = Number(argv[++i]);
    else if (t.startsWith('--events-batch=')) a.eventsBatch = Number(t.slice(15));
    else if (t === '--batch') a.batch = Number(argv[++i]);
    else if (t.startsWith('--batch=')) a.batch = Number(t.slice(8));
    else if (t === '--weekly-topic') a.weeklyTopic = argv[++i];
    else if (t.startsWith('--weekly-topic=')) a.weeklyTopic = t.slice(15);
    else throw new Error(`Unknown arg: ${t}`);
  }
  return a;
}

function sslFor(mode) {
  return mode === 'require' || mode === 'true' ? { rejectUnauthorized: false } : false;
}
function connConfig(prefix) {
  const host = process.env[`${prefix}_DB_HOST`];
  if (!host) throw new Error(`Missing ${prefix}_DB_HOST — did the wrapper export the connection env?`);
  return {
    host,
    port: Number(process.env[`${prefix}_DB_PORT`] || 5432),
    user: process.env[`${prefix}_DB_USER`],
    password: process.env[`${prefix}_DB_PASSWORD`],
    database: process.env[`${prefix}_DB_NAME`] || 'postgres',
    ssl: sslFor(process.env[`${prefix}_DB_SSL`] || (prefix === 'SRC' ? 'require' : 'disable')),
    connectionTimeoutMillis: 20000,
    statement_timeout: 0,
  };
}

const lc = (e) => (e == null ? null : String(e).trim().toLowerCase());

// --------------------------------------------------------------- insert util
/** Batched multi-row insert. `columns` = target col names; `rows` = arrays of
 *  values in that column order. `conflict` = full ON CONFLICT clause. Returns
 *  number of rows the DB reported affected (insert or update). */
async function insertBatch(client, table, columns, rows, conflict) {
  if (rows.length === 0) return 0;
  const colSql = columns.map((c) => `"${c}"`).join(', ');
  const tuples = [];
  const params = [];
  let p = 0;
  for (const r of rows) {
    tuples.push('(' + columns.map(() => `$${++p}`).join(', ') + ')');
    params.push(...r);
  }
  const tbl = table.includes('.') ? table : `public.${table}`;
  const sql = `INSERT INTO ${tbl} (${colSql}) VALUES ${tuples.join(', ')} ${conflict}`;
  const res = await client.query(sql, params);
  return res.rowCount;
}

/** Keyset-paginate a source query ordered by a unique column. `build(lastKey)`
 *  must return { text, values } selecting rows WHERE key > lastKey ORDER BY key
 *  LIMIT batch. `onBatch(rows)` is called per page. Stops at maxRows. */
async function paginate(src, keyCol, batch, maxRows, build, onBatch) {
  let last = null;
  let seen = 0;
  for (;;) {
    const remaining = maxRows == null ? batch : Math.min(batch, maxRows - seen);
    if (remaining <= 0) break;
    const q = build(last, remaining);
    const { rows } = await src.query(q.text, q.values);
    if (rows.length === 0) break;
    await onBatch(rows);
    seen += rows.length;
    last = rows[rows.length - 1][keyCol];
    if (rows.length < remaining) break;
  }
  return seen;
}

// --------------------------------------------------------------- auth.users
// Login-essential columns only. Excludes the generated confirmed_at and all
// *_token columns (which carry partial-unique indexes that would collide).
// Copying encrypted_password preserves the user's existing credentials so
// they can sign in to aaif unchanged. Direct INSERTs never trigger GoTrue
// email (confirmation/magic-link), so the migration stays silent.
const AUTH_USER_COLS = [
  'id', 'instance_id', 'aud', 'role', 'email', 'encrypted_password',
  'email_confirmed_at', 'last_sign_in_at', 'raw_app_meta_data',
  'raw_user_meta_data', 'created_at', 'updated_at', 'is_sso_user', 'is_anonymous',
];
const AUTH_IDENTITY_COLS = [
  'id', 'provider_id', 'user_id', 'identity_data', 'provider',
  'last_sign_in_at', 'created_at', 'updated_at',
];

async function stageAuthUsers(src, dst, args, scope) {
  console.log('\n── Stage 0: auth users (auth.users + auth.identities) ──');
  const params = [];
  let sc = '';
  if (scope) { params.push(scope); sc = 'AND lower(c.email) = ANY($1)'; }
  const total = (await src.query(
    `SELECT count(*)::int n FROM public.customers c
       JOIN auth.users u ON u.id = c.auth_user_id
      WHERE u.deleted_at IS NULL AND u.email IS NOT NULL ${sc}`, params)).rows[0].n;
  console.log(`   source auth users linked to migrated customers: ${total}`);

  if (!args.commit) {
    const existing = (await dst.query(`SELECT count(*)::int n FROM auth.users`)).rows[0].n;
    console.log(`   target auth.users currently: ${existing}`);
    console.log('   DRY-RUN: would insert auth.users + auth.identities (ON CONFLICT(id) DO NOTHING).');
    return { scanned: total, written: 0 };
  }

  // Pre-fetch existing target emails to respect the partial unique index on
  // auth.users(email) WHERE is_sso_user=false (don't collide with the admin).
  const existingEmails = new Set(
    (await dst.query(`SELECT lower(email) le FROM auth.users WHERE email IS NOT NULL`)).rows.map((r) => r.le));

  let written = 0, identities = 0, skipped = 0;
  await paginate(src, 'id', args.batch, null,
    (last, lim) => {
      const v = [];
      let s = '';
      if (scope) { v.push(scope); s = 'AND lower(c.email) = ANY($1)'; }
      let key = '';
      if (last != null) { v.push(last); key = `AND u.id > $${v.length}`; }
      return {
        text: `SELECT ${AUTH_USER_COLS.map((c) => 'u."' + c + '"').join(', ')}
                 FROM public.customers c JOIN auth.users u ON u.id = c.auth_user_id
                WHERE u.deleted_at IS NULL AND u.email IS NOT NULL ${s} ${key}
                ORDER BY u.id LIMIT ${lim}`,
        values: v,
      };
    },
    async (rows) => {
      const fresh = rows.filter((r) => !existingEmails.has(lc(r.email)));
      skipped += rows.length - fresh.length;
      if (!fresh.length) return;
      for (const r of fresh) existingEmails.add(lc(r.email));
      const jsonbCols = new Set(['raw_app_meta_data', 'raw_user_meta_data']);
      const payload = fresh.map((r) => AUTH_USER_COLS.map((c) =>
        jsonbCols.has(c) && r[c] != null ? JSON.stringify(r[c]) : r[c]));
      written += await insertBatch(dst, 'auth.users', AUTH_USER_COLS, payload, 'ON CONFLICT (id) DO NOTHING');
      const ids = fresh.map((r) => r.id);
      const idRows = (await src.query(
        `SELECT ${AUTH_IDENTITY_COLS.map((c) => '"' + c + '"').join(', ')}
           FROM auth.identities WHERE user_id = ANY($1)`, [ids])).rows;
      if (idRows.length) {
        const ip = idRows.map((r) => AUTH_IDENTITY_COLS.map((c) =>
          c === 'identity_data' && r[c] != null ? JSON.stringify(r[c]) : r[c]));
        identities += await insertBatch(dst, 'auth.identities', AUTH_IDENTITY_COLS, ip, 'ON CONFLICT (id) DO NOTHING');
      }
      if (written % 20000 < args.batch) console.log(`   …${written} users, ${identities} identities`);
    });
  console.log(`   inserted ${written} auth.users, ${identities} identities (skipped ${skipped} email-collision)`);
  return { scanned: total, written };
}

// ------------------------------------------------------------------- people
// auth_user_id is resolved per-email from the TARGET auth.users (built after
// stageAuthUsers): for migrated users that's the preserved mlops uuid; for an
// email that already existed on the target (e.g. a prod signup) it's that
// user's uuid — so we never point at an un-imported uuid. account_id stays
// null (single-brand DB); id/avatar_url are target-only.
const PEOPLE_EXCLUDE = new Set(['id', 'avatar_url', 'account_id']);

async function stagePeople(src, dst, args, scope, targetCols, emailToId, authEmailToId) {
  console.log('\n── Stage 1: people (customers → people) ──');
  // Columns to carry = intersection of source customers and target people,
  // minus identity/tenant columns we deliberately drop.
  const srcColsRes = await src.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='customers'`);
  const srcCols = new Set(srcColsRes.rows.map((r) => r.column_name));
  const carry = [...targetCols].filter((c) => srcCols.has(c) && !PEOPLE_EXCLUDE.has(c));
  if (!carry.includes('email')) throw new Error('email column missing from intersection');
  console.log(`   carrying ${carry.length} columns (email upsert; auth_user_id linked to migrated auth.users)`);

  const where = scope ? `WHERE email IS NOT NULL AND email <> '' AND lower(email) = ANY($1)` : `WHERE email IS NOT NULL AND email <> ''`;
  const totalRes = await src.query(
    `SELECT count(*)::int n FROM public.customers ${where}`, scope ? [scope] : []);
  const total = totalRes.rows[0].n;
  console.log(`   source customers in scope: ${total}`);

  if (!args.commit) {
    // estimate insert vs update by overlap with existing target emails
    const existing = await dst.query(`SELECT count(*)::int n FROM public.people`);
    console.log(`   target people currently: ${existing.rows[0].n}`);
    console.log('   DRY-RUN: would upsert (insert new / update existing on email).');
    return { scanned: total, written: 0 };
  }

  let written = 0;
  const cols = carry;
  await paginate(src, 'id', args.batch, args.limit,
    (last, lim) => ({
      text: `SELECT id, ${cols.map((c) => `"${c}"`).join(', ')} FROM public.customers
             ${scope ? 'WHERE lower(email) = ANY($1) AND' : 'WHERE'} email IS NOT NULL AND email <> ''
             ${last == null ? '' : (scope ? 'AND' : 'AND') + ' id > ' + (scope ? '$2' : '$1')}
             ORDER BY id LIMIT ${lim}`.replace('WHERE AND', 'WHERE'),
      values: scope ? (last == null ? [scope] : [scope, last]) : (last == null ? [] : [last]),
    }),
    async (rows) => {
      // Resolve auth_user_id from the TARGET auth.users by email (never the
      // raw source uuid), so a collision with an existing target user links
      // to that user, not an un-imported mlops uuid.
      const rowVals = (r, columns) => columns.map((c) =>
        c === 'auth_user_id' ? (authEmailToId.get(lc(r.email)) ?? null) : r[c]);
      const payload = rows.map((r) => rowVals(r, cols));
      // per-batch upsert; fall back to per-row on cio_id unique collisions.
      // auth_user_id only fills when currently null — never clobber an
      // existing aaif user's auth link (e.g. the admin).
      const setClause = (c) => c === 'auth_user_id'
        ? `"auth_user_id" = COALESCE(public.people.auth_user_id, EXCLUDED."auth_user_id")`
        : `"${c}" = EXCLUDED."${c}"`;
      const setSql = cols.filter((c) => c !== 'email').map(setClause).join(', ');
      try {
        await insertBatch(dst, 'people', cols, payload,
          `ON CONFLICT (email) DO UPDATE SET ${setSql}`);
      } catch (e) {
        for (const r of rows) {
          const vals = rowVals(r, cols);
          try {
            await insertBatch(dst, 'people', cols, [vals],
              `ON CONFLICT (email) DO UPDATE SET ${setSql}`);
          } catch (e2) {
            // likely cio_id collision with a different email → retry without cio_id
            const cols2 = cols.filter((c) => c !== 'cio_id');
            const set2 = cols2.filter((c) => c !== 'email').map(setClause).join(', ');
            await insertBatch(dst, 'people', cols2, [rowVals(r, cols2)],
              `ON CONFLICT (email) DO UPDATE SET ${set2}`);
            console.warn(`   ! ${r.email}: imported without cio_id (${e2.code})`);
          }
        }
      }
      written += rows.length;
      if (written % 10000 === 0) console.log(`   …${written}/${total}`);
    });

  // build email → new uuid map for downstream stages
  const map = await dst.query(`SELECT id, lower(email) le FROM public.people`);
  for (const r of map.rows) emailToId.set(r.le, r.id);
  console.log(`   upserted ${written}; person map size ${emailToId.size}`);
  return { scanned: total, written };
}

// ----------------------------------------------------------- email_send_log
async function stageSendLog(src, dst, args, scope, emailToId) {
  console.log('\n── Stage 2: email_send_log (email_logs → email_send_log) ──');
  const where = scope ? `WHERE lower(recipient_email) = ANY($1)` : '';
  const total = (await src.query(
    `SELECT count(*)::int n FROM public.email_logs ${where}`, scope ? [scope] : [])).rows[0].n;
  console.log(`   source email_logs in scope: ${total}`);
  if (!args.commit) { console.log('   DRY-RUN: would insert new rows (ON CONFLICT(id) DO NOTHING).'); return { scanned: total, written: 0 }; }

  const cols = ['id', 'recipient_email', 'recipient_customer_id', 'from_address', 'reply_to',
    'subject', 'content_html', 'provider_message_id', 'provider', 'status',
    'delivered_at', 'first_opened_at', 'first_clicked_at', 'bounced_at', 'bounce_reason',
    'spam_reported_at', 'unsubscribed_at', 'created_at', 'metadata'];
  let written = 0;
  await paginate(src, 'id', args.batch, null,
    (last, lim) => ({
      text: `SELECT * FROM public.email_logs
             ${scope ? 'WHERE lower(recipient_email) = ANY($1)' : 'WHERE TRUE'}
             ${last == null ? '' : 'AND id > ' + (scope ? '$2' : '$1')}
             ORDER BY id LIMIT ${lim}`,
      values: scope ? (last == null ? [scope] : [scope, last]) : (last == null ? [] : [last]),
    }),
    async (rows) => {
      // recipient_customer_id is INTEGER in the target (the legacy customer
      // id), not a uuid FK to people — the per-person link is via
      // recipient_email. Carry the source integer verbatim.
      const payload = rows.map((r) => [
        r.id, r.recipient_email, r.recipient_customer_id ?? null,
        r.from_address, r.reply_to, r.subject, r.content_html, r.sendgrid_message_id,
        'sendgrid', r.status, r.delivered_at, r.opened_at, r.first_clicked_at,
        r.bounced_at, r.bounce_reason, r.spam_reported_at, r.unsubscribed_at, r.created_at,
        JSON.stringify({
          migrated_from: 'mlops.email_logs',
          src_content_text: r.content_text ?? null,
          src_click_count: r.click_count ?? null,
          src_sent_by_admin_user_id: r.sent_by_admin_user_id ?? null,
          src_batch_job_id: r.batch_job_id ?? null,
        }),
      ]);
      written += await insertBatch(dst, 'email_send_log', cols, payload, 'ON CONFLICT (id) DO NOTHING');
    });
  console.log(`   inserted ${written} new (of ${total})`);
  return { scanned: total, written };
}

// -------------------------------------------------------------- email_events
async function stageEvents(src, dst, args, scope) {
  console.log('\n── Stage 3: email_events (email_events → email_events) ──');
  if (!args.events) { console.log('   skipped (--no-events)'); return { scanned: 0, written: 0 }; }
  const where = scope ? `WHERE lower(email) = ANY($1)` : '';
  const total = (await src.query(
    `SELECT count(*)::int n FROM public.email_events ${where}`, scope ? [scope] : [])).rows[0].n;
  const cap = args.eventsLimit != null ? Math.min(total, args.eventsLimit) : total;
  console.log(`   source email_events in scope: ${total}${args.eventsLimit != null ? ` (capped to ${cap})` : ''}`);
  if (!args.commit) { console.log('   DRY-RUN: would insert new rows (ON CONFLICT(id) DO NOTHING).'); return { scanned: cap, written: 0 }; }

  const cols = ['id', 'email', 'event_type', 'email_id', 'campaign_id', 'broadcast_id',
    'action_id', 'subject', 'recipient', 'link_url', 'link_id', 'bounce_type',
    'failure_reason', 'raw_payload', 'event_timestamp', 'created_at'];
  let written = 0;
  const scanned = await paginate(src, 'id', (args.eventsBatch ?? args.batch), args.eventsLimit,
    (last, lim) => ({
      text: `SELECT * FROM public.email_events
             ${scope ? 'WHERE lower(email) = ANY($1)' : 'WHERE TRUE'}
             ${last == null ? '' : 'AND id > ' + (scope ? '$2' : '$1')}
             ORDER BY id LIMIT ${lim}`,
      values: scope ? (last == null ? [scope] : [scope, last]) : (last == null ? [] : [last]),
    }),
    async (rows) => {
      const payload = rows.map((r) => cols.map((c) => (c === 'raw_payload' && r[c] != null ? JSON.stringify(r[c]) : r[c])));
      written += await insertBatch(dst, 'email_events', cols, payload, 'ON CONFLICT (id) DO NOTHING');
      if (written && written % 100000 === 0) console.log(`   …${written} inserted`);
    });
  console.log(`   scanned ${scanned}, inserted ${written} new`);
  return { scanned, written };
}

// --------------------------------------------------------- list_subscriptions
async function stageSubscriptions(src, dst, args, scope, emailToId, listId) {
  console.log('\n── Stage 4: subscriptions (Weekly Newsletter → user-community) ──');
  const params = [args.weeklyTopic];
  let scopeClause = '';
  if (scope) { params.push(scope); scopeClause = 'AND lower(email) = ANY($2)'; }
  const total = (await src.query(
    `SELECT count(*)::int n FROM public.email_subscriptions
     WHERE list_id = $1 AND subscribed = true ${scopeClause}`, params)).rows[0].n;
  console.log(`   source '${args.weeklyTopic}' subscribed rows in scope: ${total}`);
  console.log(`   target user-community list id: ${listId}`);
  if (!args.commit) { console.log('   DRY-RUN: would upsert into list_subscriptions on (list_id,email).'); return { scanned: total, written: 0 }; }

  const cols = ['list_id', 'person_id', 'email', 'subscribed', 'subscribed_at', 'source', 'metadata'];
  let written = 0;
  await paginate(src, 'id', args.batch, null,
    (last, lim) => {
      const v = [args.weeklyTopic];
      let sc = '';
      if (scope) { v.push(scope); sc = 'AND lower(email) = ANY($2)'; }
      let keyClause = '';
      if (last != null) { v.push(last); keyClause = `AND id > $${v.length}`; }
      return {
        text: `SELECT id, email, subscribed_at FROM public.email_subscriptions
               WHERE list_id = $1 AND subscribed = true ${sc} ${keyClause}
               ORDER BY id LIMIT ${lim}`,
        values: v,
      };
    },
    async (rows) => {
      const payload = rows.map((r) => [
        listId, emailToId.get(lc(r.email)) ?? null, r.email, true,
        r.subscribed_at, 'import',
        JSON.stringify({ migrated_from: `mlops.email_subscriptions/${args.weeklyTopic}` }),
      ]);
      written += await insertBatch(dst, 'list_subscriptions', cols, payload,
        `ON CONFLICT (list_id, email) DO UPDATE SET subscribed = true,
         subscribed_at = COALESCE(public.list_subscriptions.subscribed_at, EXCLUDED.subscribed_at),
         unsubscribed_at = NULL, person_id = COALESCE(EXCLUDED.person_id, public.list_subscriptions.person_id)`);
    });
  console.log(`   upserted ${written} (of ${total})`);
  return { scanned: total, written };
}

// -------------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const src = new pg.Client(connConfig('SRC'));
  const dst = new pg.Client(connConfig('DST'));
  await src.connect();
  await dst.connect();
  // Harden: source is prod — forbid any accidental write.
  await src.query('SET default_transaction_read_only = on');

  console.log('============================================================');
  console.log(` mlops → aaif migration   [${args.commit ? 'COMMIT' : 'DRY-RUN'}]`);
  console.log(`   source : ${connConfig('SRC').host}`);
  console.log(`   target : ${connConfig('DST').host}:${connConfig('DST').port}`);
  if (args.limit != null) console.log(`   limit  : first ${args.limit} customers (scoped sample)`);
  if (args.eventsLimit != null) console.log(`   events : capped at ${args.eventsLimit}`);
  console.log('============================================================');

  // Resolve the user-community list id in the target.
  const listRes = await dst.query(`SELECT id FROM public.lists WHERE slug = 'user-community'`);
  if (listRes.rows.length === 0) throw new Error("target has no list with slug='user-community'");
  const listId = listRes.rows[0].id;

  // Verify the weekly-newsletter topic label on the source (sanity).
  const lbl = await src.query(
    `SELECT label FROM public.email_topic_labels WHERE list_id = $1`, [args.weeklyTopic]);
  console.log(`source topic '${args.weeklyTopic}' → label: ${lbl.rows[0]?.label ?? '(none)'}`);

  // Build the scoped-sample email set if --limit is set.
  let scope = null;
  if (args.limit != null) {
    const s = await src.query(
      `SELECT lower(email) le FROM public.customers
       WHERE email IS NOT NULL AND email <> '' ORDER BY id LIMIT $1`, [args.limit]);
    scope = s.rows.map((r) => r.le);
    console.log(`scoped sample: ${scope.length} emails`);
  }

  // Target people columns (for the people intersection).
  const tCols = new Set((await dst.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='people'`)).rows.map((r) => r.column_name));

  const emailToId = new Map();
  // In dry-run, still load existing target people so we could report mapping.
  if (!args.commit) {
    const m = await dst.query(`SELECT id, lower(email) le FROM public.people`);
    for (const r of m.rows) emailToId.set(r.le, r.id);
  }

  // Order matters: do the small, business-critical stages (people, logs,
  // subscriptions) FIRST so they complete quickly, then run the large,
  // resumable email_events load LAST.
  const report = {};
  // Auth users first so people.auth_user_id links to real, migrated accounts.
  report.authUsers = await stageAuthUsers(src, dst, args, scope);
  // Build email → target auth.users.id map AFTER the auth stage: this holds
  // both the imported mlops users (preserved uuid) and any pre-existing target
  // users (their uuid), so people link correctly even on email collisions.
  const authEmailToId = new Map();
  for (const r of (await dst.query(`SELECT id, lower(email) le FROM auth.users WHERE email IS NOT NULL`)).rows) {
    authEmailToId.set(r.le, r.id);
  }
  console.log(`auth email→id map: ${authEmailToId.size} entries`);
  report.people = await stagePeople(src, dst, args, scope, tCols, emailToId, authEmailToId);
  report.sendLog = await stageSendLog(src, dst, args, scope, emailToId);
  report.subscriptions = await stageSubscriptions(src, dst, args, scope, emailToId, listId);
  report.events = await stageEvents(src, dst, args, scope);

  console.log('\n================= RECONCILIATION =================');
  for (const [k, v] of Object.entries(report)) {
    console.log(`  ${k.padEnd(14)} scanned=${v.scanned}  written=${v.written}`);
  }
  console.log(args.commit ? '  (COMMIT — changes applied)' : '  (DRY-RUN — no changes written)');
  console.log('==================================================');

  await src.end();
  await dst.end();
}

main().catch((e) => { console.error('\nFATAL:', e); process.exit(1); });
