// Import Dependencies
import { ChevronRightIcon, ChevronLeftIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router";
import invariant from "tiny-invariant";

// Local Imports
import {
  AccordionButton,
  AccordionItem,
  AccordionPanel,
} from "@/components/ui";
import { isRtl } from "@/utils/localeUtils";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { type NavigationTree } from "@/@types/navigation";
import { navigationIcons } from "@/app/navigation/icons";

// ----------------------------------------------------------------------

export function CollapsibleItem({ data }: { data: NavigationTree }) {
  const { id, path, transKey, icon, childs, title } = data;
  const { t } = useTranslation();
  const { lgAndDown } = useBreakpointsContext();
  const { close } = useSidebarContext();

  invariant(
    childs && childs.length > 0,
    `[CollapsibleItem] At least one child item is required for collapsible menu: ${id}`,
  );

  const label = transKey ? t(transKey) : title;
  const ChevronIcon = isRtl ? ChevronLeftIcon : ChevronRightIcon;
  const { pathname } = useLocation();

  // Icon is optional — user-created groups may have none.
  const Icon = icon ? navigationIcons[icon] : undefined;
  const hasActiveChild = childs.some((child) => child.path && pathname.startsWith(child.path));
  const handleChildClick = () => lgAndDown && close();

  return (
    <AccordionItem
      value={path ?? id}
      className="relative flex flex-1 flex-col px-3"
    >
      {({ open }) => (
        <>
          {hasActiveChild && !open && (
            <div className="absolute bottom-1 top-1 w-1 bg-[var(--brand-accent)] ltr:left-0 ltr:rounded-r-full rtl:right-0 rtl:rounded-l-lg" />
          )}
          <AccordionButton
            className={clsx(
              "group flex flex-1 cursor-pointer items-center justify-between rounded-md px-3 py-2 font-medium outline-hidden transition-colors duration-300 ease-in-out",
              open || hasActiveChild
                ? "text-[var(--accent-12)]"
                : "text-[var(--accent-11)] hover:bg-[var(--accent-a3)] hover:text-[var(--accent-12)] focus:bg-[var(--accent-a3)] focus:text-[var(--accent-12)]",
            )}
          >
            <div className="flex min-w-0 items-center gap-3 text-xs-plus tracking-wide">
              {Icon && (
                <Icon
                  className={clsx(
                    "size-5 shrink-0 stroke-[1.5]",
                    !open && "opacity-80 group-hover:opacity-100",
                  )}
                />
              )}
              <span className="truncate">{label}</span>
            </div>
            <ChevronIcon
              className={clsx(
                "size-4 shrink-0 transition-transform",
                open && "ltr:rotate-90 rtl:-rotate-90",
              )}
            />
          </AccordionButton>
          {/* Compact, icon-less text children (indented under the parent). */}
          <AccordionPanel className="flex flex-col py-0.5">
            {childs.map((child) =>
              child.path ? (
                <NavLink
                  key={child.id}
                  to={child.path}
                  onClick={handleChildClick}
                  className={({ isActive }) =>
                    clsx(
                      "truncate rounded-md py-1.5 text-xs-plus tracking-wide transition-colors ltr:pl-9 ltr:pr-3 rtl:pr-9 rtl:pl-3",
                      isActive
                        ? "font-medium text-[var(--accent-12)]"
                        : "text-[var(--accent-11)] hover:bg-[var(--accent-a3)] hover:text-[var(--accent-12)]",
                    )
                  }
                >
                  {child.transKey ? t(child.transKey) : child.title}
                </NavLink>
              ) : null,
            )}
          </AccordionPanel>
        </>
      )}
    </AccordionItem>
  );
}
