import { useEffect, useRef, InputHTMLAttributes, ReactNode, forwardRef, ForwardedRef } from "react";
import clsx from "clsx";

import { ApplyWrapper } from "@/components/shared/ApplyWrapper";
import { mergeRefs } from "@/hooks";
import { ColorType } from "@/constants/app";

const disabledClass =
  "before:[mask-image:var(--tw-thumb)] before:bg-[var(--gray-a8)] border-[var(--gray-a5)] bg-[var(--gray-a3)] pointer-events-none select-none opacity-70";

const variants = {
  basic:
    "border-[var(--gray-a7)] bg-origin-border before:bg-center before:bg-no-repeat before:[background-size:100%_100%] before:[background-image:var(--tw-thumb)] checked:border-[var(--accent-9)] checked:bg-[var(--accent-9)] indeterminate:border-[var(--accent-9)] indeterminate:bg-[var(--accent-9)] hover:border-[var(--accent-9)] focus:border-[var(--accent-9)]",
  outlined:
    "border-[var(--gray-a7)] before:bg-[var(--accent-9)] before:[mask-image:var(--tw-thumb)] checked:border-[var(--accent-9)] hover:border-[var(--accent-9)] focus:border-[var(--accent-9)]",
};

type CheckboxProps =
  Omit<InputHTMLAttributes<HTMLInputElement>, "color"> & {
  variant?: "outlined" | "basic";
  unstyled?: boolean;
  color?: Exclude<ColorType, "neutral">;
  classNames?: {
    input?: string;
    label?: string;
    labelText?: string;
  };
  label?: ReactNode;
  indeterminate?: boolean;
  labelProps?: Record<string, any>;
};

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      variant = "basic",
      unstyled,
      color: _color = "primary",
      type = "checkbox",
      className,
      classNames = {},
      label,
      disabled,
      indeterminate,
      labelProps,
      ...rest
    }: CheckboxProps,
    ref: ForwardedRef<HTMLInputElement>,
  ) => {
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (inputRef.current) {
        inputRef.current.indeterminate = Boolean(indeterminate);
      }
    }, [indeterminate]);

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
            "form-checkbox",
            !unstyled && [disabled ? disabledClass : variants[variant]],
            className,
            classNames?.input,
          )}
          disabled={disabled}
          data-disabled={disabled}
          data-indeterminate={indeterminate}
          ref={mergeRefs(inputRef, ref)}
          type={type}
          {...rest}
        />
      </ApplyWrapper>
    );
  },
);

Checkbox.displayName = "Checkbox";

export { Checkbox };
