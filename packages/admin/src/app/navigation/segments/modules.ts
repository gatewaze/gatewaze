/**
 * Navigation items contributed by installed Gatewaze modules.
 *
 * Historically these were derived from the build-time virtual module list.
 * Now they are derived from `installed_modules` DB rows (via the modules
 * context) so the admin sidebar works even when the virtual module returns
 * an empty array (e.g. Docker builds without the modules repo).
 *
 * Build-time modules are still used as a **fallback** for local dev where
 * the DB may not yet have rows seeded.
 */

import { NavigationTree } from "@/@types/navigation";
import type { InstalledModuleRow } from "@gatewaze/shared/modules";

// Build-time modules — may be empty in Docker.  Used only as a fallback.
import buildTimeModules from "virtual:gatewaze-modules";

interface ModuleNavItem {
  path: string;
  label: string;
  icon?: string;
  requiredFeature?: string;
  parentGroup?: string;
  order?: number;
}

function buildNavItem(modId: string, navItem: ModuleNavItem): NavigationTree {
  return {
    id: `module.${modId}.${navItem.path.replace(/\//g, ".")}`,
    path: navItem.path.startsWith("/") ? navItem.path : `/${navItem.path}`,
    type: "item",
    title: navItem.label,
    icon: navItem.icon,
    requiredFeature: navItem.requiredFeature,
  };
}

function sortByOrder(items: NavigationTree[], orderMap: Map<string, number>): NavigationTree[] {
  return [...items].sort((a, b) => {
    const orderA = orderMap.get(a.id) ?? 999;
    const orderB = orderMap.get(b.id) ?? 999;
    return orderA - orderB;
  });
}

// ---------------------------------------------------------------------------
// DB-driven nav items (primary path — used at runtime)
// ---------------------------------------------------------------------------

/**
 * Build top-level (non-admin) navigation items from DB rows.
 * Uses the `portal_nav` field of enabled modules.
 */
export function getModuleNavItemsFromRows(rows: InstalledModuleRow[]): NavigationTree[] {
  const items: NavigationTree[] = [];
  const orderMap = new Map<string, number>();

  for (const row of rows) {
    if (row.status !== "enabled") continue;

    // portal_nav provides a single top-level nav entry per module
    if (row.portal_nav) {
      const nav = row.portal_nav;
      const item = buildNavItem(row.id, {
        path: nav.path,
        label: nav.label,
        icon: nav.icon,
        order: nav.order,
      });
      items.push(item);
      if (nav.order !== undefined) {
        orderMap.set(item.id, nav.order);
      }
    }
  }

  return sortByOrder(items, orderMap);
}

/**
 * Build admin-section navigation items from DB rows.
 *
 * The `installed_modules` table does not have a dedicated admin_nav column,
 * so admin nav items are still sourced from the build-time module list when
 * available.  When the build-time list is empty (Docker), admin nav items
 * contributed by modules simply won't appear — module admin pages are not
 * routable in that scenario anyway since the component code is not bundled.
 */
export function getModuleAdminNavItemsFromRows(_rows: InstalledModuleRow[]): NavigationTree[] {
  // Admin nav items require bundled component code, so they must come from
  // the build-time module list.  Return whatever the build-time list provides.
  return getModuleAdminNavItemsStatic();
}

// ---------------------------------------------------------------------------
// Build-time fallback (used when DB rows are not yet available, e.g. static
// imports evaluated at module load time before the React tree mounts)
// ---------------------------------------------------------------------------

function buildOrderMapStatic(): Map<string, number> {
  const orderMap = new Map<string, number>();
  for (const mod of buildTimeModules) {
    for (const navItem of (mod.adminNavItems ?? []) as ModuleNavItem[]) {
      const id = `module.${mod.id}.${navItem.path.replace(/\//g, ".")}`;
      if (navItem.order !== undefined) {
        orderMap.set(id, navItem.order);
      }
    }
  }
  return orderMap;
}

function getModuleNavItemsStatic(): NavigationTree[] {
  const items: NavigationTree[] = [];

  for (const mod of buildTimeModules) {
    if (!mod.adminNavItems) continue;

    for (const navItem of mod.adminNavItems as ModuleNavItem[]) {
      if (navItem.parentGroup && navItem.parentGroup !== "dashboards") continue;
      items.push(buildNavItem(mod.id, navItem));
    }
  }

  return sortByOrder(items, buildOrderMapStatic());
}

function getModuleAdminNavItemsStatic(): NavigationTree[] {
  const items: NavigationTree[] = [];

  for (const mod of buildTimeModules) {
    if (!mod.adminNavItems) continue;

    for (const navItem of mod.adminNavItems as ModuleNavItem[]) {
      if (navItem.parentGroup !== "admin") continue;
      items.push(buildNavItem(mod.id, navItem));
    }
  }

  return sortByOrder(items, buildOrderMapStatic());
}

// Static exports — used by the static navigation tree (evaluated once at
// module load time).  In Docker these will be empty arrays; the dynamic
// `useNavigation` hook fills them in from DB rows at runtime.
export const moduleNavItems = getModuleNavItemsStatic();
export const moduleAdminNavItems = getModuleAdminNavItemsStatic();

// Re-export the old function names for any other consumers
export const getModuleNavItems = getModuleNavItemsStatic;
export const getModuleAdminNavItems = getModuleAdminNavItemsStatic;
