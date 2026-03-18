// @ts-nocheck
// Import Dependencies
import {
  InputHTMLAttributes,
  ReactNode,
  forwardRef,
  ForwardedRef,
} from "react";
import clsx from "clsx";

// Local Imports
import { ApplyWrapper } from "@/components/shared/ApplyWrapper";
import { setThisClass } from "@/utils/setThisClass";
import { type ColorType } from "@/constants/app";

// Types
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

// ----------------------------------------------------------------------

const disabledClass =
  "before:[mask-image:var(--tw-thumb)] before:bg-gray-400 border-gray-150 bg-gray-150 pointer-events-none select-none opacity-70 dark:bg-dark-450 dark:border-dark-450 dark:before:bg-dark-800 dark:opacity-60";

const variants: Record<RadioVariant, string> = {
  basic:
    "border-gray-400/70 bg-origin-border before:bg-center before:bg-no-repeat before:[background-size:100%_100%] before:[background-image:var(--tw-thumb)] checked:border-this checked:bg-this hover:border-this focus:border-this dark:border-dark-400 dark:checked:border-this-light dark:checked:bg-this-light dark:hover:border-this-light dark:focus:border-this-light",
  outlined:
    "border-gray-400/70 before:bg-this before:[mask-image:var(--tw-thumb)] checked:border-this hover:border-this focus:border-this dark:border-dark-400 dark:hover:border-this-light dark:focus:border-this-light dark:before:bg-this-light dark:checked:border-this-light",
};

const Radio = forwardRef(
  (
    {
      variant = "basic",
      unstyled,
      color = "primary",
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
              "input-label inline-flex items-center gap-2",
              classNames?.label,
            )}
            {...labelProps}
          >
            {children}
            <span className={clsx("label", classNames?.labelText)}>
              {label}
            </span>
          </label>
        )}
      >
        <input
          className={clsx(
            "form-radio",
            !unstyled && [
              setThisClass(color),
              disabled ? disabledClass : variants[variant],
            ],
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
