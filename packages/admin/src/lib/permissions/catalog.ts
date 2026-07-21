/**
 * Admin permission catalog — the grantable "features" shown in the Feature
 * Access dialog, derived from what's actually installed rather than a
 * hand-maintained list.
 *
 * Historically the dialog rendered a static `FEATURE_METADATA` list of ~20
 * features that drifted out of sync with the real module nav (no Events,
 * Broadcasts, Speakers, etc.). This builds the catalog at runtime:
 *
 *   - Core pages come from `FEATURE_METADATA`, but only the entries NOT owned
 *     by any installed module (module-owned keys are surfaced as modules
 *     instead, so nothing is listed twice).
 *   - Modules come from the enabled `installed_modules` rows, grouped by the
 *     module's `group` (e.g. all the `event-*` modules under "Events"), read
 *     from the build-time manifest that ships in the admin bundle.
 *
 * A grant is per-MODULE: checking a module toggles all of that module's
 * `features[]` on or off. The route guard (which keys off each route's
 * `requiredFeature`) then lets the module's pages through.
 */

import { useMemo } from 'react';
import buildTimeModules from 'virtual:gatewaze-modules';
import { useModulesContext } from '@/app/contexts/modules/context';
import { FEATURE_METADATA, FEATURE_CATEGORIES } from './types';

export interface CatalogModule {
  /** Stable id: the module id, or `core:<feature>` for a built-in page. */
  id: string;
  label: string;
  description?: string;
  /** Representative route, for display only. */
  route?: string;
  /** Every feature key this grant toggles on/off. */
  features: string[];
  /** The feature used to decide whether this module is currently granted. */
  primaryFeature: string;
  isCore: boolean;
}

export interface CatalogGroup {
  key: string;
  label: string;
  modules: CatalogModule[];
}

export interface AdminPermissionCatalog {
  groups: CatalogGroup[];
  /** Every grantable feature across the whole catalog. */
  allCatalogFeatures: Set<string>;
  /** Map a feature back to the catalog module that owns it. */
  moduleByFeature: Map<string, CatalogModule>;
  /** Total number of grantable modules (across all groups). */
  moduleCount: number;
  isLoading: boolean;
}

function titleCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build the grouped, per-module permission catalog from the installed-modules
 * registry plus the core (non-module) pages.
 */
export function useAdminPermissionCatalog(): AdminPermissionCatalog {
  const { rows, allModuleFeatures, ready } = useModulesContext();

  return useMemo(() => {
    // Build-time manifest (bundled into the admin image) — carries `group`,
    // `description`, and `features`, which the DB row does not.
    const manifest = new Map(buildTimeModules.map((m) => [m.id, m]));

    // ---- Core (non-module) pages, grouped by their FEATURE_METADATA category.
    // Skip any feature that an installed module owns — it's shown as a module.
    const coreGroups: CatalogGroup[] = [];
    for (const cat of FEATURE_CATEGORIES) {
      const modules: CatalogModule[] = Object.values(FEATURE_METADATA)
        .filter((f) => f.category === cat.key && !allModuleFeatures.has(f.key))
        .map((f) => ({
          id: `core:${f.key}`,
          label: f.label,
          description: f.description,
          route: f.route,
          features: [f.key],
          primaryFeature: f.key,
          isCore: true,
        }));
      if (modules.length) {
        coreGroups.push({ key: `core:${cat.key}`, label: cat.label, modules });
      }
    }

    // ---- Modules (enabled only), grouped by manifest `group`.
    const byGroup = new Map<string, CatalogModule[]>();
    for (const row of rows) {
      if (row.status !== 'enabled') continue;
      const man = manifest.get(row.id);
      const features =
        row.features && row.features.length ? row.features : man?.features ?? [row.id];
      const primaryFeature = features.includes(row.id) ? row.id : features[0] ?? row.id;
      const groupLabel = man?.group || 'Other Modules';
      const mod: CatalogModule = {
        id: row.id,
        label: row.name || man?.name || row.id,
        description: row.description || man?.description,
        route: (row.admin_nav && row.admin_nav[0]?.path) || undefined,
        features,
        primaryFeature,
        isCore: false,
      };
      const arr = byGroup.get(groupLabel) ?? [];
      arr.push(mod);
      byGroup.set(groupLabel, arr);
    }

    const moduleGroups: CatalogGroup[] = [...byGroup.entries()]
      // Alphabetical, but keep the catch-all "Other Modules" bucket last.
      .sort((a, b) => {
        if (a[0] === 'Other Modules') return 1;
        if (b[0] === 'Other Modules') return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([label, modules]) => ({
        key: `mod:${label}`,
        label: titleCase(label),
        modules: modules.sort((a, b) => a.label.localeCompare(b.label)),
      }));

    const groups = [...coreGroups, ...moduleGroups];

    const moduleByFeature = new Map<string, CatalogModule>();
    const allCatalogFeatures = new Set<string>();
    let moduleCount = 0;
    for (const g of groups) {
      for (const m of g.modules) {
        moduleCount++;
        for (const f of m.features) {
          moduleByFeature.set(f, m);
          allCatalogFeatures.add(f);
        }
      }
    }

    return { groups, allCatalogFeatures, moduleByFeature, moduleCount, isLoading: !ready };
  }, [rows, allModuleFeatures, ready]);
}

/**
 * Given a flat set of granted features, return the set of catalog module ids
 * that count as "on" (a module is on when its primary feature is granted).
 */
export function selectedModuleIds(
  features: Iterable<string>,
  catalog: AdminPermissionCatalog,
): Set<string> {
  const has = new Set(features);
  const ids = new Set<string>();
  for (const g of catalog.groups) {
    for (const m of g.modules) {
      if (has.has(m.primaryFeature)) ids.add(m.id);
    }
  }
  return ids;
}

/**
 * Expand the selected module ids to the flat feature list to persist. Any
 * previously-granted feature that isn't represented by ANY catalog module is
 * preserved (so we never silently revoke an orphaned/legacy grant).
 */
export function modulesToFeatures(
  selectedIds: Set<string>,
  catalog: AdminPermissionCatalog,
  initialFeatures: string[] = [],
): string[] {
  const out = new Set<string>();
  for (const g of catalog.groups) {
    for (const m of g.modules) {
      if (selectedIds.has(m.id)) {
        for (const f of m.features) out.add(f);
      }
    }
  }
  for (const f of initialFeatures) {
    if (!catalog.allCatalogFeatures.has(f)) out.add(f);
  }
  return [...out];
}
