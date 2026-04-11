#!/usr/bin/env tsx
/**
 * Apply pending database migrations for all installed modules.
 *
 * Usage: pnpm modules:migrate
 */

import { createClient } from '@supabase/supabase-js';
// createRequire to work around Node ESM <-> TypeScript CommonJS interop:
// tsc's CJS output uses Object.defineProperty which Node can't statically
// analyse as named exports. Load via require() which returns the CJS
// exports object directly.
import { createRequire } from 'module';
import config from '../../gatewaze.config';
import dotenv from 'dotenv';
import path from 'path';

const require = createRequire(import.meta.url);
const modulesLib = require('@gatewaze/shared/modules') as {
  loadModules: typeof import('@gatewaze/shared/modules').loadModules;
  reconcileModules: typeof import('@gatewaze/shared/modules').reconcileModules;
};
const { loadModules, reconcileModules } = modulesLib;

const PROJECT_ROOT = path.resolve(import.meta.dirname ?? __dirname, '../..');

dotenv.config({ path: path.resolve(import.meta.dirname ?? __dirname, '../../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('[modules] Loading modules from gatewaze.config.ts...');

  const modules = await loadModules(config, PROJECT_ROOT);

  if (modules.length === 0) {
    console.log('[modules] No modules configured.');
    return;
  }

  console.log(`[modules] Found ${modules.length} module(s): ${modules.map(m => m.config.name).join(', ')}`);
  console.log('[modules] Reconciling module state...\n');

  await reconcileModules(modules, supabase as never);

  console.log('\n[modules] Done.');
}

main().catch((err) => {
  console.error('[modules] Migration failed:', err);
  process.exit(1);
});
