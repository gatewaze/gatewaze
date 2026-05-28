// Import Dependencies
import clsx from "clsx";
import { NavLink, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";

// Local Imports
import { Badge } from "@/components/ui";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { type NavigationTree } from "@/@types/navigation";
import { navigationIcons } from "@/app/navigation/icons";
import { useRailTooltip } from "../../useRailTooltip";

// ----------------------------------------------------------------------

export function MenuItem({ data }: { data: NavigationTree }) {
  const { icon, path, id, transKey, title } = data;
  const { lgAndDown, xlAndUp } = useBreakpointsContext();
  const { close, isCollapsed } = useSidebarContext();
  const { t } = useTranslation();

  invariant(path, "[MenuItem] path is required but not found");

  const Icon = icon ? navigationIcons[icon] : undefined;
  if (icon && !Icon) {
    console.warn(`[MenuItem] Icon "${icon}" not found in navigationIcons`);
  }

  const label = transKey ? t(transKey) : title;

  const info = useRouteLoaderData("root")?.[id]?.info;

  const handleMenuItemClick = () => lgAndDown && close();

  const collapsed = isCollapsed && xlAndUp;
  const tooltip = useRailTooltip(collapsed && !!label, label ?? "");

  return (
    <div
      className="relative flex px-3"
      ref={tooltip.ref}
      onMouseEnter={tooltip.onMouseEnter}
      onMouseLeave={tooltip.onMouseLeave}
    >
      <NavLink
        to={path}
        onClick={handleMenuItemClick}
        aria-label={collapsed ? label : undefined}
        className={({ isActive }) =>
          clsx(
            "group min-w-0 flex-1 rounded-md px-3 py-2 font-medium outline-hidden transition-colors ease-in-out",
            isActive
              ? "text-[var(--accent-12)]"
              : "text-[var(--accent-11)] hover:bg-[var(--accent-a3)] hover:text-[var(--accent-12)] focus:bg-[var(--accent-a3)] focus:text-[var(--accent-12)]",
          )
        }
      >
        {({ isActive }) => (
          <>
            <div
              data-menu-active={isActive}
              className={clsx(
                "flex min-w-0 items-center gap-2 text-xs-plus tracking-wide",
                collapsed ? "justify-center" : "justify-between",
              )}
            >
              <div
                className={clsx(
                  "flex min-w-0 items-center",
                  !collapsed && "gap-3",
                )}
              >
                {Icon && (
                  <Icon
                    className={clsx(
                      "size-5 shrink-0 stroke-[1.5]",
                      !isActive && "opacity-80 group-hover:opacity-100",
                    )}
                  />
                )}
                {!collapsed && <span className="truncate">{label}</span>}
              </div>
              {!collapsed && info && info.val && (
                <Badge
                  color={info.color}
                  variant="soft"
                  className="h-4.5 min-w-[1rem] shrink-0 p-[5px] text-tiny-plus"
                >
                  {info.val}
                </Badge>
              )}
            </div>
            {collapsed && info && info.val && (
              <span className="absolute right-2 top-1.5 size-2 rounded-full bg-[var(--brand-accent)]" />
            )}
            {isActive && (
              <div className="absolute bottom-1 top-1 w-1 bg-[var(--brand-accent)] ltr:left-0 ltr:rounded-r-full rtl:right-0 rtl:rounded-l-lg" />
            )}
          </>
        )}
      </NavLink>
      {tooltip.node}
    </div>
  );
}
