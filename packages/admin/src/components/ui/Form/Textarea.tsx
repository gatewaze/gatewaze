import { ElementType, ReactNode, HTMLAttributes, ForwardedRef } from "react";
import clsx from "clsx";

import { useId } from "@/hooks";
import { InputErrorMsg } from "./InputErrorMsg";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

type TextareaOwnProps<T extends ElementType = "textarea"> = {
  component?: T;
  label?: ReactNode;
  description?: ReactNode;
  classNames?: {
    root?: string;
    label?: string;
    labelText?: string;
    wrapper?: string;
    input?: string;
    error?: string;
    description?: string;
  };
  disabled?: boolean;
  error?: boolean | ReactNode;
  unstyled?: boolean;
  rootProps?: HTMLAttributes<HTMLDivElement>;
  labelProps?: HTMLAttributes<HTMLLabelElement>;
  id?: string;
  className?: string;
};

export type TextareaProps<E extends ElementType = "textarea"> =
  PolymorphicComponentProps<E, TextareaOwnProps<E>>;

const TextareaInner = <C extends ElementType = "textarea">(
  props: any,
  ref: ForwardedRef<any>,
) => {
  const {
    component,
    label,
    description,
    className,
    classNames = {},
    error,
    unstyled,
    rootProps,
    labelProps,
    id,
    disabled,
    ...rest
  } = props as TextareaProps<C>;
  const Component = component || "textarea";
  const inputId = useId(id, "textarea");

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
          ref={ref}
          id={inputId}
          className={clsx(
            "block w-full appearance-none bg-transparent tracking-wide outline-hidden transition-colors duration-200 placeholder:font-light focus:outline-hidden disabled:select-none",
            !unstyled && [
              "resize-none rounded-lg border px-3 py-2 text-start text-[var(--gray-12)] placeholder:text-[var(--gray-a8)]",
              error
                ? "border-[var(--red-9)]"
                : [
                    disabled
                      ? "cursor-not-allowed border-[var(--gray-a5)] bg-[var(--gray-a3)] opacity-60"
                      : "peer border-[var(--gray-a5)] hover:border-[var(--gray-a7)] focus:border-[var(--accent-9)]",
                  ],
            ],
            className,
            classNames.input,
          )}
          {...(rest as any)}
        />
      </div>
      <InputErrorMsg
        when={!!(error && typeof error !== "boolean")}
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
};

type TextareaComponent = (<E extends ElementType = "textarea">(
  props: TextareaProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const Textarea = TextareaInner as TextareaComponent;
Textarea.displayName = "Textarea";

export { Textarea };
