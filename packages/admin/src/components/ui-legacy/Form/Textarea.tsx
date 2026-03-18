// Import Dependencies
import { ElementType, ReactNode, HTMLAttributes, ForwardedRef } from "react";
import clsx from "clsx";

// Local Imports
import { useId } from "@/hooks";
import { InputErrorMsg } from "./InputErrorMsg";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

// ----------------------------------------------------------------------

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
          ref={ref}
          id={inputId}
          className={clsx(
            "form-textarea-base",
            !unstyled && [
              "form-textarea",
              error
                ? "border-error dark:border-error-lighter"
                : [
                    disabled
                      ? "bg-gray-150 dark:border-dark-500 dark:bg-dark-600 cursor-not-allowed border-gray-300 opacity-60"
                      : "peer focus:border-primary-600 dark:border-dark-450 dark:hover:border-dark-400 dark:focus:border-primary-500 border-gray-300 hover:border-gray-400",
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
            "input-description dark:text-dark-300 mt-1 text-xs text-gray-400",
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
