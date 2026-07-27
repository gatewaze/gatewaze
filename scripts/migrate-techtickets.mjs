#!/usr/bin/env node
/**
 * TechTickets data migration — OLD gatewaze-admin public schema → NEW modular
 * schema, SAME reused Supabase project (auth.users + storage preserved in place).
 *
 * Source (READ-ONLY): scratch Postgres holding a pg_restore of the pre-wipe
 *   backup (public schema only).  Target: the reused techtickets project.
 *
 * Differs from migrate-mlops-to-aaif.mjs:
 *   - NO auth import — auth.users is preserved; auth_user_id resolved by email
 *     from the target's existing auth.users.
 *   - email_send_log.recipient_customer_id is UUID here → resolve to people.id.
 *   - Adds events, people_profiles, and people_events (customer_events) stages.
 *   - Subscriptions: one target list per old topic (topic_1..5).
 *
 * Dry-run by default; pass --commit to write.  --activities also loads the
 * 10.3M-row customer_activities (off by default; slow).
 */
import { createRequire } from 'module';
const require = createRequire(new URL('../packages/api/package.json', import.meta.url));
const pg = require('pg');

const args = { commit: false, batch: 1000, activities: false, only: null };
for (const t of process.argv.slice(2)) {
  if (t === '--commit') args.commit = true;
  else if (t === '--activities') args.activities = true;
  else if (t.startsWith('--batch=')) args.batch = Number(t.slice(8));
  else if (t.startsWith('--only=')) args.only = t.slice(7).split(',').map((s) => s.trim());
  else throw new Error(`Unknown arg: ${t}`);
}

const lc = (e) => (e == null ? null : String(e).trim().toLowerCase());
function sslFor(m) { return m === 'require' || m === 'true' ? { rejectUnauthorized: false } : false; }
function conn(prefix) {
  return {
    host: process.env[`${prefix}_DB_HOST`], port: Number(process.env[`${prefix}_DB_PORT`] || 5432),
    user: process.env[`${prefix}_DB_USER`], password: process.env[`${prefix}_DB_PASSWORD`],
    database: process.env[`${prefix}_DB_NAME`] || 'postgres',
    ssl: sslFor(process.env[`${prefix}_DB_SSL`] || (prefix === 'SRC' ? 'disable' : 'require')),
    connectionTimeoutMillis: 20000, statement_timeout: 0,
  };
}
async function insertBatch(client, table, columns, rows, conflict) {
  if (rows.length === 0) return 0;
  const colSql = columns.map((c) => `"${c}"`).join(', ');
  const tbl = table.includes('.') ? table : `public.${table}`;
  // Chunk so ncols * nrows stays under Postgres' 65535 bind-parameter cap.
  const maxRows = Math.max(1, Math.floor(60000 / columns.length));
  let total = 0;
  for (let i = 0; i < rows.length; i += maxRows) {
    const chunk = rows.slice(i, i + maxRows);
    const tuples = []; const params = []; let p = 0;
    for (const r of chunk) { tuples.push('(' + columns.map(() => `$${++p}`).join(', ') + ')'); params.push(...r); }
    const res = await client.query(`INSERT INTO ${tbl} (${colSql}) VALUES ${tuples.join(', ')} ${conflict}`, params);
    total += res.rowCount;
  }
  return total;
}
async function paginate(src, keyCol, batch, build, onBatch) {
  let last = null, seen = 0;
  for (;;) {
    const q = build(last, batch);
    const { rows } = await src.query(q.text, q.values);
    if (rows.length === 0) break;
    await onBatch(rows); seen += rows.length; last = rows[rows.length - 1][keyCol];
    if (rows.length < batch) break;
  }
  return seen;
}
async function colsOf(client, table) {
  // Exclude GENERATED ALWAYS columns — they reject explicit inserts.
  return new Set((await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
       AND is_generated <> 'ALWAYS' AND generation_expression IS NULL`,
    [table])).rows.map((r) => r.column_name));
}
// Build email/customer_id/cio_id → person uuid (+ cio_id → email) from the
// CURRENT target people, so downstream stages work even if the people stage
// is skipped (--only re-runs).
async function buildMaps(src, dst, maps) {
  const pmap = new Map();
  for (const r of (await dst.query(`SELECT id, lower(email) le FROM public.people`)).rows) { pmap.set(r.le, r.id); maps.email.set(r.le, r.id); }
  for (const r of (await src.query(`SELECT id, cio_id, lower(email) le FROM public.customers WHERE email IS NOT NULL AND email<>''`)).rows) {
    const pid = pmap.get(r.le); if (!pid) continue;
    maps.custId.set(String(r.id), pid);
    if (r.cio_id != null) { maps.cioId.set(String(r.cio_id), pid); maps.cioEmail.set(String(r.cio_id), r.le); }
  }
  console.log(`   maps: email=${maps.email.size} custId=${maps.custId.size} cioId=${maps.cioId.size}`);
}

// ------------------------------------------------------------------- people
const PEOPLE_EXCLUDE = new Set(['id', 'avatar_url', 'account_id', 'contact_kind', 'acquisition_source']);
async function stagePeople(src, dst, authEmailToId, maps) {
  console.log('\n── Stage 1: people (customers → people) ──');
  const [sCols, tCols] = [await colsOf(src, 'customers'), await colsOf(dst, 'people')];
  const carry = [...tCols].filter((c) => sCols.has(c) && !PEOPLE_EXCLUDE.has(c));
  const jsonb = new Set(['attributes', 'attribute_timestamps']); // applicable_privacy_laws is text[] — pass raw
  const total = (await src.query(`SELECT count(*)::int n FROM public.customers WHERE email IS NOT NULL AND email<>''`)).rows[0].n;
  console.log(`   carrying ${carry.length} cols; source customers ${total}`);
  if (!args.commit) { console.log('   DRY-RUN'); return { scanned: total, written: 0 }; }
  const setSql = carry.filter((c) => c !== 'email').map((c) => c === 'auth_user_id'
    ? `"auth_user_id"=COALESCE(public.people.auth_user_id,EXCLUDED."auth_user_id")` : `"${c}"=EXCLUDED."${c}"`).join(', ');
  let written = 0;
  await paginate(src, 'id', args.batch, (last, lim) => ({
    text: `SELECT id, ${carry.map((c) => `"${c}"`).join(', ')} FROM public.customers
           WHERE email IS NOT NULL AND email<>'' ${last == null ? '' : 'AND id > $1'} ORDER BY id LIMIT ${lim}`,
    values: last == null ? [] : [last],
  }), async (rows) => {
    const val = (r, c) => c === 'auth_user_id' ? (authEmailToId.get(lc(r.email)) ?? null)
      : (jsonb.has(c) && r[c] != null ? JSON.stringify(r[c]) : r[c]);
    const payload = rows.map((r) => carry.map((c) => val(r, c)));
    try {
      await insertBatch(dst, 'people', carry, payload, `ON CONFLICT (email) DO UPDATE SET ${setSql}`);
    } catch {
      for (const r of rows) {
        try { await insertBatch(dst, 'people', carry, [carry.map((c) => val(r, c))], `ON CONFLICT (email) DO UPDATE SET ${setSql}`); }
        catch (e2) {
          const c2 = carry.filter((c) => c !== 'cio_id');
          const s2 = c2.filter((c) => c !== 'email').map((c) => c === 'auth_user_id'
            ? `"auth_user_id"=COALESCE(public.people.auth_user_id,EXCLUDED."auth_user_id")` : `"${c}"=EXCLUDED."${c}"`).join(', ');
          await insertBatch(dst, 'people', c2, [c2.map((c) => val(r, c))], `ON CONFLICT (email) DO UPDATE SET ${s2}`);
          console.warn(`   ! ${r.email}: without cio_id (${e2.code})`);
        }
      }
    }
    written += rows.length;
    if (written % 10000 === 0) console.log(`   …${written}/${total}`);
  });
  // build email/customer_id/cio_id → person uuid maps
  const pmap = new Map();
  for (const r of (await dst.query(`SELECT id, lower(email) le FROM public.people`)).rows) pmap.set(r.le, r.id);
  for (const r of (await src.query(`SELECT id, cio_id, lower(email) le FROM public.customers WHERE email IS NOT NULL AND email<>''`)).rows) {
    const pid = pmap.get(r.le); if (!pid) continue;
    maps.email.set(r.le, pid); maps.custId.set(String(r.id), pid); if (r.cio_id) maps.cioId.set(String(r.cio_id), pid);
  }
  console.log(`   upserted ${written}; maps email=${maps.email.size} custId=${maps.custId.size} cioId=${maps.cioId.size}`);
  return { scanned: total, written };
}

// generic intersection-carry stage (events, email_events)
async function stageIntersect(src, dst, table, conflict, opts = {}) {
  console.log(`\n── ${table} (intersection carry) ──`);
  const [sCols, tCols] = [await colsOf(src, table), await colsOf(dst, table)];
  const exclude = new Set(opts.exclude || []);
  const carry = [...tCols].filter((c) => sCols.has(c) && !exclude.has(c));
  const jsonb = new Set(opts.jsonb || []);
  const total = (await src.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n;
  console.log(`   carrying ${carry.length} cols; source ${total}`);
  if (!args.commit) { console.log('   DRY-RUN'); return { scanned: total, written: 0 }; }
  let written = 0, skipped = 0;
  await paginate(src, opts.key || 'id', opts.batch || args.batch, (last, lim) => ({
    text: `SELECT ${carry.map((c) => `"${c}"`).join(', ')} FROM public.${table}
           ${last == null ? '' : `WHERE "${opts.key || 'id'}" > $1`} ORDER BY "${opts.key || 'id'}" LIMIT ${lim}`,
    values: last == null ? [] : [last],
  }), async (rows) => {
    const payload = rows.map((r) => carry.map((c) => (jsonb.has(c) && r[c] != null ? JSON.stringify(r[c]) : r[c])));
    try {
      written += await insertBatch(dst, table, carry, payload, conflict);
    } catch {
      // fall back to per-row so one dangling-FK/bad row can't sink the batch
      for (const row of payload) {
        try { written += await insertBatch(dst, table, carry, [row], conflict); }
        catch { skipped++; }
      }
    }
    if (written && written % 50000 === 0) console.log(`   …${written}`);
  });
  console.log(`   inserted ${written} (skipped ${skipped}) of ${total}`);
  return { scanned: total, written };
}

// people_profiles (member_profiles → people_profiles, customer_id → person_id)
async function stageProfiles(src, dst, maps) {
  console.log('\n── people_profiles (member_profiles) ──');
  const total = (await src.query(`SELECT count(*)::int n FROM public.member_profiles`)).rows[0].n;
  console.log(`   source member_profiles ${total}`);
  if (!args.commit) { console.log('   DRY-RUN'); return { scanned: total, written: 0 }; }
  const cols = ['person_id', 'qr_code_id', 'qr_enabled', 'profile_visibility', 'allow_contact_sharing', 'created_at', 'updated_at'];
  let written = 0, skipped = 0;
  await paginate(src, 'id', args.batch, (last, lim) => ({
    text: `SELECT id, customer_id, qr_code_id, qr_enabled, profile_visibility, allow_contact_sharing, created_at, updated_at
           FROM public.member_profiles ${last == null ? '' : 'WHERE id > $1'} ORDER BY id LIMIT ${lim}`,
    values: last == null ? [] : [last],
  }), async (rows) => {
    const payload = [];
    for (const r of rows) {
      const pid = maps.custId.get(String(r.customer_id));
      if (!pid) { skipped++; continue; }
      payload.push([pid, r.qr_code_id, r.qr_enabled, r.profile_visibility, r.allow_contact_sharing, r.created_at, r.updated_at]);
    }
    if (payload.length) written += await insertBatch(dst, 'people_profiles', cols, payload, 'ON CONFLICT (person_id) DO NOTHING');
  });
  console.log(`   inserted ${written} (skipped ${skipped} no-person)`);
  return { scanned: total, written };
}

// email_send_log (email_logs → recipient_customer_id resolved to people.id uuid)
async function stageSendLog(src, dst, maps) {
  console.log('\n── email_send_log (email_logs) ──');
  const total = (await src.query(`SELECT count(*)::int n FROM public.email_logs`)).rows[0].n;
  console.log(`   source email_logs ${total}`);
  if (!args.commit) { console.log('   DRY-RUN'); return { scanned: total, written: 0 }; }
  const cols = ['id', 'recipient_email', 'recipient_customer_id', 'from_address', 'reply_to', 'subject', 'content_html',
    'provider_message_id', 'provider', 'status', 'delivered_at', 'first_opened_at', 'first_clicked_at', 'bounced_at',
    'bounce_reason', 'spam_reported_at', 'unsubscribed_at', 'created_at', 'metadata'];
  let written = 0;
  await paginate(src, 'id', args.batch, (last, lim) => ({
    text: `SELECT * FROM public.email_logs ${last == null ? '' : 'WHERE id > $1'} ORDER BY id LIMIT ${lim}`,
    values: last == null ? [] : [last],
  }), async (rows) => {
    const payload = rows.map((r) => [r.id, r.recipient_email,
      maps.email.get(lc(r.recipient_email)) ?? null,
      r.from_address, r.reply_to, r.subject, r.content_html, r.sendgrid_message_id, 'sendgrid', r.status,
      r.delivered_at, r.opened_at, r.first_clicked_at, r.bounced_at, r.bounce_reason, r.spam_reported_at,
      r.unsubscribed_at, r.created_at, JSON.stringify({ migrated_from: 'techtickets.email_logs', src_recipient_customer_id: r.recipient_customer_id ?? null })]);
    written += await insertBatch(dst, 'email_send_log', cols, payload, 'ON CONFLICT (id) DO NOTHING');
  });
  console.log(`   inserted ${written} (of ${total})`);
  return { scanned: total, written };
}

// subscriptions: one target list per old topic
async function stageSubscriptions(src, dst, maps) {
  console.log('\n── list_subscriptions (email_subscriptions, per-topic lists) ──');
  const topics = (await src.query(
    `SELECT s.list_id, coalesce(l.label, s.list_id) label FROM public.email_subscriptions s
       LEFT JOIN public.email_topic_labels l ON l.list_id=s.list_id GROUP BY 1,2`)).rows;
  const total = (await src.query(`SELECT count(*)::int n FROM public.email_subscriptions`)).rows[0].n;
  console.log(`   ${topics.length} topics, ${total} subscription rows`);
  if (!args.commit) { console.log('   DRY-RUN'); return { scanned: total, written: 0 }; }
  // ensure a target list per topic
  const listId = new Map();
  for (const t of topics) {
    const slug = 'tt-' + String(t.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || ('topic-' + t.list_id);
    const r = await dst.query(
      `INSERT INTO public.lists (slug, name, is_active, is_public, metadata)
       VALUES ($1,$2,true,true,$3) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      [slug, t.label, JSON.stringify({ migrated_from_topic: t.list_id })]);
    listId.set(t.list_id, r.rows[0].id);
  }
  const cols = ['list_id', 'person_id', 'email', 'subscribed', 'subscribed_at', 'unsubscribed_at', 'source', 'metadata'];
  let written = 0;
  await paginate(src, 'id', args.batch, (last, lim) => ({
    text: `SELECT id, email, list_id, subscribed, subscribed_at, unsubscribed_at FROM public.email_subscriptions
           ${last == null ? '' : 'WHERE id > $1'} ORDER BY id LIMIT ${lim}`,
    values: last == null ? [] : [last],
  }), async (rows) => {
    const payload = [];
    for (const r of rows) {
      const lid = listId.get(r.list_id); if (!lid || !r.email) continue;
      payload.push([lid, maps.email.get(lc(r.email)) ?? null, r.email, r.subscribed, r.subscribed_at, r.unsubscribed_at,
        'import', JSON.stringify({ migrated_from: 'techtickets.email_subscriptions' })]);
    }
    if (payload.length) written += await insertBatch(dst, 'list_subscriptions', cols, payload,
      `ON CONFLICT (list_id, email) DO UPDATE SET subscribed=EXCLUDED.subscribed,
       subscribed_at=COALESCE(public.list_subscriptions.subscribed_at,EXCLUDED.subscribed_at),
       person_id=COALESCE(EXCLUDED.person_id,public.list_subscriptions.person_id)`);
  });
  console.log(`   upserted ${written} (of ${total})`);
  return { scanned: total, written };
}

// people_events (customer_events; customer_activities only with --activities)
async function stagePeopleEvents(src, dst, maps, table, personKey) {
  console.log(`\n── people_events (${table}) ──`);
  const total = (await src.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n;
  console.log(`   source ${table} ${total}`);
  if (!args.commit) { console.log('   DRY-RUN'); return { scanned: total, written: 0 }; }
  const cols = ['person_id', 'email', 'event_name', 'event_data', 'source', 'occurred_at'];
  let written = 0, skipped = 0;
  await paginate(src, 'id', (table === 'customer_activities' ? 4000 : args.batch), (last, lim) => ({
    text: `SELECT id, ${personKey}, event_name, event_data, timestamp FROM public.${table}
           ${last == null ? '' : 'WHERE id > $1'} ORDER BY id LIMIT ${lim}`,
    values: last == null ? [] : [last],
  }), async (rows) => {
    const payload = [];
    for (const r of rows) {
      const pid = maps.cioId.get(String(r[personKey]));
      const em = maps.cioEmail.get(String(r[personKey]));
      if (!pid || !em) { skipped++; continue; }
      payload.push([pid, em, r.event_name, r.event_data == null ? null : JSON.stringify(r.event_data), 'migrated:' + table, r.timestamp]);
    }
    if (payload.length) written += await insertBatch(dst, 'people_events', cols, payload, '');
    if (written && written % 100000 === 0) console.log(`   …${written}`);
  });
  console.log(`   inserted ${written} (skipped ${skipped} no-person of ${total})`);
  return { scanned: total, written };
}

async function main() {
  const src = new pg.Client(conn('SRC')); const dst = new pg.Client(conn('DST'));
  await src.connect(); await dst.connect();
  await src.query('SET default_transaction_read_only = on');
  await dst.query("SET statement_timeout = '900s'");
  console.log(`===== techtickets migration [${args.commit ? 'COMMIT' : 'DRY-RUN'}] =====`);

  const authEmailToId = new Map();
  for (const r of (await dst.query(`SELECT id, lower(email) le FROM auth.users WHERE email IS NOT NULL`)).rows) authEmailToId.set(r.le, r.id);
  console.log(`auth.users (preserved) map: ${authEmailToId.size}`);

  const maps = { email: new Map(), custId: new Map(), cioId: new Map(), cioEmail: new Map() };
  const should = (s) => !args.only || args.only.includes(s);
  const report = {};
  if (should('people')) report.people = await stagePeople(src, dst, authEmailToId, maps);
  if (args.commit) await buildMaps(src, dst, maps); // ensure maps populated (also for --only re-runs)
  if (should('profiles')) report.profiles = await stageProfiles(src, dst, maps);
  if (should('events')) report.events = await stageIntersect(src, dst, 'events', 'ON CONFLICT (event_id) DO NOTHING',
    { exclude: ['account_id'], // old account_id points at un-migrated accounts (single-tenant) → NULL
      jsonb: ['source_details', 'luma_page_data', 'meetup_page_data', 'theme_colors', 'nearby_hotels', 'talk_duration_options'] }); // event_topics is text[] — pass raw
  if (should('emailEvents')) report.emailEvents = await stageIntersect(src, dst, 'email_events', 'ON CONFLICT (id) DO NOTHING',
    { jsonb: ['raw_payload'], batch: 4000 });
  if (should('sendLog')) report.sendLog = await stageSendLog(src, dst, maps);
  if (should('subscriptions')) report.subscriptions = await stageSubscriptions(src, dst, maps);
  if (should('customerEvents')) report.customerEvents = await stagePeopleEvents(src, dst, maps, 'customer_events', 'customer_cio_id');
  if (args.activities && should('activities')) report.activities = await stagePeopleEvents(src, dst, maps, 'customer_activities', 'customer_cio_id');

  console.log('\n================= RECONCILIATION =================');
  for (const [k, v] of Object.entries(report)) console.log(`  ${k.padEnd(16)} scanned=${v.scanned}  written=${v.written}`);
  console.log(args.commit ? '  (COMMIT)' : '  (DRY-RUN)');
  await src.end(); await dst.end();
}
main().catch((e) => { console.error('\nFATAL:', e); process.exit(1); });
