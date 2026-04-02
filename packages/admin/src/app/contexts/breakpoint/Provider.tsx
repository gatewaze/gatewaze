// Import Dependencies
import { ReactNode, useEffect, useRef, useState } from "react";

// Local Imports
import { breakpoints } from "@/configs/breakpoints";
import { isServer } from "@/utils/isServer";
import { BreakpointsContext, type BreakpointsContextType } from "./context";

// ----------------------------------------------------------------------

export function BreakpointProvider({ children }: { children: ReactNode }) {
  const [breakpointState, setBreakpointState] =
    useState<BreakpointsContextType>(getBreakpoint());

  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    // Function to update breakpoint based on current width
    const updateBreakpoint = () => {
      const current = getBreakpoint();
      if (current.name !== breakpointState.name) {
        setBreakpointState(current);
      }
    };

    if (!isServer) {
      // Initialize ResizeObserver on the document's root element
      resizeObserverRef.current = new ResizeObserver(updateBreakpoint);
      resizeObserverRef.current.observe(document.documentElement);
    }

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [breakpointState.name]);

  if (!children) {
    return null;
  }

  return (
    <BreakpointsContext value={breakpointState}>{children}</BreakpointsContext>
  );
}

// Function to get the current breakpoint state
function getBreakpoint() {
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

  const width = window.innerWidth;

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
