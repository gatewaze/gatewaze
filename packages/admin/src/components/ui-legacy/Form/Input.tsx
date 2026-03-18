// Import Dependencies
import { ElementType, ReactNode, forwardRef, ForwardedRef } from "react";
import clsx from "clsx";

// Local Imports
import { useId } from "@/hooks";
import { InputErrorMsg } from "./InputErrorMsg";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

// ----------------------------------------------------------------------

export type InputOwnProps<T extends ElementType = "input"> = {
  component?: T;
  label?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  description?: string;
  className?: string;
  placeholder?: string;
  classNames?: {
    root?: string;
    label?: string;
    labelText?: string;
    wrapper?: string;
    input?: string;
    prefix?: string;
    suffix?: string;
    error?: string;
    description?: string;
  };
  error?: boolean | ReactNode;
  unstyled?: boolean;
  disabled?: boolean;
  type?: string;
  rootProps?: Record<string, any>;
  labelProps?: Record<string, any>;
  id?: string;
};

export type InputProps<E extends ElementType = "button"> =
  PolymorphicComponentProps<E, InputOwnProps<E>>;

const InputInner = forwardRef(
  <T extends ElementType = "input">(props: any, ref: ForwardedRef<any>) => {
    const {
      component,
      label,
      prefix,
      suffix,
      description,
      className,
      classNames = {},
      error,
      unstyled,
      disabled,
      type = "text",
      rootProps,
      labelProps,
      id,
      ...rest
    } = props as InputProps<T>;

    const Component: ElementType = component || "input";
    const inputId = useId(id, "input");

    const affixClass = clsx(
      "absolute top-0 flex h-full w-9 items-center justify-center transition-colors",
      error
        ? "text-error dark:text-error-light"
        : "peer-focus:text-primary-600 dark:text-dark-300 dark:peer-focus:text-primary-500 text-gray-400",
    );

    return (
      <div className={clsx("input-root", classNames.root)} {...rootProps}>
        {label && (
          <label
            htmlFor={inputId}
            className={clsx("input-label", classNames.label)}
            {...labelProps}
          >
            <span className={clsx("input-label", classNames.labelText)}>
              {label}
            </span>
          </label>
        )}

        <div
          className={clsx(
            "input-wrapper relative",
            label && "mt-1.5",
            classNames.wrapper,
          )}
        >
          <Component
            className={clsx(
              "form-input-base",
              suffix && "ltr:pr-9 rtl:pl-9",
              prefix && "ltr:pl-9 rtl:pr-9",
              !unstyled && [
                "form-input",
                error
                  ? "border-error dark:border-error-lighter"
                  : disabled
                    ? "bg-gray-150 dark:border-dark-500 dark:bg-dark-600 cursor-not-allowed border-gray-300 opacity-60"
                    : "peer focus:border-primary-600 dark:border-dark-450 dark:hover:border-dark-400 dark:focus:border-primary-500 border-gray-300 hover:border-gray-400",
              ],
              className,
              classNames.input,
            )}
            type={type}
            id={inputId}
            ref={ref}
            disabled={disabled}
            {...rest}
          />
          {prefix && (
            <div
              className={clsx(
                "prefix ltr:left-0 rtl:right-0",
                affixClass,
                classNames.prefix,
              )}
            >
              {prefix}
            </div>
          )}
          {suffix && (
            <div
              className={clsx(
                "suffix ltr:right-0 rtl:left-0",
                affixClass,
                classNames.suffix,
              )}
            >
              {suffix}
            </div>
          )}
        </div>
        <InputErrorMsg
          when={!!error && typeof error !== "boolean"}
          className={classNames.error}
        >
          {error}
        </InputErrorMsg>
        {description && (
          <span
            className={clsx(
              "input-description dark:text-dark-300 mt-1 text-xs text-gray-400",
              classNames.description,
            )}
          >
            {description}
          </span>
        )}
      </div>
    );
  },
);

type InputComponent = (<E extends ElementType = "input">(
  props: InputProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const Input = InputInner as InputComponent;
Input.displayName = "Input";

export { Input };
