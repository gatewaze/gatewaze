// Import Dependencies
import { InputHTMLAttributes, CSSProperties, forwardRef } from "react";
import clsx from "clsx";

// Local Imports
import { setThisClass } from "@/utils/setThisClass";
import { type ColorType } from "@/constants/app";

// ----------------------------------------------------------------------

type RangeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  color?: ColorType;
  thumbSize?: string;
  trackSize?: string;
  style?: CSSProperties & {
    "--thumb-size"?: string;
    "--track-h"?: string;
  };
};


const Range = forwardRef<HTMLInputElement, RangeProps>(({
  className,
  color = "neutral",
  thumbSize,
  trackSize,
  style,
  ...rest
}, ref) => {
  return (
    <input
      type="range"
      className={clsx(
        "form-range",
        color === "neutral"
          ? "text-gray-500 dark:text-dark-300"
          : [setThisClass(color), "text-this dark:text-this-light"],
        className,
      )}
      ref={ref}
      style={{
        "--thumb-size": thumbSize,
        "--track-h": trackSize,
        ...style,
      }}
      {...rest}
    />
  );
});

Range.displayName = "Range";

export { Range };
