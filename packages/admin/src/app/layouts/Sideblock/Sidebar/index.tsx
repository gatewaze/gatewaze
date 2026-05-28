// Import Dependencies
import {
  ArrowLeftStartOnRectangleIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/outline";
import { Theme } from "@radix-ui/themes";
import { NavLink, useLocation } from "react-router";
import clsx from "clsx";

// Local Imports
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { useAuthContext } from "@/app/contexts/auth/context";
import { useDidUpdate } from "@/hooks";
import { isRouteActive } from "@/utils/isRouteActive";
import { Header } from "./Header";
import { Menu } from "./Menu";
import { useRailTooltip } from "./useRailTooltip";

// ----------------------------------------------------------------------

export function Sidebar() {
  const { logout } = useAuthContext();
  const { name, lgAndDown, xlAndUp } = useBreakpointsContext();
  const { pathname } = useLocation();

  const {
    isExpanded: isSidebarExpanded,
    close: closeSidebar,
    isCollapsed,
  } = useSidebarContext();

  useDidUpdate(() => {
    if (isSidebarExpanded) closeSidebar();
  }, [name]);

  const handleLogout = () => {
    logout();
  };

  const isSettingsActive = isRouteActive("/admin", pathname);
  const collapsed = isCollapsed && xlAndUp;

  const settingsTooltip = useRailTooltip(collapsed, "Settings");
  const signOutTooltip = useRailTooltip(collapsed, "Sign Out");

  return (
    <div
      className="sidebar-panel bg-[var(--accent-2)]"
    >
      <Theme
        appearance="dark"
        accentColor="gray"
        className="flex h-full grow flex-col bg-[var(--accent-2)] border-[var(--accent-a4)] ltr:border-r rtl:border-l"
      >
        <Header />
        <Menu />

        {/* Settings + Sign Out (pinned to bottom) */}
        <div
          className={clsx(
            "mt-auto border-t border-[var(--accent-a4)] space-y-1 py-4",
            collapsed ? "px-3" : "px-4",
          )}
        >
          <NavLink
            to="/admin"
            ref={settingsTooltip.ref}
            onMouseEnter={settingsTooltip.onMouseEnter}
            onMouseLeave={settingsTooltip.onMouseLeave}
            onClick={() => lgAndDown && closeSidebar()}
            aria-label={collapsed ? "Settings" : undefined}
            className={clsx(
              "flex w-full items-center px-3 py-2.5 text-xs-plus tracking-wide font-medium rounded-lg transition-colors",
              collapsed ? "justify-center" : "gap-3",
              isSettingsActive
                ? "bg-[var(--accent-a3)] text-[var(--accent-12)]"
                : "text-[var(--accent-11)] hover:text-[var(--accent-12)] hover:bg-[var(--accent-a3)]",
            )}
          >
            <Cog6ToothIcon className="size-5 shrink-0" />
            {!collapsed && <span>Settings</span>}
          </NavLink>
          {settingsTooltip.node}
          <button
            onClick={handleLogout}
            ref={signOutTooltip.ref}
            onMouseEnter={signOutTooltip.onMouseEnter}
            onMouseLeave={signOutTooltip.onMouseLeave}
            aria-label={collapsed ? "Sign Out" : undefined}
            className={clsx(
              "flex w-full items-center px-3 py-2.5 text-xs-plus tracking-wide font-medium text-[var(--accent-11)] hover:text-[var(--accent-12)] hover:bg-[var(--accent-a3)] rounded-lg transition-colors",
              collapsed ? "justify-center" : "gap-3",
            )}
          >
            <ArrowLeftStartOnRectangleIcon className="size-5 shrink-0" />
            {!collapsed && <span>Sign Out</span>}
          </button>
          {signOutTooltip.node}
        </div>
      </Theme>
    </div>
  );
}
