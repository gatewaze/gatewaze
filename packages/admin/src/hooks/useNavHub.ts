import { useMemo } from 'react';
import { useModulesContext } from '@/app/contexts/modules/context';
import { useNavHubs } from '@/hooks/useNavigation';
import { useFeaturePermissions } from '@/hooks/useFeaturePermissions';
import { filterNavigationByPermissions } from '@/utils/navigationPermissions';
import type { NavHubCard } from '@/app/navigation/resolveNavLayout';
import type { NavigationTree } from '@/@types/navigation';

export interface UseNavHubResult {
  /** This hub's cards, in layout order. Module cards the user can't see are removed. */
  cards: NavHubCard[];
  /** True once modules, permissions, and the nav layout have all loaded. */
  ready: boolean;
  /**
   * Set when the nav layout failed to load. `cards` is then empty rather than
   * a guess, since a fallback layout would show the wrong list.
   */
  error: Error | null;
  /** Retry loading the nav layout. */
  reload: () => void;
  /**
   * @deprecated Use `cards`. The module cards as nav items, with the card's
   * title and icon applied. Kept for one release so a hub page built against
   * the earlier `items` shape keeps working until its module is updated.
   */
  items: NavigationTree[];
}

/**
 * The cards an org/user has put on a module hub page (a launcher page that,
 * like Settings, shows a grid of cards). A module declares a hub by setting
 * `hub: '<id>'` on one of its `adminNavItems`; the Navigation editor then
 * gives that hub its own card list, and the hub page renders what this hook
 * returns.
 *
 * Module cards go through the same permission filter as the sidebar, so a
 * module that is disabled, or that an embed host did not enable, drops out.
 * Custom link cards are kept: an admin added them to the layout on purpose.
 */
export function useNavHub(hubId: string): UseNavHubResult {
  const { hubs, ready: layoutReady, error, reload } = useNavHubs();
  const { permissions, isSuperAdmin, isLoading } = useFeaturePermissions();
  const { isFeatureEnabled, allModuleFeatures, ready: modulesReady } = useModulesContext();

  const ready = layoutReady && modulesReady && !isLoading;

  const cards = useMemo(() => {
    if (!ready || error) return [];
    const filed = Object.hasOwn(hubs, hubId) ? hubs[hubId] : [];
    return filed.filter(
      (card) =>
        !card.node ||
        filterNavigationByPermissions([card.node], permissions, isSuperAdmin, isFeatureEnabled, allModuleFeatures)
          .length > 0,
    );
  }, [ready, error, hubs, hubId, permissions, isSuperAdmin, isFeatureEnabled, allModuleFeatures]);

  const items = useMemo(
    () => cards.flatMap((card) => (card.node ? [{ ...card.node, title: card.title, icon: card.icon }] : [])),
    [cards],
  );

  return { cards, items, ready, error, reload };
}
