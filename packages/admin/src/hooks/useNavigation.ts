import { useMemo } from 'react';
import { useModulesContext } from '@/app/contexts/modules/context';
import { dashboardItems } from '@/app/navigation/segments/dashboards';
import { admin } from '@/app/navigation/segments/admin';
import { moduleNavItems as staticModuleNavItems } from '@/app/navigation/segments/modules';
import { getModuleNavItemsFromRows } from '@/app/navigation/segments/modules';
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
    // When the modules context has loaded, derive nav from DB rows.
    // Otherwise fall back to the static build-time items.
    const moduleItems = ready && rows.length > 0
      ? getModuleNavItemsFromRows(rows)
      : staticModuleNavItems;

    return [
      ...dashboardItems,
      ...moduleItems,
      admin,
    ];
  }, [rows, ready]);
}
