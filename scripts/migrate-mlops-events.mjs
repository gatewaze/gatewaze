#!/usr/bin/env node
/**
 * Migrate historic mlops events (that have registrants or attendees) + their
 * registrations and attendance into the aaif brand.
 *
 * Source (READ-ONLY): mlops prod
 * Target:             aaif prod (or local)
 *
 * Scope: only events with >=1 registration or attendance row. Obvious test
 * events (event_id 'test01') are excluded.
 *
 * Stages:
 *   A. events      — CREATE only the events NOT already in aaif (matched by
 *                    luma_event_id). Imported with publish_state='pending_review'
 *                    (NOT auto-published) and their screenshot/logo image fields.
 *                    Existing events are left untouched (event row skipped).
 *   B. registrations — event_registrations -> events_registrations for ALL active
 *                    events (new + existing). event_id resolved to the aaif event
 *                    uuid (via luma or the just-created row); person_id resolved
 *                    from member_profile_id -> customer email -> aaif person.
 *                    ON CONFLICT (event_id, person_id) DO NOTHING.
 *   C. attendance  — event_attendance -> events_attendance, deduped in-code on
 *                    (event_id, person_id) since the table has no unique key.
 *
 * Person mapping: a registrant whose email is not an aaif person is SKIPPED with
 * a warning (run the people migration for the missing emails first).
 *
 * Enum mapping (into aaif CHECK constraints):
 *   status: confirmed|cancelled|pending pass through (else confirmed)
 *   registration_type: free|paid|sponsor_staff|speaker pass; individual->free; else null
 *   payment_status: comp->waived; paid->paid; else null
 *   check_in_method: qr_scan|manual_entry|badge_scan|mobile_app|sponsor_booth|gradual pass; else null
 *
 * Dry-run by DEFAULT. Pass --commit to write.
 *
 * Env: SRC_DB_* (mlops), DST_DB_* (aaif). SSL via *_DB_SSL.
 * Flags: --commit  --batch N (default 2000)
 */
import { createRequire } from 'module';
const require = createRequire(new URL('../packages/api/package.json', import.meta.url));
const pg = require('pg');

const args = { commit: false, batch: 2000 };
for (let i = 0; i < process.argv.length - 2; i++) {
  const t = process.argv[i + 2];
  if (t === '--commit') args.commit = true;
  else if (t === '--batch') args.batch = Number(process.argv[++i + 2]);
}
const sslFor = (m) => (m === 'require' || m === 'true' ? { rejectUnauthorized: false } : false);
const conn = (p) => ({ host: process.env[`${p}_DB_HOST`], port: +(process.env[`${p}_DB_PORT`] || 5432), user: process.env[`${p}_DB_USER`], password: process.env[`${p}_DB_PASSWORD`], database: process.env[`${p}_DB_NAME`] || 'postgres', ssl: sslFor(process.env[`${p}_DB_SSL`]) });
const lc = (x) => (x == null ? x : String(x).trim().toLowerCase());

const REG_STATUS = new Set(['pending', 'confirmed', 'cancelled', 'attended', 'no_show', 'waitlisted']);
const REG_TYPE = new Set(['free', 'paid', 'comp', 'sponsor', 'sponsor_staff', 'speaker', 'staff', 'vip']);
const PAY_STATUS = new Set(['pending', 'paid', 'refunded', 'waived']);
const CHECKIN = new Set(['qr_scan', 'manual_entry', 'badge_scan', 'mobile_app', 'sponsor_booth', 'gradual']);
const mapStatus = (v) => (REG_STATUS.has(v) ? v : 'confirmed');
const mapType = (v) => (v === 'individual' ? 'free' : REG_TYPE.has(v) ? v : null);
const mapPay = (v) => (v === 'comp' ? 'waived' : PAY_STATUS.has(v) ? v : null);
const mapCheckin = (v) => (CHECKIN.has(v) ? v : null);

async function insertBatch(dst, table, cols, rows, conflict) {
  if (!rows.length) return 0;
  const ph = rows.map((_, r) => `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(',')})`).join(',');
  const res = await dst.query(`INSERT INTO public.${table} (${cols.join(',')}) VALUES ${ph} ${conflict || ''}`, rows.flat());
  return res.rowCount;
}

async function main() {
  const src = new pg.Client(conn('SRC'));
  const dst = new pg.Client(conn('DST'));
  await src.connect(); await dst.connect();
  await src.query('SET default_transaction_read_only = on');
  await dst.query("SET statement_timeout = '600s'");
  console.log(`=== mlops events -> aaif   [${args.commit ? 'COMMIT' : 'DRY-RUN'}] ===`);

  // ---- active events (>=1 reg or att), excluding test events ----
  const active = (await src.query(`
    SELECT e.* FROM public.events e
    WHERE e.event_id <> 'test01'
      AND (EXISTS (SELECT 1 FROM public.event_registrations r WHERE r.event_id=e.event_id)
        OR EXISTS (SELECT 1 FROM public.event_attendance a WHERE a.event_id=e.event_id))`)).rows;
  console.log(`active events (excl test01): ${active.length}`);

  // ---- aaif existing events by luma ----
  const aaifByLuma = new Map();
  for (const r of (await dst.query(`SELECT id, lower(luma_event_id) luma FROM public.events WHERE luma_event_id IS NOT NULL`)).rows) aaifByLuma.set(r.luma, r.id);

  // ---- member_profile_id -> {email, name}; email -> aaif person_id ----
  const mpMap = new Map(); // member_profile_id -> {email, name}
  for (const r of (await src.query(`
    SELECT mp.id, lower(c.email) email,
      COALESCE(NULLIF(c.attributes->>'full_name',''), NULLIF(TRIM(CONCAT(c.attributes->>'first_name',' ',c.attributes->>'last_name')),''), '') name
    FROM public.member_profiles mp JOIN public.customers c ON c.id=mp.customer_id
    WHERE c.email IS NOT NULL AND c.email<>''`)).rows) mpMap.set(r.id, { email: r.email, name: r.name });
  const personByEmail = new Map();
  { // only resolve the registrant emails (not all people) — scoped + fast
    const wanted = [...new Set([...mpMap.values()].map((v) => v.email))];
    for (let i = 0; i < wanted.length; i += 5000) {
      const b = wanted.slice(i, i + 5000);
      const r = await dst.query(`SELECT id, lower(email) e FROM public.people WHERE lower(email)=ANY($1)`, [b]);
      for (const x of r.rows) personByEmail.set(x.e, x.id);
    } }
  const personForMp = (mpId) => { const m = mpMap.get(mpId); return m ? personByEmail.get(m.email) ?? null : null; };

  // ---- target columns for events (intersection minus deny-list) ----
  const tEventCols = new Set((await dst.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='events'`)).rows.map((r) => r.column_name));
  const sEventCols = new Set(Object.keys(active[0] || {}));
  const DENY = new Set(['id', 'is_live_in_production', 'publish_state', 'account_id', 'account', 'account_id_text', 'status', 'created_at', 'updated_at',
    'luma_processing_status']); // CHECK-constrained; mlops values may differ — let it default to null
  // Exclude ALL foreign-key columns (recommended_event_id, series_id, theme_id,
  // event_type_id, account_id): their mlops values reference rows that don't
  // exist in aaif and would trip FK constraints. The event content is preserved;
  // only the relational links are dropped.
  for (const r of (await dst.query(`SELECT a.attname col FROM pg_constraint con JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=ANY(con.conkey) WHERE con.conrelid='public.events'::regclass AND con.contype='f'`)).rows) DENY.add(r.col);
  const eventCarry = [...tEventCols].filter((c) => sEventCols.has(c) && !DENY.has(c));
  // jsonb columns must be serialized (node-pg stringifies plain objects to
  // "[object Object]" otherwise). Detect them from the TARGET schema so we never
  // miss one. Array columns (text[]) are passed through as JS arrays.
  const jsonbEventCols = new Set((await dst.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='events' AND data_type IN ('jsonb','json')`)).rows.map((r) => r.column_name));
  const ser = (c, v) => (jsonbEventCols.has(c) && v != null && typeof v !== 'string' ? JSON.stringify(v) : v);

  // ================= Stage A: create NEW events =================
  const eventUuid = new Map(); // mlops event_id -> aaif event uuid
  let newEvents = 0;
  const toCreate = [];
  for (const e of active) {
    const existing = e.luma_event_id && aaifByLuma.get(lc(e.luma_event_id));
    if (existing) { eventUuid.set(e.event_id, existing); continue; }
    toCreate.push(e);
  }
  console.log(`\n-- Stage A: events -- new to create: ${toCreate.length}, existing (skip row): ${active.length - toCreate.length}`);
  if (args.commit) {
    for (const e of toCreate) {
      const cols = [...eventCarry, 'publish_state'];
      const vals = [...eventCarry.map((c) => ser(c, e[c])), 'pending_review'];
      const ph = cols.map((_, i) => `$${i + 1}`).join(',');
      const r = await dst.query(`INSERT INTO public.events (${cols.join(',')}) VALUES (${ph}) ON CONFLICT (event_id) DO NOTHING RETURNING id`, vals);
      let id = r.rows[0]?.id;
      if (!id) { const g = await dst.query(`SELECT id FROM public.events WHERE event_id=$1`, [e.event_id]); id = g.rows[0]?.id; }
      if (id) { eventUuid.set(e.event_id, id); newEvents++; }
    }
    console.log(`   created ${newEvents} events (publish_state=pending_review, images included)`);
  } else {
    for (const e of toCreate) eventUuid.set(e.event_id, `<new:${e.event_id}>`);
  }

  const activeIds = active.map((e) => e.event_id);

  // ================= Stage B: registrations =================
  console.log(`\n-- Stage B: registrations --`);
  const regCols = ['event_id', 'person_id', 'status', 'registered_at', 'registration_type', 'ticket_type', 'payment_status', 'amount_paid', 'currency', 'registration_source', 'registration_metadata', 'cancelled_at', 'is_primary_contact', 'created_at'];
  let regScanned = 0, regReady = 0, regNoPerson = 0, regNoEvent = 0, regWritten = 0;
  const seenReg = new Set();
  let batch = [];
  const flushReg = async () => { if (args.commit && batch.length) regWritten += await insertBatch(dst, 'events_registrations', regCols, batch, 'ON CONFLICT (event_id, person_id) DO NOTHING'); batch = []; };
  for (const evId of activeIds) {
    const rows = (await src.query(`SELECT * FROM public.event_registrations WHERE event_id=$1`, [evId])).rows;
    const aaifEv = eventUuid.get(evId);
    for (const r of rows) {
      regScanned++;
      const pid = personForMp(r.member_profile_id);
      if (!pid) { regNoPerson++; continue; }
      if (!aaifEv || String(aaifEv).startsWith('<new:')) { if (!args.commit && String(aaifEv).startsWith('<new:')) { /* dry-run new event */ } else if (!aaifEv) { regNoEvent++; continue; } }
      const key = `${aaifEv}|${pid}`;
      if (seenReg.has(key)) continue; // collapse dup (event,person)
      seenReg.add(key);
      regReady++;
      if (!args.commit) continue;
      const meta = JSON.stringify({ migrated_from: 'mlops.event_registrations', original: { status: r.status, registration_type: r.registration_type, payment_status: r.payment_status, registration_source: r.registration_source }, ...(r.registration_metadata && typeof r.registration_metadata === 'object' ? r.registration_metadata : {}) });
      batch.push([aaifEv, pid, mapStatus(r.status), r.registered_at || r.created_at || new Date().toISOString(), mapType(r.registration_type), r.ticket_type, mapPay(r.payment_status), r.amount_paid, r.currency, r.registration_source, meta, r.cancelled_at, r.is_primary_contact ?? false, r.created_at || new Date().toISOString()]);
      if (batch.length >= args.batch) await flushReg();
    }
  }
  await flushReg();
  console.log(`   scanned ${regScanned} | ready ${regReady} | skipped no-person ${regNoPerson}, no-event ${regNoEvent}${args.commit ? ` | inserted ${regWritten}` : ''}`);

  // ================= Stage C: attendance =================
  console.log(`\n-- Stage C: attendance --`);
  // existing (event,person) attendance in aaif to dedup (no unique constraint)
  const seenAtt = new Set();
  if (args.commit) for (const r of (await dst.query(`SELECT event_id, person_id FROM public.events_attendance`)).rows) seenAtt.add(`${r.event_id}|${r.person_id}`);
  const attCols = ['event_id', 'person_id', 'checked_in_at', 'check_in_method', 'sessions_attended', 'attendance_metadata', 'full_name', 'created_at'];
  let attScanned = 0, attReady = 0, attNoPerson = 0, attWritten = 0;
  let ab = [];
  const flushAtt = async () => { if (args.commit && ab.length) attWritten += await insertBatch(dst, 'events_attendance', attCols, ab, ''); ab = []; };
  for (const evId of activeIds) {
    const rows = (await src.query(`SELECT * FROM public.event_attendance WHERE event_id=$1`, [evId])).rows;
    const aaifEv = eventUuid.get(evId);
    for (const a of rows) {
      attScanned++;
      const pid = personForMp(a.member_profile_id);
      if (!pid || !aaifEv || String(aaifEv).startsWith('<new:')) { if (!pid) attNoPerson++; if (!args.commit && String(aaifEv).startsWith('<new:')) { attReady++; } continue; }
      const key = `${aaifEv}|${pid}`;
      if (seenAtt.has(key)) continue;
      seenAtt.add(key);
      attReady++;
      if (!args.commit) continue;
      const meta = JSON.stringify({ migrated_from: 'mlops.event_attendance', ...(a.attendance_metadata && typeof a.attendance_metadata === 'object' ? a.attendance_metadata : {}) });
      ab.push([aaifEv, pid, a.checked_in_at || a.created_at || new Date().toISOString(), mapCheckin(a.check_in_method), a.sessions_attended ?? null, meta, mpMap.get(a.member_profile_id)?.name || null, a.created_at || new Date().toISOString()]);
      if (ab.length >= args.batch) await flushAtt();
    }
  }
  await flushAtt();
  console.log(`   scanned ${attScanned} | ready ${attReady} | skipped no-person ${attNoPerson}${args.commit ? ` | inserted ${attWritten}` : ''}`);

  console.log(`\n=== ${args.commit ? 'COMMIT complete' : 'DRY-RUN (no writes)'} ===`);
  await src.end(); await dst.end();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
