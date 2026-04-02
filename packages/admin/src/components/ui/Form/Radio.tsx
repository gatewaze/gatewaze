import {
  InputHTMLAttributes,
  ReactNode,
  forwardRef,
  ForwardedRef,
} from "react";
import clsx from "clsx";

import { ApplyWrapper } from "@/components/shared/ApplyWrapper";
import { type ColorType } from "@/constants/app";

type RadioVariant = "basic" | "outlined";

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  variant?: RadioVariant;
  unstyled?: boolean;
  color?: Exclude<ColorType, "neutral">;
  classNames?: {
    label?: string;
    labelText?: string;
    input?: string;
  };
  label?: ReactNode;
  labelProps?: React.HTMLAttributes<HTMLLabelElement>;
};

const disabledClass =
  "before:[mask-image:var(--tw-thumb)] before:bg-[var(--gray-a8)] border-[var(--gray-a5)] bg-[var(--gray-a3)] pointer-events-none select-none opacity-70";

const variants: Record<RadioVariant, string> = {
  basic:
    "border-[var(--gray-a7)] bg-origin-border before:bg-center before:bg-no-repeat before:[background-size:100%_100%] before:[background-image:var(--tw-thumb)] checked:border-[var(--accent-9)] checked:bg-[var(--accent-9)] hover:border-[var(--accent-9)] focus:border-[var(--accent-9)]",
  outlined:
    "border-[var(--gray-a7)] before:bg-[var(--accent-9)] before:[mask-image:var(--tw-thumb)] checked:border-[var(--accent-9)] hover:border-[var(--accent-9)] focus:border-[var(--accent-9)]",
};

const Radio = forwardRef(
  (
    {
      variant = "basic",
      unstyled,
      color: _color = "primary",
      className,
      classNames = {},
      label,
      disabled,
      labelProps,
      ...rest
    }: RadioProps,
    ref: ForwardedRef<HTMLInputElement>,
  ) => {
    return (
      <ApplyWrapper
        when={!!label}
        wrapper={(children) => (
          <label
            className={clsx(
              "inline-flex items-center gap-2 text-sm font-medium text-[var(--gray-12)]",
              classNames?.label,
            )}
            {...labelProps}
          >
            {children}
            <span className={clsx(classNames?.labelText)}>{label}</span>
          </label>
        )}
      >
        <input
          className={clsx(
            "form-radio",
            !unstyled && [disabled ? disabledClass : variants[variant]],
            className,
            classNames?.input,
          )}
          disabled={disabled}
          data-disabled={disabled}
          type="radio"
          ref={ref}
          {...rest}
        />
      </ApplyWrapper>
    );
  },
);

Radio.displayName = "Radio";

export { Radio };
