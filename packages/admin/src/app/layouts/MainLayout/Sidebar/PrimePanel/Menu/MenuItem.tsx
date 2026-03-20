// Import Dependencies
import { NavLink, useRouteLoaderData } from "react-router";
import clsx from "clsx";
import { useTranslation } from "react-i18next";

// Local Imports
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { Badge } from "@/components/ui";
import { NavigationTree } from "@/@types/navigation";
import { ColorType } from "@/constants/app";
import { navigationIcons } from "@/app/navigation/icons";

// ----------------------------------------------------------------------

export function MenuItem({ data }: { data: NavigationTree  }) {
  const { path, transKey, id, title: defaultTitle, icon } = data;
  const Icon = icon ? navigationIcons[icon] : undefined;

  const { t } = useTranslation();
  const { lgAndDown } = useBreakpointsContext();
  const { close } = useSidebarContext();
  const title = t(transKey ?? "") || defaultTitle;

  const info = useRouteLoaderData("root")?.[id]?.info as
    | { val?: string; color?: ColorType }
    | undefined;

  const handleMenuItemClick = () => {
    if (lgAndDown) close();
  };

  return (
    <NavLink
      to={path as string}
      onClick={handleMenuItemClick}
      className={({ isActive }) =>
        clsx(
          "outline-hidden transition-colors duration-300 ease-in-out",
          isActive
            ? "font-medium text-white"
            : "text-white/70 hover:text-white",
        )
      }
    >
      {({ isActive }) => (
        <div
          data-menu-active={isActive}
          style={{ height: "34px" }}
          className="flex items-center justify-between text-xs-plus tracking-wide"
        >
          {Icon && <Icon className="size-4 mr-2 shrink-0" />}
          <span className="mr-1 truncate">{title}</span>
          {info?.val && (
            <Badge
              color={info.color}
              variant="soft"
              className="h-4.5 min-w-[1rem] shrink-0 p-[5px] text-tiny-plus"
            >
              {info.val}
            </Badge>
          )}
        </div>
      )}
    </NavLink>
  );
}
