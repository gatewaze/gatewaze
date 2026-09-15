// Import Dependencies
import { ReactNode, useEffect, useRef, useState } from "react";

// Local Imports
import { breakpoints } from "@/configs/breakpoints";
import { isServer } from "@/utils/isServer";
import { BreakpointsContext, type BreakpointsContextType } from "./context";

// ----------------------------------------------------------------------

export interface BreakpointProviderProps {
  children: ReactNode;
  /**
   * Observe this element's size instead of `document.documentElement`.
   * Used by the embed entry point so breakpoint state tracks the host's
   * mount container rather than the whole browser viewport, matching
   * the theme provider's containment behavior.
   */
  container?: HTMLElement | null;
}

export function BreakpointProvider({ children, container }: BreakpointProviderProps) {
  const [breakpointState, setBreakpointState] = useState<BreakpointsContextType>(
    getBreakpoint(container ? container.getBoundingClientRect().width : undefined),
  );

  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (isServer) return;

    // When observing a container (embed mode), use its own box width from
    // the ResizeObserver entry rather than window.innerWidth — the host
    // page's viewport is typically wider than the embedded mount point.
    const updateBreakpoint = (entries?: ResizeObserverEntry[]) => {
      const width = container ? entries?.[0]?.contentRect.width : undefined;
      const current = getBreakpoint(width);
      setBreakpointState((prev) => (prev.name === current.name ? prev : current));
    };

    resizeObserverRef.current = new ResizeObserver(updateBreakpoint);
    resizeObserverRef.current.observe(container ?? document.documentElement);

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [container]);

  if (!children) {
    return null;
  }

  return (
    <BreakpointsContext value={breakpointState}>{children}</BreakpointsContext>
  );
}

// Function to get the current breakpoint state. `widthOverride` lets a
// container-scoped provider (embed mode) compute against its own box
// width instead of the browser viewport.
function getBreakpoint(widthOverride?: number) {
  if (isServer) {
    return {
      name: "",
      isXs: false,
      isSm: false,
      isMd: false,
      isLg: false,
      isXl: false,
      is2xl: false,
      smAndDown: false,
      smAndUp: false,
      mdAndDown: false,
      mdAndUp: false,
      lgAndDown: false,
      lgAndUp: false,
      xlAndDown: false,
      xlAndUp: false,
      ...breakpoints,
    };
  }

  const width = widthOverride ?? window.innerWidth;

  let name = "";

  const xs = width < breakpoints.SM;
  const sm = width < breakpoints.MD && !xs;
  const md = width < breakpoints.LG && !(sm || xs);
  const lg = width < breakpoints.XL && !(md || sm || xs);
  const xl = width < breakpoints["2XL"] && !(lg || md || sm || xs);
  const the2xl = width >= breakpoints["2XL"];

  if (xs) name = "xs";
  if (sm) name = "sm";
  if (md) name = "md";
  if (lg) name = "lg";
  if (xl) name = "xl";
  if (the2xl) name = "2xl";

  return {
    name,

    isXs: xs,
    isSm: sm,
    isMd: md,
    isLg: lg,
    isXl: xl,
    is2xl: the2xl,

    smAndDown: xs || sm,
    smAndUp: sm || md || lg || xl || the2xl,
    mdAndDown: xs || sm || md,
    mdAndUp: md || lg || xl || the2xl,
    lgAndDown: xs || sm || md || lg,
    lgAndUp: lg || xl || the2xl,
    xlAndDown: xs || sm || md || lg || xl,
    xlAndUp: xl || the2xl,

    ...breakpoints,
  };
}
