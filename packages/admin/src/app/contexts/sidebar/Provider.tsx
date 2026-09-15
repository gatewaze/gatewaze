import { ReactNode, useCallback, useLayoutEffect } from "react";

import { useDisclosure, useDidUpdate, useLocalStorage } from "@/hooks";
import { useBreakpointsContext } from "../breakpoint/context";
import { SidebarContext } from "./context";

export interface SidebarProviderProps {
  children: ReactNode;
  /**
   * Scope the sidebar-state classes to this element instead of
   * `document.body`. Used by the embed entry point (containment
   * requirement) — omit for the normal app.
   */
  container?: HTMLElement | null;
}

export function SidebarProvider({ children, container }: SidebarProviderProps) {
  const { xlAndUp, lgAndDown, name } = useBreakpointsContext();

  const [isExpanded, { open, close, toggle }] = useDisclosure(xlAndUp);

  const [isCollapsed, setIsCollapsed] = useLocalStorage<boolean>(
    "sidebar-collapsed",
    false,
  );
  const toggleCollapsed = useCallback(
    () => setIsCollapsed((value) => !value),
    [setIsCollapsed],
  );

  useDidUpdate(() => {
    if (lgAndDown) {
      close();
    }
  }, [name]);

  useLayoutEffect(() => {
    const target = container ?? document?.body;
    if (target) {
      if (isExpanded) {
        target.classList.add("is-sidebar-open");
      } else {
        target.classList.remove("is-sidebar-open");
      }
    }
  }, [isExpanded, container]);

  useLayoutEffect(() => {
    const target = container ?? document?.body;
    if (target) {
      if (isCollapsed) {
        target.classList.add("is-sidebar-collapsed");
      } else {
        target.classList.remove("is-sidebar-collapsed");
      }
    }
  }, [isCollapsed, container]);

  if (!children) {
    return null;
  }

  return (
    <SidebarContext
      value={{
        isExpanded,
        toggle,
        open,
        close,
        isCollapsed,
        toggleCollapsed,
      }}
    >
      {children}
    </SidebarContext>
  );
}
