// Import Dependencies
import { useMemo, useState } from "react";
import { useLocation } from "react-router";

// Local Imports
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { useAuthContext } from "@/app/contexts/auth/context";
import { useDidUpdate } from "@/hooks";
import { useFeaturePermissions } from "@/hooks/useFeaturePermissions";
import { filterNavigationByPermissions } from "@/utils/navigationPermissions";
import { useModulesContext } from "@/app/contexts/modules/context";
import { useNavigation } from "@/hooks/useNavigation";
import { isRouteActive } from "@/utils/isRouteActive";
import { MainPanel } from "./MainPanel";
import { PrimePanel } from "./PrimePanel";

// ----------------------------------------------------------------------

export type SegmentPath = string | undefined;

export function Sidebar() {
  const { pathname } = useLocation();
  const { name, lgAndDown } = useBreakpointsContext();
  const { isExpanded, close } = useSidebarContext();
  const { permissions, isSuperAdmin, isLoading } = useFeaturePermissions();
  const { isFeatureEnabled, allModuleFeatures, ready: modulesReady } = useModulesContext();
  const navigation = useNavigation();

  // Filter navigation based on user permissions and module state.
  // All hooks must run on every render — the loading guard moved BELOW
  // them to satisfy react-hooks/rules-of-hooks. Hooks below early-return
  // were a latent crash waiting for the conditional to flip.
  const filteredNavigation = useMemo(() => {
    return filterNavigationByPermissions(navigation, permissions, isSuperAdmin, isFeatureEnabled, allModuleFeatures);
  }, [navigation, permissions, isSuperAdmin, isFeatureEnabled, allModuleFeatures]);

  const initialSegment = useMemo(
    () => filteredNavigation.find((item) => isRouteActive(item.path, pathname)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [activeSegmentPath, setActiveSegmentPath] = useState<SegmentPath>(
    initialSegment?.path,
  );

  const currentSegment = useMemo(() => {
    return filteredNavigation.find((item) => item.path === activeSegmentPath);
  }, [activeSegmentPath, filteredNavigation]);

  useDidUpdate(() => {
    const activePath = filteredNavigation.find((item) =>
      isRouteActive(item.path, pathname),
    )?.path;

    setActiveSegmentPath(activePath);
  }, [pathname]);

  useDidUpdate(() => {
    if (lgAndDown && isExpanded) close();
  }, [name]);

  // Hide sidebar while loading permissions or modules to prevent flash of wrong content
  if (isLoading || !modulesReady) {
    return null;
  }

  return (
    <>
      <MainPanel
        nav={filteredNavigation}
        activeSegmentPath={activeSegmentPath}
        setActiveSegmentPath={setActiveSegmentPath}
      />
      <PrimePanel
        close={close}
        currentSegment={currentSegment}
        pathname={pathname}
      />
    </>
  );
}
