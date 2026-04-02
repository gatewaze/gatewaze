import {
  ReactNode,
  useMemo,
  RefObject,
  HTMLAttributes,
  ComponentPropsWithoutRef,
} from "react";
import clsx from "clsx";
import { ChevronDownIcon } from "@heroicons/react/20/solid";

import { useId } from "@/hooks";
import { InputErrorMsg } from "@/components/ui/Form/InputErrorMsg";

export type SelectOption = {
  label: ReactNode;
  value: string | number;
  disabled?: boolean;
};

type SelectClassNames = {
  root?: string;
  label?: string;
  labelText?: string;
  wrapper?: string;
  select?: string;
  prefix?: string;
  suffix?: string;
  error?: string;
  description?: string;
};

type SelectProps = {
  label?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  description?: string;
  classNames?: SelectClassNames;
  error?: boolean | ReactNode;
  unstyled?: boolean;
  rootProps?: HTMLAttributes<HTMLDivElement>;
  labelProps?: HTMLAttributes<HTMLLabelElement>;
  data?: (SelectOption | string | number)[];
  ref?: RefObject<HTMLSelectElement>;
  multiple?: boolean;
} & Omit<ComponentPropsWithoutRef<"select">, "prefix">;

const Select = ({
  label,
  prefix,
  suffix = <ChevronDownIcon className="w-2/3" />,
  description,
  classNames = {},
  className,
  error,
  multiple = false,
  unstyled,
  disabled,
  rootProps,
  labelProps,
  id,
  data = [],
  children,
  ref,
  ...rest
}: SelectProps) => {
  const inputId = useId(id, "select");

  const options = useMemo(
    () =>
      data.map((item) => {
        const formatted: SelectOption =
          typeof item !== "object"
            ? { label: item, value: item }
            : (item as SelectOption);
        return (
          <option
            key={formatted.value}
            value={formatted.value}
            disabled={formatted.disabled}
          >
            {formatted.label}
          </option>
        );
      }),
    [data],
  );

  const affixClass = clsx(
    "pointer-events-none absolute top-0 flex h-full w-9 items-center justify-center transition-colors",
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
        <select
          className={clsx(
            "block w-full appearance-none bg-transparent tracking-wide outline-hidden transition-colors duration-200 focus:outline-hidden disabled:select-none",
            !unstyled && [
              "rounded-lg border px-3 py-2 text-start text-[var(--gray-12)]",
              suffix && "ltr:pr-9 rtl:pl-9",
              prefix && "ltr:pl-9 rtl:pr-9",
              error
                ? "border-[var(--red-9)]"
                : [
                    disabled
                      ? "cursor-not-allowed border-[var(--gray-a5)] bg-[var(--gray-a3)] opacity-60"
                      : "peer border-[var(--gray-a5)] hover:border-[var(--gray-a7)] focus:border-[var(--accent-9)]",
                  ],
            ],
            className,
            classNames.select,
          )}
          id={inputId}
          ref={ref}
          disabled={disabled}
          data-disabled={disabled}
          multiple={multiple}
          {...rest}
        >
          {children || options}
        </select>
        {!multiple && !unstyled && prefix && (
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

        {!multiple && !unstyled && (
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

Select.displayName = "Select";

export { Select };
