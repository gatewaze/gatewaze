import { createClient } from '@supabase/supabase-js';
import type { PortalShell, PortalShellNavEntry } from '@gatewaze/shared';

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

/**
 * One workspace-shell rail item (per top-level module) + its contextual nav. Plain serializable
 * objects so they pass cleanly from the server layout to the client shell. Projected from each
 * module's `portal_shell` (when present) and the existing `portal_nav`. See spec §8.2.
 */
export interface RailItem {
  moduleId: string;
  label: string;
  full?: string;
  icon: string;
  order: number;
  visibility: 'public' | 'members' | 'admin';
  /** Public landing route for this module (the rail links here when access !== 'admin'). */
  href: string;
  /** Admin landing route (`/admin/<module>`); the rail links here when access === 'admin'. */
  adminHref: string;
  fullBleed: boolean;
  nav: PortalShellNavEntry[];
  publicNav: PortalShellNavEntry[];
}

interface ModuleState {
  enabledIds: Set<string>;
  enabledFeatures: Set<string>;
  portalNavItems: PortalNavItem[];
  railItems: RailItem[];
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
    return { enabledIds: new Set(), enabledFeatures: new Set(), portalNavItems: [], railItems: [] };
  }

  try {
    const supabase = createClient(url, key, {
      global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) },
    });

    // Try selecting the richer set including `portal_shell`; if that column doesn't exist yet
    // (migration 00035 not applied), gracefully fall back to the legacy columns so module loading
    // never breaks. railItems then derive from `portal_nav` alone until the column lands.
    let modulesResult = await supabase
      .from('installed_modules')
      .select('id, status, features, portal_nav, portal_shell')
      .eq('status', 'enabled');
    if (modulesResult.error) {
      // Legacy shape (no portal_shell column yet). Cast to the richer result type — rows simply
      // lack portal_shell at runtime, which we read via an optional cast below.
      modulesResult = (await supabase
        .from('installed_modules')
        .select('id, status, features, portal_nav')
        .eq('status', 'enabled')) as typeof modulesResult;
    }
    const navOverridesResult = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'portal_nav_overrides')
      .maybeSingle();

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
      return cache ?? { enabledIds: new Set(), enabledFeatures: new Set(), portalNavItems: [], railItems: [] };
    }

    const enabledIds = new Set<string>();
    const enabledFeatures = new Set<string>();
    const portalNavItems: PortalNavItem[] = [];
    const shellByModule = new Map<string, PortalShell>();

    for (const row of data ?? []) {
      enabledIds.add(row.id);
      if (Array.isArray(row.features)) {
        for (const f of row.features) enabledFeatures.add(f);
      }
      const shellRaw = (row as { portal_shell?: unknown }).portal_shell;
      if (shellRaw && typeof shellRaw === 'object' && (shellRaw as PortalShell).rail) {
        shellByModule.set(row.id, shellRaw as PortalShell);
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

    // Project rail items. Synthetic "Home" always leads. When any module declares `portal_shell`,
    // the rail is the CURATED set of those modules (matching the design's top-level rail); otherwise
    // it falls back to deriving one item per `portal_nav` module. href = public landing,
    // adminHref = `/admin/<module>`.
    const navByModule = new Map(visibleNavItems.map((n) => [n.moduleId, n]));
    const home: RailItem = {
      moduleId: 'home', label: 'Home', full: 'Home', icon: 'home', order: 0,
      visibility: 'public', href: '/', adminHref: '/', fullBleed: false, nav: [], publicNav: [],
    };

    let moduleRail: RailItem[];
    if (shellByModule.size > 0) {
      moduleRail = [...shellByModule.entries()]
        .filter(([id]) => enabledIds.has(id))
        .map(([id, shell]) => {
          const nav = navByModule.get(id);
          return {
            moduleId: id,
            label: shell.rail.label,
            full: shell.rail.full || shell.rail.label,
            icon: shell.rail.icon,
            order: shell.rail.order,
            visibility: shell.rail.visibility,
            href: nav?.path || `/${id}`,
            adminHref: `/admin/${id}`,
            fullBleed: shell.rail.fullBleed ?? false,
            nav: shell.nav ?? [],
            publicNav: shell.publicNav ?? [],
          };
        });
    } else {
      moduleRail = visibleNavItems.map((item) => ({
        moduleId: item.moduleId,
        label: item.label,
        full: item.label,
        icon: item.icon,
        order: item.order,
        visibility: 'public' as const,
        href: item.path,
        adminHref: `/admin/${item.moduleId}`,
        fullBleed: false,
        nav: [],
        publicNav: [],
      }));
    }

    // Apply portal_nav_overrides ordering/hide to the module rail items too.
    for (const r of moduleRail) {
      const o = overrideMap.get(r.moduleId);
      if (o) {
        if (o.label) r.label = o.label;
        if (o.order !== undefined) r.order = o.order;
      }
    }
    const railItems: RailItem[] = [home, ...moduleRail.filter((r) => !overrideMap.get(r.moduleId)?.hidden)];
    railItems.sort((a, b) => a.order - b.order);

    cache = { enabledIds, enabledFeatures, portalNavItems: visibleNavItems, railItems };
    cacheTimestamp = now;
    return cache;
  } catch (err) {
    console.error('[modules] Error fetching modules:', err);
    return cache ?? { enabledIds: new Set(), enabledFeatures: new Set(), portalNavItems: [], railItems: [] };
  }
}

export function isModuleEnabled(state: ModuleState, moduleId: string): boolean {
  return state.enabledIds.has(moduleId);
}

export function isFeatureEnabled(state: ModuleState, feature: string): boolean {
  return state.enabledFeatures.has(feature);
}
