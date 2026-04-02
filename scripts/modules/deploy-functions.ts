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
 */

import { loadModules, deployEdgeFunctions } from '@gatewaze/shared/modules';
import config from '../../gatewaze.config';
import { resolve } from 'path';

const shouldDeploy = process.argv.includes('--deploy');
const PROJECT_ROOT = resolve(import.meta.dirname ?? __dirname, '../..');

async function main() {
  const modules = await loadModules(config, PROJECT_ROOT);

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
