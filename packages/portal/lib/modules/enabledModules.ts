import { createClient } from '@supabase/supabase-js';

/**
 * Server-side helper to fetch enabled module IDs and features from the DB.
 * Cached for 60 seconds to avoid repeated queries on every render.
 */

export interface PortalNavItem {
  moduleId: string;
  label: string;
  path: string;
  icon: string;
  order: number;
}

interface ModuleState {
  enabledIds: Set<string>;
  enabledFeatures: Set<string>;
  portalNavItems: PortalNavItem[];
}

let cache: ModuleState | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

export async function getEnabledModules(): Promise<ModuleState> {
  const now = Date.now();
  if (cache && now - cacheTimestamp < CACHE_TTL_MS) {
    return cache;
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('[modules] Missing Supabase env vars, returning empty module state');
    return { enabledIds: new Set(), enabledFeatures: new Set(), portalNavItems: [] };
  }

  try {
    const supabase = createClient(url, key, {
      global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) },
    });
    const [modulesResult, navOverridesResult] = await Promise.all([
      supabase
        .from('installed_modules')
        .select('id, status, features, portal_nav')
        .eq('status', 'enabled'),
      supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'portal_nav_overrides')
        .maybeSingle(),
    ]);

    const { data, error } = modulesResult;

    // Parse nav overrides from platform_settings
    let navOverrides: { items: { moduleId: string; label?: string; order: number; hidden?: boolean }[] } = { items: [] };
    if (navOverridesResult.data?.value) {
      try {
        const parsed = JSON.parse(navOverridesResult.data.value);
        if (parsed && Array.isArray(parsed.items)) navOverrides = parsed;
      } catch { /* use empty overrides */ }
    }

    if (error) {
      console.error('[modules] Failed to fetch installed_modules:', error);
      return cache ?? { enabledIds: new Set(), enabledFeatures: new Set(), portalNavItems: [] };
    }

    const enabledIds = new Set<string>();
    const enabledFeatures = new Set<string>();
    const portalNavItems: PortalNavItem[] = [];

    for (const row of data ?? []) {
      enabledIds.add(row.id);
      if (Array.isArray(row.features)) {
        for (const f of row.features) enabledFeatures.add(f);
      }
      if (row.portal_nav && typeof row.portal_nav === 'object') {
        const nav = row.portal_nav as { label?: string; path?: string; icon?: string; order?: number };
        if (nav.label && nav.path) {
          portalNavItems.push({
            moduleId: row.id,
            label: nav.label,
            path: nav.path,
            icon: nav.icon || 'default',
            order: nav.order ?? 100,
          });
        }
      }
    }

    // Events nav is provided by the events module via portal_nav.
    // Fallback: add it if the module is enabled but no nav item was registered.
    if (enabledIds.has('events') && !portalNavItems.some(n => n.moduleId === 'events')) {
      portalNavItems.push({
        moduleId: 'events',
        label: 'Events',
        path: '/events/upcoming',
        icon: 'calendar',
        order: 10,
      });
    }

    // Apply admin nav overrides (custom order, labels, hidden items)
    const overrideMap = new Map(navOverrides.items.map(o => [o.moduleId, o]));
    for (const item of portalNavItems) {
      const override = overrideMap.get(item.moduleId);
      if (override) {
        if (override.label) item.label = override.label;
        if (override.order !== undefined) item.order = override.order;
      }
    }
    // Remove hidden items
    const visibleNavItems = portalNavItems.filter(item => {
      const override = overrideMap.get(item.moduleId);
      return !override?.hidden;
    });
    visibleNavItems.sort((a, b) => a.order - b.order);

    cache = { enabledIds, enabledFeatures, portalNavItems: visibleNavItems };
    cacheTimestamp = now;
    return cache;
  } catch (err) {
    console.error('[modules] Error fetching modules:', err);
    return cache ?? { enabledIds: new Set(), enabledFeatures: new Set(), portalNavItems: [] };
  }
}

export function isModuleEnabled(state: ModuleState, moduleId: string): boolean {
  return state.enabledIds.has(moduleId);
}

export function isFeatureEnabled(state: ModuleState, feature: string): boolean {
  return state.enabledFeatures.has(feature);
}
