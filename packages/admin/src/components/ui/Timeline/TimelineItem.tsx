// Import Dependencies
import relativeTime from "dayjs/plugin/relativeTime";
import dayjs from "dayjs";
import clsx from "clsx";
import { ComponentPropsWithoutRef, ReactNode, forwardRef } from "react";

// Local Imports
import { useLocaleContext } from "@/app/contexts/locale/context";
import { TimelineVariant, useTimelineContext } from "./context";
import { ColorType } from "@/constants/app";

const radixColorPrefix: Record<Exclude<ColorType, "neutral">, string> = {
  primary: "accent",
  secondary: "blue",
  info: "cyan",
  success: "green",
  warning: "orange",
  error: "red",
};

// ----------------------------------------------------------------------

export type TimelineItemProps = {
  /** Child components to render in the item content */
  children?: ReactNode;
  /** Title text for the timeline item */
  title?: string;
  /** Timestamp (can be string date or number timestamp) */
  time?: string | number;
  /** Custom point/dot element */
  point?: ReactNode;
  /** Color theme for the timeline item */
  color?: ColorType;
  /** Visual style variant (overrides parent Timeline's variant) */
  variant?: TimelineVariant;
  /** Additional CSS class name */
  className?: string;
  /** Class names for different parts of the component */
  classNames?: {
    /** Class for the root element */
    root?: string;
    /** Class for the point/dot element */
    point?: string;
    /** Class for the content wrapper */
    contentWrapper?: string;
    /** Class for the title element */
    title?: string;
    /** Class for the time element */
    time?: string;
    /** Class for the content element */
    content?: string;
  };
  /** Whether to show animation ping effect */
  isPing?: boolean;
} & ComponentPropsWithoutRef<"div">;

dayjs.extend(relativeTime);

// Neutral color variants
const neutralVariant = {
  filled: "bg-[var(--gray-a7)]",
  outlined: "border-2 border-[var(--gray-a7)]",
};

/**
 * TimelineItem component representing a single entry in a Timeline
 */
const TimelineItem = forwardRef<HTMLDivElement, TimelineItemProps>(({
  children,
  title,
  time,
  point,
  color = "neutral",
  variant,
  className,
  classNames = {},
  isPing,
  ...rest
}, ref) => {
  const { locale } = useLocaleContext();
  const ctx = useTimelineContext();

  const mergedVariant = variant || ctx.variant;

  const formattedTime = dayjs(time).locale(locale).fromNow();

  const pointNode = (
    <div
      className={clsx(
        "timeline-item-point relative flex shrink-0 items-center justify-center rounded-full",
        color === "neutral"
          ? neutralVariant[mergedVariant]
          : mergedVariant === "filled"
            ? `bg-[var(--${radixColorPrefix[color]}-9)]`
            : `border-2 border-[var(--${radixColorPrefix[color]}-9)]`,
        classNames?.point,
      )}
    >
      {isPing && (
        <span className="inline-flex h-full w-full animate-ping rounded-full bg-inherit opacity-80"></span>
      )}
    </div>
  );

  return (
    <div
      className={clsx("timeline-item", className, classNames?.root)}
      ref={ref}
      {...rest}
    >
      {point ? point : pointNode}

      <div
        className={clsx(
          "timeline-item-content-wrappper",
          classNames?.contentWrapper,
        )}
      >
        <div className="flex flex-col pb-1.5">
          {title && (
            <h3
              className={clsx(
                "text-[var(--gray-12)] pb-1.5 leading-none font-medium",
                classNames?.title,
              )}
            >
              {title}
            </h3>
          )}
          {time && (
            <span
              className={clsx(
                "text-xs text-[var(--gray-a8)]",
                classNames?.time,
              )}
            >
              {formattedTime}
            </span>
          )}
        </div>
        <div
          className={clsx("timeline-item-content py-1", classNames?.content)}
        >
          {children}
        </div>
      </div>
    </div>
  );
});

TimelineItem.displayName = "TimelineItem";

export { TimelineItem };
