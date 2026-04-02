import { ComponentPropsWithoutRef, forwardRef, ForwardedRef } from "react";
import { Spinner as RadixSpinner } from "@radix-ui/themes";
import clsx from "clsx";

import { ColorType } from "@/constants/app";

export type SpinnerProps = {
  animate?: boolean;
  isElastic?: boolean;
  disabled?: boolean;
  variant?: "default" | "soft" | "innerDot";
  color?: ColorType;
  unstyled?: boolean;
  className?: string;
} & ComponentPropsWithoutRef<"div">;

const colorMap: Record<string, string | undefined> = {
  primary: undefined, // uses accent color (brand default)
  secondary: "blue",
  info: "cyan",
  success: "green",
  warning: "orange",
  error: "red",
  neutral: "gray",
};

const Spinner = forwardRef(
  (
    {
      className,
      animate = true,
      disabled,
      color = "neutral",
      // Preserved in type for backwards compat, but no longer used
      isElastic: _isElastic,
      variant: _variant,
      unstyled: _unstyled,
      ...rest
    }: SpinnerProps,
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    const radixColor = colorMap[color];

    return (
      <div
        ref={ref}
        className={clsx(
          "inline-flex items-center justify-center",
          disabled && "opacity-50",
          className,
        )}
        aria-disabled={disabled}
        {...rest}
      >
        <RadixSpinner
          loading={animate && !disabled}
          style={{ width: "100%", height: "100%" }}
          {...(radixColor ? { color: radixColor } : {})}
        />
      </div>
    );
  },
);

Spinner.displayName = "Spinner";

export { Spinner };
