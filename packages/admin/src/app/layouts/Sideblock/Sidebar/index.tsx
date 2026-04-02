// Import Dependencies
import { Portal } from "@headlessui/react";
import { ArrowLeftStartOnRectangleIcon } from "@heroicons/react/24/outline";
import { Theme } from "@radix-ui/themes";

// Local Imports
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { useAuthContext } from "@/app/contexts/auth/context";
import { useDidUpdate } from "@/hooks";
import { Header } from "./Header";
import { Menu } from "./Menu";

// ----------------------------------------------------------------------

export function Sidebar() {
  const { logout } = useAuthContext();
  const { name, lgAndDown } = useBreakpointsContext();

  const { isExpanded: isSidebarExpanded, close: closeSidebar } =
    useSidebarContext();

  useDidUpdate(() => {
    if (isSidebarExpanded) closeSidebar();
  }, [name]);

  const handleLogout = () => {
    logout();
  };

  return (
    <div
      className="sidebar-panel"
    >
      <Theme
        appearance="dark"
        accentColor="gray"
        className="flex h-full grow flex-col bg-[var(--accent-2)] border-[var(--accent-a4)] ltr:border-r rtl:border-l"
      >
        <Header />
        <Menu />

        {/* Sign Out Button */}
        <div className="mt-auto p-4 border-t border-[var(--accent-a4)]">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-xs-plus tracking-wide font-medium text-[var(--accent-11)] hover:text-[var(--accent-12)] hover:bg-[var(--accent-a3)] rounded-lg transition-colors"
          >
            <ArrowLeftStartOnRectangleIcon className="size-5" />
            <span>Sign Out</span>
          </button>
        </div>
      </Theme>

      {lgAndDown && isSidebarExpanded && (
        <Portal>
          <div
            onClick={closeSidebar}
            className="fixed inset-0 z-20 bg-gray-900/50 backdrop-blur-sm transition-opacity dark:bg-black/40"
          />
        </Portal>
      )}
    </div>
  );
}
