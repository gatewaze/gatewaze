// Import Dependencies
import { useLocation } from "react-router";
import { useLayoutEffect, useRef, useState, useMemo } from "react";
import SimpleBar from "simplebar-react";

// Local Imports
import { useDidUpdate } from "@/hooks";
import { Accordion } from "@/components/ui";
import { isRouteActive } from "@/utils/isRouteActive";
import { Group } from "./Group";
import { MenuItem } from "./Group/MenuItem";
import { useFeaturePermissions } from "@/hooks/useFeaturePermissions";
import { filterNavigationByPermissions } from "@/utils/navigationPermissions";
import { useModulesContext } from "@/app/contexts/modules/context";
import { useNavigation } from "@/hooks/useNavigation";

// ----------------------------------------------------------------------

export function Menu() {
  const { pathname } = useLocation();
  const ref = useRef<HTMLDivElement | null>(null);
  const { permissions, isSuperAdmin, isLoading } = useFeaturePermissions();
  const { isFeatureEnabled, allModuleFeatures, ready: modulesReady } = useModulesContext();
  const navigation = useNavigation();

  // Filter navigation based on user permissions and enabled modules
  const filteredNavigation = useMemo(() => {
    // While loading permissions or modules, show nothing to prevent flash of wrong content
    if (isLoading || !modulesReady) {
      return [];
    }

    // Filter navigation tree based on permissions and module state
    return filterNavigationByPermissions(navigation, permissions, isSuperAdmin, isFeatureEnabled, allModuleFeatures);
  }, [navigation, permissions, isSuperAdmin, isLoading, modulesReady, isFeatureEnabled, allModuleFeatures]);

  const activeGroup = filteredNavigation.find((item) => {
    if (item.path) return isRouteActive(item.path, pathname);
  });

  const activeCollapsible = activeGroup?.childs?.find((item) => {
    if (item.path) return isRouteActive(item.path, pathname);
  });

  const [expanded, setExpanded] = useState<string | null>(
    activeCollapsible?.path || null,
  );

  useDidUpdate(() => {
    if (activeCollapsible?.path !== expanded)
      setExpanded(activeCollapsible?.path || null);
  }, [activeCollapsible?.path]);

  useLayoutEffect(() => {
    const activeItem = ref.current?.querySelector("[data-menu-active=true]");
    activeItem?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <SimpleBar
      scrollableNodeProps={{ ref }}
      className="h-full overflow-x-hidden pb-6 pt-4"
    >
      <Accordion value={expanded} onChange={setExpanded} className="space-y-1">
        {filteredNavigation.map((nav) => {
          if (nav.type === "root" || nav.type === "group") {
            return <Group key={nav.id} data={nav} />;
          } else if (nav.type === "item") {
            return <MenuItem key={nav.id} data={nav} />;
          }
          return null;
        })}
      </Accordion>
    </SimpleBar>
  );
}
