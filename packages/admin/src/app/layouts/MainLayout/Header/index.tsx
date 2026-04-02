// Import Dependencies
import clsx from "clsx";

// Local Imports
import { SidebarToggleBtn } from "@/components/shared/SidebarToggleBtn";
import { Profile } from "../Profile";

// ----------------------------------------------------------------------

export function Header() {
  return (
    <header
      className="app-header transition-content sticky top-0 z-20 flex h-[65px] shrink-0 items-center justify-between border-b border-[var(--gray-a6)] bg-[var(--color-background)]/80 pl-(--margin-x) pr-4 backdrop-blur-sm backdrop-saturate-150"
    >
      <SidebarToggleBtn />
      <div className="flex items-center gap-2">
        <Profile />
      </div>
    </header>
  );
}
