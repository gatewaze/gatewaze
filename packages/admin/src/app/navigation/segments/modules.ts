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

    // admin_nav contains admin sidebar navigation items per module
    if (row.admin_nav) {
      for (const nav of row.admin_nav) {
        // Only include items for the main dashboards group (admin group items go elsewhere)
        if (nav.parentGroup && nav.parentGroup !== "dashboards") continue;
        const item = buildNavItem(row.id, nav);
        items.push(item);
        if (nav.order !== undefined) {
          orderMap.set(item.id, nav.order);
        }
      }
    }
  }

  return sortByOrder(items, orderMap);
}

/**
 * Build admin-section navigation items from DB rows.
 */
export function getModuleAdminNavItemsFromRows(rows: InstalledModuleRow[]): NavigationTree[] {
  const items: NavigationTree[] = [];
  const orderMap = new Map<string, number>();

  for (const row of rows) {
    if (row.status !== "enabled") continue;
    if (row.admin_nav) {
      for (const nav of row.admin_nav) {
        if (nav.parentGroup !== "admin") continue;
        const item = buildNavItem(row.id, nav);
        items.push(item);
        if (nav.order !== undefined) {
          orderMap.set(item.id, nav.order);
        }
      }
    }
  }

  // Fall back to build-time list if no DB items
  if (items.length === 0) return getModuleAdminNavItemsStatic();
  return sortByOrder(items, orderMap);
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
