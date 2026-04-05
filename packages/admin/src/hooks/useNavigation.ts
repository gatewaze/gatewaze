import { useMemo } from 'react';
import { useModulesContext } from '@/app/contexts/modules/context';
import { dashboardItems } from '@/app/navigation/segments/dashboards';
import { admin as staticAdmin } from '@/app/navigation/segments/admin';
import { moduleNavItems as staticModuleNavItems } from '@/app/navigation/segments/modules';
import { getModuleNavItemsFromRows, getModuleAdminNavItemsFromRows } from '@/app/navigation/segments/modules';
import type { NavigationTree } from '@/@types/navigation';

/**
 * Returns the full navigation tree with module items derived from the DB
 * (`installed_modules` rows) instead of the build-time module list.
 *
 * Falls back to the static build-time items when DB rows are not yet
 * available (e.g. during initial render before the modules context loads).
 */
export function useNavigation(): NavigationTree[] {
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

    return [
      ...dashboardItems,
      ...moduleItems,
      admin,
    ];
  }, [rows, ready]);
}
