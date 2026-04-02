import { ElementType, ReactNode, forwardRef, ForwardedRef } from "react";
import clsx from "clsx";

import { useId } from "@/hooks";
import { InputErrorMsg } from "./InputErrorMsg";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

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
        ? "text-[var(--red-9)]"
        : "text-[var(--gray-a8)] peer-focus:text-[var(--accent-9)]",
    );

    return (
      <div className={clsx("flex flex-col", classNames.root)} {...rootProps}>
        {label && (
          <label
            htmlFor={inputId}
            className={clsx(
              "text-sm font-medium text-[var(--gray-12)]",
              classNames.label,
            )}
            {...labelProps}
          >
            <span className={clsx(classNames.labelText)}>{label}</span>
          </label>
        )}

        <div
          className={clsx(
            "relative flex flex-col",
            label && "mt-1.5",
            classNames.wrapper,
          )}
        >
          <Component
            className={clsx(
              "block w-full appearance-none bg-transparent tracking-wide outline-hidden transition-colors duration-200 placeholder:font-light focus:outline-hidden disabled:select-none",
              suffix && "ltr:pr-9 rtl:pl-9",
              prefix && "ltr:pl-9 rtl:pr-9",
              !unstyled && [
                "rounded-lg border px-3 py-2 text-start text-[var(--gray-12)] placeholder:text-[var(--gray-a8)]",
                error
                  ? "border-[var(--red-9)]"
                  : disabled
                    ? "cursor-not-allowed border-[var(--gray-a5)] bg-[var(--gray-a3)] opacity-60"
                    : "peer border-[var(--gray-a5)] hover:border-[var(--gray-a7)] focus:border-[var(--accent-9)]",
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
              "mt-1 text-xs text-[var(--gray-a9)]",
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
