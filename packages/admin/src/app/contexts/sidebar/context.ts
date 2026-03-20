import { createSafeContext } from "@/utils/createSafeContext";

export interface SidebarContextValue {
  isExpanded: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

export const [SidebarContext, useSidebarContext] =
  createSafeContext<SidebarContextValue>(
    "useSidebarContext must be used within SidebarProvider"
  );
