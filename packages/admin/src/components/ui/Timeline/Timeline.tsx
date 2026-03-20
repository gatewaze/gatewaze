// Import Dependencies
import { CSSProperties, ReactNode } from "react";
import clsx from "clsx";

// Local Imports
import { TimelineContext, TimelineVariant } from "./context";

// ----------------------------------------------------------------------

/**
 * Timeline component that provides vertical connected timeline visualization
 */

/**
 * Props definition for the Timeline component
 */
export interface TimelineProps {
  /** Additional CSS class names */
  className?: string;
  /** Size of the timeline point/dot (CSS value) */
  pointSize?: string;
  /** Width of the timeline connecting line (CSS value) */
  lineWidth?: string;
  /** Visual style variant */
  variant?: TimelineVariant;
  /** Space between timeline items (CSS value) */
  lineSpace?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Child components */
  children?: ReactNode;
}

const Timeline = (props: TimelineProps) => {
  const {
    className,
    pointSize = "0.75rem",
    lineWidth = "1px",
    variant = "filled",
    lineSpace,
    style,
    children,
  } = props;

  return (
    <TimelineContext value={{ variant }}>
      <div
        className={clsx(
          "timeline flex flex-col",
          lineSpace && "line-space",
          className,
        )}
        style={
          {
            "--timeline-point-size": pointSize,
            "--timeline-line-width": lineWidth,
            "--timeline-line-space": lineSpace,
            ...style,
          } as CSSProperties
        }
      >
        {children}
      </div>
    </TimelineContext>
  );
};

Timeline.displayName = "Timeline";

export { Timeline };
