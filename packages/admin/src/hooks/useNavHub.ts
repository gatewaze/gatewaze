import { useMemo } from 'react';
import { useModulesContext } from '@/app/contexts/modules/context';
import { useNavHubs } from '@/hooks/useNavigation';
import { useFeaturePermissions } from '@/hooks/useFeaturePermissions';
import { filterNavigationByPermissions } from '@/utils/navigationPermissions';
import type { NavigationTree } from '@/@types/navigation';

export interface UseNavHubResult {
  /** Items filed onto this hub, in layout order, after permission filtering. */
  items: NavigationTree[];
  /** True once modules, permissions, and the nav layout have all loaded. */
  ready: boolean;
  /**
   * Set when the nav layout failed to load. `items` is then empty rather than
   * a guess, since a fallback layout would show the wrong list.
   */
  error: Error | null;
  /** Retry loading the nav layout. */
  reload: () => void;
}

/**
 * Items an org/user has filed onto a module hub page (a launcher page that,
 * like Settings, lists other nav items). A module declares a hub by setting
 * `hub: '<id>'` on one of its `adminNavItems`; the Navigation editor then
 * gives that hub its own container, and the hub page renders what this hook
 * returns.
 *
 * Items go through the same permission filter as the sidebar, so a module
 * that is disabled, or that an embed host did not enable, drops out.
 */
export function useNavHub(hubId: string): UseNavHubResult {
  const { hubs, ready: layoutReady, error, reload } = useNavHubs();
  const { permissions, isSuperAdmin, isLoading } = useFeaturePermissions();
  const { isFeatureEnabled, allModuleFeatures, ready: modulesReady } = useModulesContext();

  const ready = layoutReady && modulesReady && !isLoading;

  const items = useMemo(() => {
    if (!ready || error) return [];
    const filed = Object.hasOwn(hubs, hubId) ? hubs[hubId] : [];
    return filterNavigationByPermissions(
      filed,
      permissions,
      isSuperAdmin,
      isFeatureEnabled,
      allModuleFeatures,
    );
  }, [ready, error, hubs, hubId, permissions, isSuperAdmin, isFeatureEnabled, allModuleFeatures]);

  return { items, ready, error, reload };
}
