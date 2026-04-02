/**
 * Navigation items contributed by installed Gatewaze modules.
 *
 * Converts each module's adminNavItems into the NavigationTree format
 * used by the admin sidebar. Items are sorted by their `order` field
 * and grouped by parentGroup (top-level vs admin children).
 */

import { NavigationTree } from "@/@types/navigation";
import modules from "virtual:gatewaze-modules";

interface ModuleNavItem {
  path: string;
  label: string;
  icon?: string;
  requiredFeature?: string;
  parentGroup?: string;
  order?: number;
}

function buildNavItem(mod: { id: string }, navItem: ModuleNavItem): NavigationTree {
  return {
    id: `module.${mod.id}.${navItem.path.replace(/\//g, ".")}`,
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

function buildOrderMap(): Map<string, number> {
  const orderMap = new Map<string, number>();
  for (const mod of modules) {
    for (const navItem of (mod.adminNavItems ?? []) as ModuleNavItem[]) {
      const id = `module.${mod.id}.${navItem.path.replace(/\//g, ".")}`;
      if (navItem.order !== undefined) {
        orderMap.set(id, navItem.order);
      }
    }
  }
  return orderMap;
}

/**
 * Top-level navigation items from modules (no parentGroup or parentGroup: 'dashboards').
 */
export function getModuleNavItems(): NavigationTree[] {
  const items: NavigationTree[] = [];

  for (const mod of modules) {
    if (!mod.adminNavItems) continue;

    for (const navItem of mod.adminNavItems as ModuleNavItem[]) {
      if (navItem.parentGroup && navItem.parentGroup !== 'dashboards') continue;
      items.push(buildNavItem(mod, navItem));
    }
  }

  return sortByOrder(items, buildOrderMap());
}

/**
 * Admin-section navigation items from modules (parentGroup: 'admin').
 */
export function getModuleAdminNavItems(): NavigationTree[] {
  const items: NavigationTree[] = [];

  for (const mod of modules) {
    if (!mod.adminNavItems) continue;

    for (const navItem of mod.adminNavItems as ModuleNavItem[]) {
      if (navItem.parentGroup !== 'admin') continue;
      items.push(buildNavItem(mod, navItem));
    }
  }

  return sortByOrder(items, buildOrderMap());
}

export const moduleNavItems = getModuleNavItems();
export const moduleAdminNavItems = getModuleAdminNavItems();
