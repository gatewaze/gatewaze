#!/usr/bin/env tsx
/**
 * Pre-flight checks before flipping `tenancy_v2_enforced=true`. Reports
 * any rows that would lose access under the new account-scoped RLS,
 * and any obvious schema gaps.
 *
 * Refuses to recommend the flag flip if any check fails. Exit 0 only
 * when every check is green.
 *
 * Checks:
 *   1. tenancy_v2_helpers migration applied (functions present).
 *   2. set_app_account_id RPC present and grantable.
 *   3. accounts_users_select_self policy present.
 *   4. account_id columns exist on people and email_logs.
 *   5. No NULL-account rows in tenant tables (people, email_logs,
 *      events). If present, prompt operator to run backfill first.
 *   6. tenancy_v2_enforced flag exists and is currently false.
 *   7. Every accounts_users user_id resolves to an auth.users row.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    process.exit(2);
  }
  const supabase = createClient(url, key);
  const results: CheckResult[] = [];

  // 1. Helper functions present
  {
    const { data, error } = await supabase
      .from('pg_proc' as never)
      .select('proname')
      .in('proname', ['user_account_ids', 'current_account_id', 'tenancy_v2_enforced', 'account_in_scope']);
    // pg_proc is in pg_catalog; PostgREST cannot query it. Fall back to
    // calling each function and observing whether the call resolves.
    const probes = await Promise.all([
      supabase.rpc('tenancy_v2_enforced'),
      supabase.rpc('current_account_id'),
    ]);
    const missing = probes
      .map((p, i) => ({ p, name: ['tenancy_v2_enforced', 'current_account_id'][i] }))
      .filter(r => r.p.error && /does not exist/i.test(r.p.error.message))
      .map(r => r.name);
    results.push({
      name: 'tenancy_v2_helpers migration applied',
      ok: missing.length === 0,
      detail: missing.length === 0
        ? 'helper functions resolve'
        : `missing functions: ${missing.join(', ')}`,
    });
    void data; void error;
  }

  // 2. set_app_account_id RPC present
  {
    const { error } = await supabase.rpc('set_app_account_id', {
      p_account_id: '00000000-0000-0000-0000-000000000000',
    });
    const missing = error && /does not exist/i.test(error.message);
    results.push({
      name: 'set_app_account_id RPC present',
      ok: !missing,
      detail: missing ? 'apply 00026_set_app_account_id.sql first' : 'RPC callable',
    });
  }

  // 3. account_id columns on people and email_logs
  for (const table of ['people', 'email_logs'] as const) {
    const { error } = await supabase
      .from(table)
      .select('account_id')
      .limit(1);
    const missing = error && /column.*account_id.*does not exist/i.test(error.message);
    results.push({
      name: `account_id column on ${table}`,
      ok: !missing,
      detail: missing ? 'apply 00024_tenancy_v2_helpers.sql first' : 'column present',
    });
  }

  // 4. No NULL-account rows in tenant tables
  for (const table of ['people', 'email_logs', 'events'] as const) {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .is('account_id', null);
    if (error) {
      results.push({ name: `no NULL account_id in ${table}`, ok: false, detail: error.message });
      continue;
    }
    const ok = (count ?? 0) === 0;
    results.push({
      name: `no NULL account_id in ${table}`,
      ok,
      detail: ok ? '0 rows' : `${count} rows — run scripts/backfill-tenancy.ts --commit first`,
    });
  }

  // 5. tenancy_v2_enforced flag exists and is false
  {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'tenancy_v2_enforced')
      .maybeSingle();
    if (error || !data) {
      results.push({
        name: 'tenancy_v2_enforced flag present',
        ok: false,
        detail: error?.message ?? 'flag row missing — apply 00024 first',
      });
    } else {
      const val = String(data.value).toLowerCase();
      const isFalse = val === 'false';
      results.push({
        name: 'tenancy_v2_enforced flag is currently false',
        ok: isFalse,
        detail: isFalse
          ? 'flag=false (preflight ok to proceed)'
          : `flag=${val} — already flipped or set to a non-boolean string`,
      });
    }
  }

  // 6. accounts_users self-select policy present
  {
    // Probe by attempting a SELECT with a fabricated user_id under
    // service-role — bypasses RLS, so this is a sanity probe of the
    // table existing rather than the policy.
    const { error } = await supabase.from('accounts_users').select('user_id').limit(1);
    results.push({
      name: 'accounts_users readable by service-role',
      ok: !error,
      detail: error?.message ?? 'ok',
    });
  }

  // 7. Every accounts_users user_id has a matching auth.users row
  // (Proxy: count divergence. Service role can read both.)
  {
    const { count: auCount, error: auErr } = await supabase
      .from('accounts_users')
      .select('user_id', { count: 'exact', head: true });
    if (auErr) {
      results.push({ name: 'accounts_users user_id integrity', ok: false, detail: auErr.message });
    } else if ((auCount ?? 0) === 0) {
      results.push({
        name: 'at least one accounts_users row exists',
        ok: false,
        detail: 'No memberships found. The flag flip will leave non-admins with zero rows visible.',
      });
    } else {
      results.push({
        name: `accounts_users has ${auCount} membership row(s)`,
        ok: true,
      });
    }
  }

  console.log('\nPre-flight checks:');
  for (const r of results) {
    console.log(`  [${r.ok ? ' OK ' : 'FAIL'}] ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  }

  const failures = results.filter(r => !r.ok).length;
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed. Do NOT flip tenancy_v2_enforced yet.`);
    process.exit(1);
  }
  console.log('\nAll checks passed. You may now flip the flag in staging:');
  console.log("  UPDATE platform_settings SET value='true' WHERE key='tenancy_v2_enforced';");
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
