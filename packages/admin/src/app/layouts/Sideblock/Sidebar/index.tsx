// Import Dependencies
import {
  ArrowLeftStartOnRectangleIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/outline";
import { PanelLeft } from "lucide-react";
import { Theme } from "@radix-ui/themes";
import { Link, NavLink, useLocation } from "react-router";
import clsx from "clsx";

// Local Imports
import { Avatar } from "@/components/ui";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { useAuthContext } from "@/app/contexts/auth/context";
import { useDidUpdate } from "@/hooks";
import { isRouteActive } from "@/utils/isRouteActive";
import { Header } from "./Header";
import { Menu } from "./Menu";
import { useRailTooltip } from "./useRailTooltip";

// ----------------------------------------------------------------------

function userInitials(name?: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("");
}

function roleLabel(role?: string): string {
  if (!role) return "";
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function Sidebar() {
  const { user, logout } = useAuthContext();
  const { name, lgAndDown, xlAndUp } = useBreakpointsContext();
  const { pathname } = useLocation();

  const {
    isExpanded: isSidebarExpanded,
    close: closeSidebar,
    isCollapsed,
    toggleCollapsed,
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
  const toggleTooltip = useRailTooltip(collapsed, "Expand sidebar");

  return (
    <div className="sidebar-panel bg-[var(--accent-2)]">
      <Theme
        appearance="dark"
        accentColor="gray"
        className="relative flex h-full grow flex-col bg-[var(--accent-2)] border-[var(--accent-a4)] ltr:border-r rtl:border-l"
      >
        {/* Rail-top mask: an opaque strip below the logo that hides menu icons
            scrolling up behind the collapse toggle. Only needed in the rail,
            where the toggle sits within the scroll zone. */}
        {collapsed && (
          <div className="pointer-events-none absolute inset-x-0 top-[72px] z-10 hidden h-12 bg-[var(--accent-2)] xl:block" />
        )}

        {/* Desktop collapse/expand toggle (Netlify-style panel icon). It is
            absolutely positioned so it can slide between the rail-top (below
            the logo, centered) when collapsed and the logo row (top-right)
            when expanded. xl-only; smaller screens use the overlay close. */}
        <button
          onClick={toggleCollapsed}
          ref={toggleTooltip.ref}
          onMouseEnter={toggleTooltip.onMouseEnter}
          onMouseLeave={toggleTooltip.onMouseLeave}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            top: collapsed ? "5rem" : "1.375rem",
            left: collapsed ? "1.375rem" : "11.5rem",
          }}
          className="absolute z-20 hidden size-7 items-center justify-center rounded-md text-[var(--accent-11)] transition-all duration-300 ease-in-out hover:bg-[var(--accent-a3)] hover:text-[var(--accent-12)] xl:flex"
        >
          <PanelLeft className="size-5" />
        </button>
        {toggleTooltip.node}

        <Header />
        <Menu />

        {/* Pinned bottom: Settings link + signed-in user with sign-out. */}
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

          {/* Signed-in user. Collapsed: avatar + sign-out icon stacked.
              Expanded: avatar + name/role with a trailing sign-out button. */}
          {collapsed ? (
            <div className="flex flex-col items-center gap-1 pt-1">
              <Link
                to="/admin/profile"
                aria-label="Your profile"
                onClick={() => lgAndDown && closeSidebar()}
                className="rounded-full ring-[var(--accent-a6)] transition hover:ring-2"
              >
                <Avatar size={9} src={user?.avatarUrl} name={user?.name}>
                  {userInitials(user?.name)}
                </Avatar>
              </Link>
              <button
                onClick={handleLogout}
                ref={signOutTooltip.ref}
                onMouseEnter={signOutTooltip.onMouseEnter}
                onMouseLeave={signOutTooltip.onMouseLeave}
                aria-label="Sign Out"
                className="flex size-8 items-center justify-center rounded-lg text-[var(--accent-11)] transition-colors hover:bg-[var(--accent-a3)] hover:text-[var(--accent-12)]"
              >
                <ArrowLeftStartOnRectangleIcon className="size-5 shrink-0" />
              </button>
              {signOutTooltip.node}
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-lg px-1 py-1">
              <Link
                to="/admin/profile"
                onClick={() => lgAndDown && closeSidebar()}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--accent-a3)]"
              >
                <Avatar size={9} src={user?.avatarUrl} name={user?.name}>
                  {userInitials(user?.name)}
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs-plus font-medium text-[var(--accent-12)]">
                    {user?.name || "User"}
                  </p>
                  {roleLabel(user?.role) && (
                    <p className="truncate text-[11px] text-[var(--accent-11)]">
                      {roleLabel(user?.role)}
                    </p>
                  )}
                </div>
              </Link>
              <button
                onClick={handleLogout}
                aria-label="Sign Out"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--accent-11)] transition-colors hover:bg-[var(--accent-a3)] hover:text-[var(--accent-12)]"
              >
                <ArrowLeftStartOnRectangleIcon className="size-5" />
              </button>
            </div>
          )}
        </div>
      </Theme>
    </div>
  );
}
