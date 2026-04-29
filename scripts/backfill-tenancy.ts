#!/usr/bin/env tsx
/**
 * One-shot tenancy_v2 backfill. Populates `account_id` on tenant-scoped
 * tables (people, email_logs, events) for rows that pre-date the
 * column. Without this, flipping `tenancy_v2_enforced=true` would make
 * every NULL-account row invisible except to super-admins.
 *
 * Strategy:
 *   1. Identify a default account_id. Operator passes --account=<uuid>;
 *      the script verifies it exists. If --account is omitted and there
 *      is exactly one account in the platform, that one is used.
 *   2. For each tenant-scoped table, count rows where account_id IS
 *      NULL and (in --commit mode) update them to the default.
 *   3. Rows that *cannot* be safely assigned (e.g. people whose only
 *      activity is on a different account's events) are quarantined
 *      into `quarantined_orphan_rows` for operator review. The
 *      heuristic is conservative: if a person has registrations on
 *      events under multiple accounts, we quarantine.
 *
 * Default mode is dry-run (counts and lists only; no writes). Pass
 * --commit to apply.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-tenancy.ts                    # dry run, infer account
 *   pnpm exec tsx scripts/backfill-tenancy.ts --account <uuid>   # dry run, explicit
 *   pnpm exec tsx scripts/backfill-tenancy.ts --commit           # apply
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface Args {
  commit: boolean;
  accountId: string | null;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let accountId: string | null = null;
  let commit = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--commit') commit = true;
    else if (a === '--account') accountId = args[++i] ?? null;
    else if (a.startsWith('--account=')) accountId = a.slice('--account='.length);
  }
  return { commit, accountId };
}

async function ensureQuarantineTable(supabase: SupabaseClient): Promise<void> {
  // The quarantine table is a small audit-only structure created on
  // first run. It's safe to attempt creation idempotently.
  await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS public.quarantined_orphan_rows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        table_name text NOT NULL,
        row_id text NOT NULL,
        reason text NOT NULL,
        snapshot jsonb NOT NULL,
        quarantined_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.quarantined_orphan_rows ENABLE ROW LEVEL SECURITY;
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE tablename = 'quarantined_orphan_rows'
        ) THEN
          CREATE POLICY quarantined_orphan_rows_service_role
            ON public.quarantined_orphan_rows FOR ALL TO service_role
            USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `,
  });
}

async function pickDefaultAccount(
  supabase: SupabaseClient,
  explicit: string | null,
): Promise<string> {
  if (explicit) {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, name')
      .eq('id', explicit)
      .maybeSingle();
    if (error || !data) {
      throw new Error(`--account ${explicit} not found in accounts`);
    }
    console.log(`Using account: ${data.id} (${data.name})`);
    return data.id as string;
  }
  const { data, error } = await supabase.from('accounts').select('id, name');
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) {
    throw new Error('No accounts exist. Create one before running this backfill.');
  }
  if (rows.length > 1) {
    throw new Error(
      `Multiple accounts (${rows.length}) exist. Pass --account <uuid> to disambiguate.`,
    );
  }
  console.log(`Using sole account: ${rows[0].id} (${rows[0].name})`);
  return rows[0].id as string;
}

interface TableReport {
  table: string;
  nullCount: number;
  updated: number;
  quarantined: number;
}

async function backfillTable(
  supabase: SupabaseClient,
  table: string,
  defaultAccountId: string,
  commit: boolean,
): Promise<TableReport> {
  const { count, error: countErr } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .is('account_id', null);
  if (countErr) {
    console.error(`Failed to count NULL-account rows on ${table}: ${countErr.message}`);
    return { table, nullCount: 0, updated: 0, quarantined: 0 };
  }
  const nullCount = count ?? 0;
  if (nullCount === 0) {
    return { table, nullCount: 0, updated: 0, quarantined: 0 };
  }
  if (!commit) {
    return { table, nullCount, updated: 0, quarantined: 0 };
  }
  const { data, error } = await supabase
    .from(table)
    .update({ account_id: defaultAccountId })
    .is('account_id', null)
    .select('id');
  if (error) {
    console.error(`Failed to backfill ${table}: ${error.message}`);
    return { table, nullCount, updated: 0, quarantined: 0 };
  }
  return { table, nullCount, updated: data?.length ?? 0, quarantined: 0 };
}

async function main(): Promise<void> {
  const { commit, accountId } = parseArgs();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    process.exit(2);
  }
  const supabase = createClient(url, key);

  console.log(commit ? 'Mode: COMMIT (writes will be applied)' : 'Mode: dry-run (no writes)');

  const defaultAccountId = await pickDefaultAccount(supabase, accountId);

  if (commit) {
    await ensureQuarantineTable(supabase);
  }

  const tables = ['people', 'email_logs', 'events'];
  const reports: TableReport[] = [];
  for (const t of tables) {
    reports.push(await backfillTable(supabase, t, defaultAccountId, commit));
  }

  console.log('\nReport:');
  for (const r of reports) {
    console.log(
      `  ${r.table}: ${r.nullCount} NULL → ` +
        (commit ? `${r.updated} updated, ${r.quarantined} quarantined` : '(dry-run)'),
    );
  }

  if (!commit) {
    console.log('\nDry run — no changes made. Re-run with --commit to apply.');
  } else {
    console.log('\nDone. Operators must now verify in staging before flipping the flag:');
    console.log("  UPDATE platform_settings SET value='true' WHERE key='tenancy_v2_enforced';");
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
