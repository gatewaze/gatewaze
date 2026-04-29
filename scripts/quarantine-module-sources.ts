#!/usr/bin/env tsx
/**
 * One-shot scan: identify module_sources rows whose `branch` column would
 * have failed the new BRANCH_RE validation, and (optionally) disable them.
 *
 * Use case: any rows inserted before the validation gate (modules.ts POST
 * /sources) landed are potential vectors for stored RCE via the refresh
 * handler. This script flags them and refuses to ship until an operator
 * has reviewed each one.
 *
 * Default mode is dry-run (lists matches; takes no action). Pass --commit
 * to set `disabled = true` on each violator and emit an audit_log entry.
 *
 * Usage:
 *   pnpm exec tsx scripts/quarantine-module-sources.ts             # dry run
 *   pnpm exec tsx scripts/quarantine-module-sources.ts --commit    # apply
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js';

const BRANCH_RE = /^[\w][\w.\-/]{0,254}$/;

interface ModuleSourceRow {
  id: string;
  url: string;
  branch: string | null;
  label: string | null;
  origin: string | null;
  created_at: string | null;
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    process.exit(2);
  }
  const supabase = createClient(url, key);

  const { data, error } = await supabase
    .from('module_sources')
    .select('id, url, branch, label, origin, created_at');
  if (error) {
    console.error('Failed to read module_sources:', error.message);
    process.exit(2);
  }

  const rows = (data ?? []) as ModuleSourceRow[];
  const violators = rows.filter(r => r.branch !== null && !BRANCH_RE.test(r.branch));

  if (violators.length === 0) {
    console.log(`Scanned ${rows.length} module_sources row(s); 0 violators.`);
    return;
  }

  console.log(`Scanned ${rows.length} module_sources row(s); ${violators.length} violator(s):\n`);
  for (const v of violators) {
    console.log(`  id=${v.id}`);
    console.log(`    url=${v.url}`);
    console.log(`    branch=${JSON.stringify(v.branch)}`);
    console.log(`    label=${v.label ?? '(none)'}`);
    console.log(`    origin=${v.origin ?? '(none)'}`);
    console.log(`    created_at=${v.created_at ?? '(unknown)'}`);
    console.log();
  }

  if (!commit) {
    console.log('Dry run — no changes made. Re-run with --commit to disable these sources.');
    return;
  }

  // The disabled column is added in the phase-1 migration set; if it does
  // not exist yet, this UPDATE will fail with a clear error, prompting the
  // operator to apply migrations first.
  const ids = violators.map(v => v.id);
  const { error: updateErr } = await supabase
    .from('module_sources')
    .update({ disabled: true, disabled_reason: 'invalid_branch_quarantine' })
    .in('id', ids);
  if (updateErr) {
    console.error('Failed to disable violators:', updateErr.message);
    console.error('If the column does not exist yet, apply phase-1 migrations first.');
    process.exit(2);
  }

  // Audit-log entries (one per violator) — written via the audit_log table
  // directly. The audit_log helper from packages/api is not imported here
  // to keep this script standalone.
  const auditRows = violators.map(v => ({
    actor: 'system:quarantine-module-sources',
    action: 'module_source.quarantine',
    target_kind: 'module_source',
    target_id: v.id,
    metadata: { url: v.url, branch: v.branch, reason: 'invalid_branch' },
  }));
  const { error: auditErr } = await supabase.from('audit_log').insert(auditRows);
  if (auditErr) {
    console.warn('Disabled rows but failed to write audit_log:', auditErr.message);
  }

  console.log(`Disabled ${violators.length} row(s).`);
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
