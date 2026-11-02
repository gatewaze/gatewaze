#!/usr/bin/env tsx
/**
 * Apply pending migrations for ONE module, and nothing else.
 *
 * `pnpm modules:migrate` reconciles the whole module state, which does more
 * than migrate: it can disable modules that are not in the current config.
 * That is the right behaviour for a full deploy and the wrong behaviour when
 * all you need is a table added, especially on a shared environment where
 * another brand's modules are installed too.
 *
 * This calls `applyModuleMigrations` for a single module. Already-applied
 * files are skipped by checksum, so re-running is safe.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm exec tsx scripts/modules/migrate-one.ts health-body-metrics
 *
 * Add --dry-run to list what WOULD apply without touching the database.
 */

import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
import config from '../../gatewaze.config';
import dotenv from 'dotenv';
import path from 'path';

const require = createRequire(import.meta.url);
const modulesLib = require('@gatewaze/shared/modules') as {
  loadModules: typeof import('@gatewaze/shared/modules').loadModules;
  applyModuleMigrations: typeof import('@gatewaze/shared/modules').applyModuleMigrations;
};
const { loadModules, applyModuleMigrations } = modulesLib;

const PROJECT_ROOT = path.resolve(import.meta.dirname ?? __dirname, '../..');
dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env.local') });

const moduleId = process.argv.find((a) => !a.startsWith('-') && !a.endsWith('.ts') && !a.includes('node'));
const dryRun = process.argv.includes('--dry-run');

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!moduleId) {
  console.error('Usage: tsx scripts/modules/migrate-one.ts <moduleId> [--dry-run]');
  process.exit(1);
}
// Only a real run needs credentials. A dry run lists what is declared, and
// demanding a service-role key to do that would discourage the safe step.
if (!dryRun && (!supabaseUrl || !supabaseKey)) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

/**
 * `loadModules` reads only `config.moduleSources`. It does NOT consult
 * MODULE_SOURCES, unlike the DB-aware loader the running app uses, so a
 * module mounted from a local path was invisible here however the env var
 * was set. Merging it in is what makes this script usable for a module that
 * lives outside the configured git source, which is the whole reason to
 * migrate one module by hand.
 */
function withEnvSources(cfg: typeof config) {
  const raw = process.env.MODULE_SOURCES;
  if (!raw) return cfg;
  const envSources = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, fragment] = entry.split('#');
      if (!fragment) return { url };
      const params = new URLSearchParams(fragment);
      return {
        url,
        path: params.get('path') ?? undefined,
        branch: params.get('branch') ?? undefined,
        label: params.get('label') ?? undefined,
      };
    });
  return { ...cfg, moduleSources: [...(cfg.moduleSources ?? []), ...envSources] };
}

async function main() {
  const modules = await loadModules(withEnvSources(config), PROJECT_ROOT);
  const mod = modules.find((m) => m.config.id === moduleId);
  if (!mod) {
    console.error(
      `[migrate-one] No module '${moduleId}'. Loaded: ${modules.map((m) => m.config.id).join(', ')}`
    );
    process.exit(1);
  }

  const declared = mod.config.migrations ?? [];
  console.log(`[migrate-one] ${moduleId}: ${declared.length} migration(s) declared`);
  for (const f of declared) console.log(`  - ${f}`);

  if (dryRun) {
    // Deliberately does not open a transaction and roll back: that would run
    // the SQL, and a migration with side effects outside the transaction
    // would still have happened. Listing what is declared is the honest
    // dry run for a caller who wants to see the set first.
    console.log('[migrate-one] --dry-run: nothing applied.');
    return;
  }

  const supabase = createClient(supabaseUrl!, supabaseKey!);
  const result = await applyModuleMigrations(mod, supabase as never);

  for (const f of result.skipped) console.log(`  skipped (already applied) ${f}`);
  for (const f of result.applied) console.log(`  APPLIED ${f}`);
  if (result.failed) {
    console.error(`[migrate-one] FAILED on ${result.failed.filename}: ${result.failed.message}`);
    process.exit(1);
  }
  console.log(`[migrate-one] done: ${result.applied.length} applied, ${result.skipped.length} skipped.`);
}

main().catch((err) => {
  console.error('[migrate-one] failed:', err);
  process.exit(1);
});
