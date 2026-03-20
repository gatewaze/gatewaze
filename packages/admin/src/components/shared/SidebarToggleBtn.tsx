// Import Dependencies
import clsx from "clsx";

// Local Imports
import { useSidebarContext } from "@/app/contexts/sidebar/context";

// ----------------------------------------------------------------------

export function SidebarToggleBtn() {
  const { toggle, isExpanded } = useSidebarContext();

  return (
    <button
      onClick={toggle}
      className={clsx(
        isExpanded && "active",
        "sidebar-toggle-btn cursor-pointer flex size-7 flex-col justify-center space-y-1.5 text-primary-600 outline-hidden focus:outline-hidden dark:text-primary-400 ltr:ml-0.5 rtl:mr-0.5",
      )}
    >
      <span />
      <span />
      <span />
    </button>
  );
}
