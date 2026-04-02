import {
  InputHTMLAttributes,
  ReactNode,
  forwardRef,
  ForwardedRef,
} from "react";
import clsx from "clsx";

import { ApplyWrapper } from "@/components/shared/ApplyWrapper";
import { type ColorType } from "@/constants/app";

type SwitchVariant = "basic" | "outlined";

export type SwitchProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "role"
> & {
  variant?: SwitchVariant;
  unstyled?: boolean;
  color?: Exclude<ColorType, "neutral">;
  classNames?: {
    label?: string;
    labelText?: string;
    input?: string;
  };
  label?: ReactNode;
  role?: "switch";
  labelProps?: React.HTMLAttributes<HTMLLabelElement>;
};

const disabledClass =
  "before:bg-[var(--gray-a8)] bg-[var(--gray-a3)] border border-[var(--gray-a5)] pointer-events-none select-none opacity-70";

const variants: Record<SwitchVariant, string> = {
  basic:
    "bg-[var(--gray-a6)] before:bg-white checked:bg-[var(--accent-9)] checked:before:bg-white focus-visible:ring-3 focus-visible:ring-[var(--accent-a5)]",
  outlined:
    "is-outline border-[var(--gray-a7)] border before:bg-[var(--gray-a6)] checked:border-[var(--accent-9)] checked:before:bg-[var(--accent-9)] focus-visible:ring-3 focus-visible:ring-[var(--accent-a5)]",
};

const Switch = forwardRef(
  (
    {
      variant = "basic",
      unstyled,
      color: _color = "primary",
      className,
      classNames = {},
      label,
      role = "switch",
      disabled,
      labelProps,
      ...rest
    }: SwitchProps,
    ref: ForwardedRef<HTMLInputElement>,
  ) => {
    return (
      <ApplyWrapper
        when={!!label}
        wrapper={(children) => (
          <label
            className={clsx(
              "inline-flex items-center gap-2 text-sm font-medium text-[var(--gray-12)]",
              classNames.label,
            )}
            {...labelProps}
          >
            {children}
            <span className={clsx(classNames.labelText)}>{label}</span>
          </label>
        )}
      >
        <input
          className={clsx(
            "form-switch",
            !unstyled && [disabled ? disabledClass : variants[variant]],
            className,
            classNames.input,
          )}
          disabled={disabled}
          type="checkbox"
          role={role}
          ref={ref}
          {...rest}
        />
      </ApplyWrapper>
    );
  },
);

Switch.displayName = "Switch";

export { Switch };
