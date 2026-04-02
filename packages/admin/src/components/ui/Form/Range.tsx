import { InputHTMLAttributes, CSSProperties, forwardRef } from "react";
import clsx from "clsx";

import { type ColorType } from "@/constants/app";

type RangeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  color?: ColorType;
  thumbSize?: string;
  trackSize?: string;
  style?: CSSProperties & {
    "--thumb-size"?: string;
    "--track-h"?: string;
  };
};

const Range = forwardRef<HTMLInputElement, RangeProps>(
  ({ className, color: _color = "neutral", thumbSize, trackSize, style, ...rest }, ref) => {
    return (
      <input
        type="range"
        className={clsx(
          "form-range text-[var(--accent-9)]",
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
  },
);

Range.displayName = "Range";

export { Range };
