import { createSafeContext } from "@/utils/createSafeContext";

export interface SidebarContextValue {
  /** Mobile overlay open/close state. */
  isExpanded: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  /** Desktop icon-rail preference (persisted across reloads). */
  isCollapsed: boolean;
  toggleCollapsed: () => void;
}

export const [SidebarContext, useSidebarContext] =
  createSafeContext<SidebarContextValue>(
    "useSidebarContext must be used within SidebarProvider"
  );
