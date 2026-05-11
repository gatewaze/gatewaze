#!/usr/bin/env tsx
/**
 * Deploy Supabase Edge Functions from installed modules.
 *
 * For each module with edgeFunctions defined, copies function directories
 * from the module package into supabase/functions/ and optionally deploys them.
 *
 * Usage:
 *   pnpm modules:deploy-functions          # Copy only
 *   pnpm modules:deploy-functions --deploy # Copy and deploy via supabase CLI
 *
 * Local module development:
 *   The default config (gatewaze.config.ts) points moduleSources at the
 *   upstream git URL `gatewaze/gatewaze-modules`. The script clones that
 *   to `.gatewaze-modules/<slug>/` and copies functions from the clone.
 *   Local edits in a sibling working tree (e.g.
 *   `../gatewaze-modules/modules/...`) are NOT picked up by default —
 *   they get silently shadowed by the cached clone, which is what bit
 *   us when newsletter-send was missing the Weather substitution.
 *
 *   To make the script honour your local working tree, add this line
 *   to `.env.local` (gitignored — won't leak into production):
 *
 *     MODULE_SOURCES=../gatewaze-modules/modules
 *
 *   This script parses MODULE_SOURCES and PREPENDS those entries to
 *   `config.moduleSources` before calling `loadModules`. Loader.ts
 *   resolves modules first-match-wins across source dirs, so the env
 *   entries shadow the git URL. Note: `loadModules` itself does NOT
 *   read MODULE_SOURCES (only the DB-aware `loadModulesWithDbSources`
 *   does), which is why we merge here at the script level.
 */

// Load .env.local early so MODULE_SOURCES (and any other env override)
// is in process.env before loadModules runs. parseEnvModuleSources reads
// process.env.MODULE_SOURCES at call time, so this MUST happen before
// any @gatewaze/shared/modules import that triggers loading.
import dotenv from 'dotenv';
import { resolve } from 'path';
const PROJECT_ROOT = resolve(import.meta.dirname ?? __dirname, '../..');
dotenv.config({ path: resolve(PROJECT_ROOT, '.env.local') });

// @gatewaze/shared compiles to CJS while this script runs as ESM via tsx.
// Named ESM imports from the CJS module are fragile: Node's
// cjs-module-lexer detects only a subset of the long top-level
// `exports.X = exports.Y = ...` assignment chain, so some named imports
// silently resolve to undefined (commit 73865db: `loadModules` worked
// but `deployEdgeFunctions` threw "does not provide an export named").
// createRequire is the Node-blessed escape hatch — it loads the CJS
// module the way CJS loads it, exposing every export reliably.
import { createRequire } from 'node:module';
import config from '../../gatewaze.config';

const require = createRequire(import.meta.url);
const sharedModules = require('@gatewaze/shared/modules') as typeof import('@gatewaze/shared/modules');
const { loadModules, deployEdgeFunctions } = sharedModules;

const shouldDeploy = process.argv.includes('--deploy');

/**
 * Parse MODULE_SOURCES env var the same way loader.ts does. Duplicated
 * here because the shared parser isn't exported and we need to merge
 * env entries into the config before calling `loadModules` (which
 * itself reads neither MODULE_SOURCES nor .env.local).
 */
function parseEnvSources(): Array<{ url: string; path?: string; branch?: string; label?: string }> {
  const raw = process.env.MODULE_SOURCES;
  if (!raw) return [];
  return raw
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
}

async function main() {
  const envSources = parseEnvSources();
  // Prepend env sources so they win first-match resolution in loader.ts.
  const effectiveConfig = envSources.length > 0
    ? { ...config, moduleSources: [...envSources, ...(config.moduleSources ?? [])] }
    : config;
  if (envSources.length > 0) {
    console.log(`[modules] MODULE_SOURCES override: ${envSources.map((s) => s.url).join(', ')} (shadows config moduleSources)`);
  }
  const modules = await loadModules(effectiveConfig, PROJECT_ROOT);

  const modulesWithFunctions = modules.filter(
    (m) => m.config.edgeFunctions && m.config.edgeFunctions.length > 0
  );

  if (modulesWithFunctions.length === 0) {
    console.log('[modules] No edge functions to deploy.');
    return;
  }

  const result = await deployEdgeFunctions({
    projectRoot: PROJECT_ROOT,
    modules: modulesWithFunctions,
    deploy: shouldDeploy,
    projectRef: process.env.SUPABASE_PROJECT_REF,
  });

  for (const item of result.copied) {
    console.log(`[modules] Copied edge function: ${item.functionName} (from ${item.module})`);
  }

  for (const item of result.deployed) {
    console.log(`[modules] Deployed edge function: ${item.functionName}`);
  }

  for (const item of result.errors) {
    console.error(`[modules] Error with ${item.functionName} (${item.module}): ${item.error}`);
  }

  console.log(`\n[modules] ${result.copied.length} edge function(s) copied.`);

  if (result.deployed.length > 0) {
    console.log(`[modules] ${result.deployed.length} edge function(s) deployed.`);
  } else if (!shouldDeploy && result.copied.length > 0) {
    console.log('[modules] Run with --deploy to also deploy via supabase CLI.');
  }
}

main().catch((err) => {
  console.error('[modules] Deploy failed:', err);
  process.exit(1);
});
