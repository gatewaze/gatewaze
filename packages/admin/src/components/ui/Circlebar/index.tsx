import clsx from "clsx";
import { Children, useMemo, forwardRef, ForwardedRef, CSSProperties } from "react";
import { getPathStyles } from "./getPathStyles";
import { randomId } from "@/utils/randomId";
import { ColorType } from "@/constants/app";

const radixColorPrefix: Record<string, string> = {
  primary: "accent",
  secondary: "blue",
  info: "cyan",
  success: "green",
  warning: "orange",
  error: "red",
};

interface GradientConfig {
  start: string;
  end: string;
}

type CirclebarOwnProps = {
  offsetDegree?: number;
  gapDegree?: number;
  gapOffsetDegree?: number;
  strokeWidth?: number;
  strokeLinecap?: "butt" | "round" | "square";
  isActive?: boolean;
  size?: number;
  showRail?: boolean;
  color?: ColorType;
  contentProps?: React.HTMLAttributes<HTMLDivElement>;
  rootProps?: React.HTMLAttributes<HTMLDivElement>;
  wrapperProps?: React.HTMLAttributes<HTMLDivElement>;
  className?: string;
  classNames?: {
    root?: string;
    wrapper?: string;
    svg?: string;
    content?: string;
  };
  /** Content to display inside the circle */
  children?: React.ReactNode;
}

/**
 * Props for the Circlebar component with all variations.
 * 
 * Requirements:
 * 1. When `isIndeterminate` is false/undefined, `value` is required
 * 2. When `variant` is "gradient", `gradient` config is required
 */
type CirclebarProps = (
  // When indeterminate is true, value is optional
  | (CirclebarOwnProps & {
    /** 
     * Set to true for an indeterminate loading state.
     * When true, the `value` prop becomes optional.
     */
    isIndeterminate: true;
    /** 
     * Current progress value (0-100).
     * Optional when in indeterminate mode.
     */
    value?: number;
    /** Visual style variant */
    variant?: "default" | "soft";
    /** 
     * Gradient configuration (optional for default/soft variants)
     */
    gradient?: GradientConfig;
  })
  | (CirclebarOwnProps & {
    /** 
     * Set to true for an indeterminate loading state.
     * When true, the `value` prop becomes optional.
     */
    isIndeterminate: true;
    /** 
     * Current progress value (0-100).
     * Optional when in indeterminate mode.
     */
    value?: number;
    /** 
     * Visual style variant.
     * When set to "gradient", requires gradient config.
     */
    variant: "gradient";
    /** 
     * Gradient configuration.
     * REQUIRED when variant is "gradient".
     */
    gradient: GradientConfig;
  })
  // When indeterminate is false/undefined, value is required
  | (CirclebarOwnProps & {
    /** 
     * Set to false for a determinate progress circle.
     * When false, the `value` prop is required.
     */
    isIndeterminate?: false;
    /** 
     * Current progress value (0-100).
     * REQUIRED when not in indeterminate mode.
     */
    value: number;
    /** Visual style variant */
    variant?: "default" | "soft";
    /** 
     * Gradient configuration (optional for default/soft variants)
     */
    gradient?: GradientConfig;
  })
  | (CirclebarOwnProps & {
    /** 
     * Set to false for a determinate progress circle.
     * When false, the `value` prop is required.
     */
    isIndeterminate?: false;
    /** 
     * Current progress value (0-100).
     * REQUIRED when not in indeterminate mode.
     */
    value: number;
    /** 
     * Visual style variant.
     * When set to "gradient", requires gradient config.
     */
    variant: "gradient";
    /** 
     * Gradient configuration.
     * REQUIRED when variant is "gradient".
     */
    gradient: GradientConfig;
  })
);

/**
 * Circlebar Component
 * @requires value - Required when isIndeterminate is false/undefined
 * @requires gradient - Required when variant is "gradient"
 */

export const Circlebar = forwardRef<HTMLDivElement, CirclebarProps>(({
  value,
  isIndeterminate = false,
  offsetDegree,
  gapDegree = 0,
  gapOffsetDegree = 0,
  strokeWidth = 6,
  strokeLinecap = "round",
  isActive = false,
  size = 24,
  showRail = true,
  children,
  color = "neutral",
  variant = "default",
  contentProps = {},
  rootProps = {},
  wrapperProps = {},
  className,
  classNames = {},
  gradient,
  ...rest
}, ref: ForwardedRef<HTMLDivElement>) => {
  if (!isIndeterminate && value === undefined) {
    console.error(
      `Circlebar Error: 'value' prop is required when 'isIndeterminate' is false.
      Please provide a number value between 0-100 to display the progress circle.`
    );
  }

  if (variant === 'gradient' && !gradient) {
    console.error(
      `Circlebar Error: 'gradient' prop is required when 'variant' is "gradient".
      Please provide a gradient config with { start: string, end: string } format.`
    );
  }

  if (value !== undefined && (value < 0 || value > 100)) {
    console.warn(
      `Circlebar Warning: 'value' should be between 0 and 100, got ${value}.
      Values outside this range may cause unexpected display issues.`
    );
  }

  const gradientId = `gradient-${randomId()}`;
  const viewBoxSize = 100 + strokeWidth;

  const { pathString: railPathString, pathStyle: railPathStyle } = useMemo(
    () => getPathStyles(100, 0, gapDegree, strokeWidth),
    [gapDegree, strokeWidth],
  );

  const { pathString: fillPathString, pathStyle: fillPathStyle } = useMemo(
    () => getPathStyles(value || 0, offsetDegree, gapDegree, strokeWidth),
    [gapDegree, offsetDegree, strokeWidth, value],
  );

  const strokeColor = color !== "neutral" ? radixColorPrefix[color] : null;
  const strokeClass = [
    variant === "gradient"
      ? ""
      : color === "neutral"
        ? "stroke-[var(--gray-9)]"
        : `stroke-[var(--${strokeColor}-9)]`,
  ];

  return (
    <div className={clsx("max-w-full", classNames?.root)} {...rootProps} ref={ref}>
      <div
        {...wrapperProps}
        className={clsx(
          "circlebar-wrapper relative inline-block",
          classNames?.wrapper,
        )}
        style={{ width: `${size / 4}rem`, height: `${size / 4}rem` }}
      >
        <svg
          style={{
            transform: gapOffsetDegree
              ? `rotate(${gapOffsetDegree}deg)`
              : undefined,
          }}
          viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
          className={clsx(
            "circlebar-svg",
            isIndeterminate && "circlebar-indeterminate-wrapper",
            className,
            classNames?.svg,
          )}
          {...rest}
        >
          {showRail && (
            <path
              d={railPathString}
              strokeWidth={strokeWidth}
              strokeLinecap={strokeLinecap}
              fill="none"
              style={railPathStyle}
              className={clsx("circlebar-rail-path", [
                color === "neutral" || variant !== "soft"
                  ? "stroke-[var(--gray-a4)]"
                  : `stroke-[var(--${strokeColor}-a3)]`,
              ])}
            />
          )}

          {!isIndeterminate ? (
            <>
              <path
                d={fillPathString}
                strokeWidth={strokeWidth}
                strokeLinecap={strokeLinecap}
                fill="none"
                style={{
                  ...fillPathStyle,
                  transitionProperty: "stroke-dasharray",
                  transitionDuration: "200ms",
                }}
                className={clsx("circlebar-inner-path ease-out", strokeClass)}
                stroke={
                  variant === "gradient" ? `url(#${gradientId})` : undefined
                }
              />

              {isActive && (
                <path
                  d={fillPathString}
                  strokeWidth={strokeWidth}
                  strokeLinecap={strokeLinecap}
                  fill="none"
                  style={{
                    ...fillPathStyle,
                    ["--dashoffset" as string]: `${((value || 0) / 100) * (Math.PI * 100 - gapDegree)
                      }px`,
                    transformOrigin: "center",
                    transform: `rotate(${(gapDegree / 2) * 1.15}deg)`,
                  }}
                  className="circlebar-active-path stroke-white"
                />
              )}
            </>
          ) : (
            <circle
              cx={viewBoxSize / 2}
              cy={viewBoxSize / 2}
              r="50"
              fill="none"
              strokeWidth={strokeWidth}
              className={clsx("circlebar-indeterminate", strokeClass)}
              stroke={
                variant === "gradient" ? `url(#${gradientId})` : undefined
              }
            />
          )}

          {variant === "gradient" && gradient && (
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop
                  offset="0%"
                  style={{ stopColor: gradient.start, stopOpacity: 1 }}
                />
                <stop
                  offset="100%"
                  style={{ stopColor: gradient.end, stopOpacity: 1 }}
                />
              </linearGradient>
            </defs>
          )}
        </svg>
        {Children.count(children) > 0 && (
          <div
            className={clsx(
              "absolute inset-0 flex items-center justify-center",
              classNames?.content,
            )}
            {...contentProps}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
});

Circlebar.displayName = "Circlebar";
