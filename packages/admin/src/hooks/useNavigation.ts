import { useMemo } from 'react';
import { useModulesContext } from '@/app/contexts/modules/context';
import { dashboardItems } from '@/app/navigation/segments/dashboards';
import { admin as staticAdmin } from '@/app/navigation/segments/admin';
import { moduleNavItems as staticModuleNavItems } from '@/app/navigation/segments/modules';
import { getModuleNavItemsFromRows, getModuleAdminNavItemsFromRows } from '@/app/navigation/segments/modules';
import { applyNavLayout, seedLayoutFromTree } from '@/app/navigation/resolveNavLayout';
import { useNavLayout } from '@/hooks/useNavLayout';
import type { NavigationTree } from '@/@types/navigation';

/**
 * The module-default navigation tree, BEFORE any user/org layout overlay.
 * Module items derive from `installed_modules` DB rows (falling back to the
 * static build-time list before the context loads). This is the full item
 * pool the Navigation editor draws from — it must show every item regardless
 * of whether the active layout hides or relocates it.
 */
export function useBaseNavigation(): NavigationTree[] {
  const { rows, ready } = useModulesContext();

  return useMemo(() => {
    const useDb = ready && rows.length > 0;

    const moduleItems = useDb
      ? getModuleNavItemsFromRows(rows)
      : staticModuleNavItems;

    // Rebuild admin section's module items from DB rows so that
    // modules installed at runtime (e.g. scrapers) appear in the sidebar.
    let admin: NavigationTree = staticAdmin;
    if (useDb) {
      try {
        const dbAdminModuleItems = getModuleAdminNavItemsFromRows(rows);
        const coreItems = (staticAdmin.childs ?? []).filter(
          (item) => !item.id.startsWith('module.')
        );
        const settingsIdx = coreItems.findIndex((item) => item.id === 'admin.settings');
        const before = settingsIdx >= 0 ? coreItems.slice(0, settingsIdx) : coreItems;
        const after = settingsIdx >= 0 ? coreItems.slice(settingsIdx) : [];
        admin = {
          ...staticAdmin,
          childs: [...before, ...dbAdminModuleItems, ...after],
        };
      } catch (err) {
        console.warn('[useNavigation] Failed to build admin nav from DB rows:', err);
      }
    }

    return [...dashboardItems, ...moduleItems, admin];
  }, [rows, ready]);
}

/**
 * Returns the navigation tree with the active org/user layout overlaid. Until
 * the layout has loaded (and when none is configured) this is identical to
 * {@link useBaseNavigation}, so the sidebar renders exactly as the module
 * defaults dictate.
 */
export function useNavigation(): NavigationTree[] {
  const baseTree = useBaseNavigation();
  const { layout, ready: layoutReady } = useNavLayout();

  return useMemo(() => {
    if (!layoutReady) return baseTree;
    // No saved layout → render the categorized default built from each item's
    // module/core-declared placement (defaultSection/order), rather than the
    // flat base tree.
    const effective = layout ?? seedLayoutFromTree(baseTree);
    return applyNavLayout(baseTree, effective);
  }, [baseTree, layout, layoutReady]);
}
