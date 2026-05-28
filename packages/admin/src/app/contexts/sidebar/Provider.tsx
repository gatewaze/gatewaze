import { ReactNode, useCallback, useLayoutEffect } from "react";

import { useDisclosure, useDidUpdate, useLocalStorage } from "@/hooks";
import { useBreakpointsContext } from "../breakpoint/context";
import { SidebarContext } from "./context";

export function SidebarProvider({ children }: { children: ReactNode }) {
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
    const documentBody = document?.body;
    if (documentBody) {
      if (isExpanded) {
        documentBody.classList.add("is-sidebar-open");
      } else {
        documentBody.classList.remove("is-sidebar-open");
      }
    }
  }, [isExpanded]);

  useLayoutEffect(() => {
    const documentBody = document?.body;
    if (documentBody) {
      if (isCollapsed) {
        documentBody.classList.add("is-sidebar-collapsed");
      } else {
        documentBody.classList.remove("is-sidebar-collapsed");
      }
    }
  }, [isCollapsed]);

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
