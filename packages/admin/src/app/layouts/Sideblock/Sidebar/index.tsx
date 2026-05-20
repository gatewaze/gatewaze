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

// ----------------------------------------------------------------------

export function Sidebar() {
  const { logout } = useAuthContext();
  const { name, lgAndDown } = useBreakpointsContext();
  const { pathname } = useLocation();

  const { isExpanded: isSidebarExpanded, close: closeSidebar } =
    useSidebarContext();

  useDidUpdate(() => {
    if (isSidebarExpanded) closeSidebar();
  }, [name]);

  const handleLogout = () => {
    logout();
  };

  const isSettingsActive = isRouteActive("/admin", pathname);

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
        <div className="mt-auto border-t border-[var(--accent-a4)] p-4 space-y-1">
          <NavLink
            to="/admin"
            onClick={() => lgAndDown && closeSidebar()}
            className={clsx(
              "flex w-full items-center gap-3 px-3 py-2.5 text-xs-plus tracking-wide font-medium rounded-lg transition-colors",
              isSettingsActive
                ? "bg-[var(--accent-a3)] text-[var(--accent-12)]"
                : "text-[var(--accent-11)] hover:text-[var(--accent-12)] hover:bg-[var(--accent-a3)]",
            )}
          >
            <Cog6ToothIcon className="size-5" />
            <span>Settings</span>
          </NavLink>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-xs-plus tracking-wide font-medium text-[var(--accent-11)] hover:text-[var(--accent-12)] hover:bg-[var(--accent-a3)] rounded-lg transition-colors"
          >
            <ArrowLeftStartOnRectangleIcon className="size-5" />
            <span>Sign Out</span>
          </button>
        </div>
      </Theme>
    </div>
  );
}
