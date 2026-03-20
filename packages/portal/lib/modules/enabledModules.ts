import { createClient } from '@supabase/supabase-js';

/**
 * Server-side helper to fetch enabled module IDs and features from the DB.
 * Cached for 60 seconds to avoid repeated queries on every render.
 */

interface ModuleState {
  enabledIds: Set<string>;
  enabledFeatures: Set<string>;
}

let cache: ModuleState | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

export async function getEnabledModules(): Promise<ModuleState> {
  const now = Date.now();
  if (cache && now - cacheTimestamp < CACHE_TTL_MS) {
    return cache;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('[modules] Missing Supabase env vars, returning empty module state');
    return { enabledIds: new Set(), enabledFeatures: new Set() };
  }

  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from('installed_modules')
      .select('id, status, features')
      .eq('status', 'enabled');

    if (error) {
      console.error('[modules] Failed to fetch installed_modules:', error);
      return cache ?? { enabledIds: new Set(), enabledFeatures: new Set() };
    }

    const enabledIds = new Set<string>();
    const enabledFeatures = new Set<string>();

    for (const row of data ?? []) {
      enabledIds.add(row.id);
      if (Array.isArray(row.features)) {
        for (const f of row.features) enabledFeatures.add(f);
      }
    }

    cache = { enabledIds, enabledFeatures };
    cacheTimestamp = now;
    return cache;
  } catch (err) {
    console.error('[modules] Error fetching modules:', err);
    return cache ?? { enabledIds: new Set(), enabledFeatures: new Set() };
  }
}

export function isModuleEnabled(state: ModuleState, moduleId: string): boolean {
  return state.enabledIds.has(moduleId);
}

export function isFeatureEnabled(state: ModuleState, feature: string): boolean {
  return state.enabledFeatures.has(feature);
}
