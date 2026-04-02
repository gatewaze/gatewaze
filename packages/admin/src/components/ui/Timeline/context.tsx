import { createSafeContext } from "@/utils/createSafeContext";

/**
 * Timeline context and hook for sharing timeline configuration between parent and children
 */

export type TimelineVariant = "filled" | "outlined";

export interface TimelineContextType {
  variant: TimelineVariant;
}

export const [TimelineContext, useTimelineContext] =
  createSafeContext<TimelineContextType>(
    "useTimelineContext must be used within TimelineProvider",
  );
