// Import Dependencies
import { Link } from "react-router";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";

// Local Imports
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui";
import { useSidebarContext } from "@/app/contexts/sidebar/context";

// ----------------------------------------------------------------------

export function Header() {
  const { close } = useSidebarContext();
  return (
    <header className="relative flex h-[72px] shrink-0 items-center justify-center px-3">
      <Link
        to="/"
        className="flex h-14 w-36 items-center justify-center"
      >
        <BrandLogo
          type="logotype"
          variant="light"
          className="max-h-full max-w-full text-[var(--brand-accent)]"
        />
      </Link>
      <div className="absolute right-3 pt-5 xl:hidden">
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
