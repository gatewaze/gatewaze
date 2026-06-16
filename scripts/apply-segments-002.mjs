// One-off surgical apply of the segments module's 002 migration.
// Mirrors packages/shared/src/modules/migrations.ts (exec_sql + record),
// WITHOUT the full reconcile that pnpm modules:migrate performs.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

const ENV = '/Users/dan/Git/danthebaker/gatewaze-environments/aaif.local.env';
const MIGRATION =
  '/Users/dan/Git/gatewaze/gatewaze-modules/modules/segments/migrations/002_segments_functions.sql';
const MODULE_ID = 'segments';
const FILENAME = 'migrations/002_segments_functions.sql';

function envVal(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}

const envText = readFileSync(ENV, 'utf-8');
const serviceKey = envVal(envText, 'SERVICE_ROLE_KEY');
if (!serviceKey) {
  console.error('SERVICE_ROLE_KEY not found in env file');
  process.exit(1);
}
// Talk to Kong directly to avoid hostname resolution surprises.
const url = 'http://localhost:54331';

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

const sql = readFileSync(MIGRATION, 'utf-8');
const checksum = createHash('sha256').update(sql).digest('hex');

const { data: applied, error: qErr } = await supabase
  .from('module_migrations')
  .select('filename,checksum')
  .eq('module_id', MODULE_ID);

if (qErr) {
  console.error('Failed to query module_migrations:', qErr);
  process.exit(1);
}

const existing = (applied ?? []).find((r) => r.filename === FILENAME);
if (existing) {
  if (existing.checksum === checksum) {
    console.log('Already applied with matching checksum — nothing to do.');
    process.exit(0);
  }
  console.log('Re-applying (idempotent CREATE OR REPLACE); checksum changed.');
}

console.log('Applying', FILENAME, '...');
const { error: rpcErr } = await supabase.rpc('exec_sql', { sql_text: sql });
if (rpcErr) {
  console.error('exec_sql failed:', JSON.stringify(rpcErr, null, 2));
  process.exit(1);
}
console.log('SQL applied.');

if (existing) {
  const { error: updErr } = await supabase
    .from('module_migrations')
    .update({ checksum })
    .eq('module_id', MODULE_ID)
    .eq('filename', FILENAME);
  if (updErr) console.warn('Could not update checksum:', updErr);
  else console.log('Checksum updated in module_migrations.');
} else {
  const { error: insErr } = await supabase
    .from('module_migrations')
    .insert({ module_id: MODULE_ID, filename: FILENAME, checksum });
  if (insErr) console.warn('Could not record migration:', insErr);
  else console.log('Recorded in module_migrations.');
}

console.log('Done.');
