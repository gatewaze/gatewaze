// Import Dependencies
import { Link } from "react-router";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";

// Local Imports
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";

// ----------------------------------------------------------------------

// The desktop collapse/expand toggle lives in the Sidebar shell (so it can
// slide between the rail-top and the logo row); the Header just renders the
// brand and the mobile overlay-close control.
export function Header() {
  const { close, isCollapsed } = useSidebarContext();
  const { xlAndUp } = useBreakpointsContext();
  const collapsed = isCollapsed && xlAndUp;

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
