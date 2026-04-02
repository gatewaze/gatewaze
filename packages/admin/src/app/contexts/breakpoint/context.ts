import { createSafeContext } from "@/utils/createSafeContext";

export interface BreakpointsContextType {
  name: string;
  isXs: boolean;
  isSm: boolean;
  isMd: boolean;
  isLg: boolean;
  isXl: boolean;
  is2xl: boolean;
  smAndDown: boolean;
  smAndUp: boolean;
  mdAndDown: boolean;
  mdAndUp: boolean;
  lgAndDown: boolean;
  lgAndUp: boolean;
  xlAndDown: boolean;
  xlAndUp: boolean;
  SM: number;
  MD: number;
  LG: number;
  XL: number;
  "2XL": number;
}

export const [BreakpointsContext, useBreakpointsContext] =
  createSafeContext<BreakpointsContextType>(
    "useBreakpointsContext must be used within BreakpointsContext",
  );
