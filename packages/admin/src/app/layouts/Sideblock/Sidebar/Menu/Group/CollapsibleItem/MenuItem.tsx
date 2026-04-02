// Import Dependencies
import clsx from "clsx";
import { NavLink, useRouteLoaderData } from "react-router";
import invariant from "tiny-invariant";
import { useTranslation } from "react-i18next";

// Local Imports
import { Badge } from "@/components/ui";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { NavigationTree } from "@/@types/navigation";

// ----------------------------------------------------------------------

export function MenuItem({ data }: { data: NavigationTree }) {
  const { id, transKey, path, title } = data;
  const { t } = useTranslation();
  const { lgAndDown } = useBreakpointsContext();
  const { close } = useSidebarContext();

  invariant(path, `[MenuItem] Path is required for navigation item`);

  const label = transKey ? t(transKey) : title;
  const info = useRouteLoaderData("root")?.[id]?.info;

  const handleMenuItemClick = () => lgAndDown && close();

  return (
    <div className="relative flex">
      <NavLink
        to={path}
        onClick={handleMenuItemClick}
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
          <div
            data-menu-active={isActive}
            className="flex min-w-0 items-center justify-between gap-2.5 text-xs-plus tracking-wide"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={clsx(
                  isActive
                    ? "bg-[var(--brand-accent)] opacity-80"
                    : "bg-[var(--accent-a6)] opacity-50 transition-all",
                  "size-2 rounded-full border border-current",
                )}
              />
              <span className="truncate">{label}</span>
            </div>
            {info && info.val && (
              <Badge
                color={info.color}
                className="h-5 min-w-[1.25rem] shrink-0 rounded-full p-[5px]"
              >
                {info.val}
              </Badge>
            )}
          </div>
        )}
      </NavLink>
    </div>
  );
}
