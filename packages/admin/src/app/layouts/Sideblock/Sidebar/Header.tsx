// Import Dependencies
import { Link } from "react-router";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import { ChevronFirst, ChevronLast } from "lucide-react";
import clsx from "clsx";

// Local Imports
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { useRailTooltip } from "./useRailTooltip";

// ----------------------------------------------------------------------

export function Header() {
  const { close, isCollapsed, toggleCollapsed } = useSidebarContext();
  const { xlAndUp } = useBreakpointsContext();
  const collapsed = isCollapsed && xlAndUp;
  const expanded = !isCollapsed && xlAndUp;

  const expandTooltip = useRailTooltip(collapsed, "Expand sidebar");
  const collapseTooltip = useRailTooltip(expanded, "Collapse sidebar");

  return (
    <header
      className={clsx(
        "relative flex h-[72px] shrink-0 items-center",
        collapsed
          ? "justify-center px-2"
          : "justify-start ltr:pl-5 ltr:pr-4 rtl:pr-5 rtl:pl-4",
      )}
    >
      <Link to="/" className="flex items-center" aria-label="Home">
        {collapsed ? (
          <BrandLogo type="logo" variant="light" className="h-8 w-auto" />
        ) : (
          <BrandLogo
            type="logotype"
            variant="light"
            className="h-8 w-auto max-w-[9.5rem]"
          />
        )}
      </Link>

      {/* Desktop collapse/expand toggle. Collapsed: a circle straddling the
          right edge (half on, half off). Expanded: an in-menu button
          right-aligned next to the logo. */}
      {collapsed ? (
        <>
          <button
            onClick={toggleCollapsed}
            ref={expandTooltip.ref}
            onMouseEnter={expandTooltip.onMouseEnter}
            onMouseLeave={expandTooltip.onMouseLeave}
            aria-label="Expand sidebar"
            className="absolute top-1/2 z-10 hidden size-6 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--accent-2)] text-white shadow-md transition-colors hover:bg-[var(--accent-3)] ltr:right-0 ltr:translate-x-1/2 rtl:left-0 rtl:-translate-x-1/2 xl:flex"
          >
            <ChevronLast className="size-4 rtl:rotate-180" />
          </button>
          {expandTooltip.node}
        </>
      ) : (
        <>
          <button
            onClick={toggleCollapsed}
            ref={collapseTooltip.ref}
            onMouseEnter={collapseTooltip.onMouseEnter}
            onMouseLeave={collapseTooltip.onMouseLeave}
            aria-label="Collapse sidebar"
            className="absolute top-1/2 hidden size-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--accent-11)] transition-colors hover:bg-[var(--accent-a3)] hover:text-[var(--accent-12)] ltr:right-3 rtl:left-3 xl:flex"
          >
            <ChevronFirst className="size-5 rtl:rotate-180" />
          </button>
          {collapseTooltip.node}
        </>
      )}

      {/* Mobile overlay close */}
      <div className="absolute ltr:right-3 rtl:left-3 xl:hidden">
        <Button
          onClick={close}
          variant="ghost"
          isIcon
          className="size-6 rounded-full"
        >
          <ChevronLeftIcon className="size-5 rtl:rotate-180" />
        </Button>
      </div>
    </header>
  );
}
