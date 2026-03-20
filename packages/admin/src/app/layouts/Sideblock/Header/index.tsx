// Import Dependencies

// Local Imports
import { SidebarToggleBtn } from "@/components/shared/SidebarToggleBtn";

// ----------------------------------------------------------------------

export function Header() {
  return (
    <header
      className="app-header transition-content sticky top-0 z-20 flex h-[50px] items-center gap-1 border-b border-[var(--gray-a6)] bg-[var(--color-background)]/80 pl-(--margin-x) pr-4 backdrop-blur-sm backdrop-saturate-150 xl:hidden"
    >
      <SidebarToggleBtn />
    </header>
  );
}
