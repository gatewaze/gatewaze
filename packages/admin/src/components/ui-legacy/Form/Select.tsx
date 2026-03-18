// @ts-nocheck
// Import Dependencies
import {
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  RefObject,
  HTMLAttributes,
  ComponentPropsWithoutRef,
} from "react";
import clsx from "clsx";
import { ChevronDownIcon } from "@heroicons/react/20/solid";

// Local Imports
import { useId } from "@/hooks";
import { InputErrorMsg } from "@/components/ui-legacy/Form/InputErrorMsg";
import { useThemeContext } from "@/app/contexts/theme/context";

// Types
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

// ----------------------------------------------------------------------

/**
 * Finds the nearest parent element with a non-transparent background color.
 *
 * @param {HTMLElement} element - The starting element to check.
 * @returns {string|null} - The background color of the nearest parent or `null` if none is found.
 */
function findNearestBackgroundColor(element: HTMLElement): string | null {
  if (!(element instanceof HTMLElement)) {
    throw new TypeError("The input must be an HTMLElement.");
  }

  let current = element.parentElement;

  while (current && current !== document.documentElement) {
    const bgColor = window.getComputedStyle(current).backgroundColor;

    // Check if background color is not transparent or unset
    if (
      bgColor &&
      bgColor !== "rgba(0, 0, 0, 0)" &&
      bgColor !== "transparent"
    ) {
      return bgColor;
    }

    current = current.parentElement; // Move to the parent
  }

  return null; // No parent with a background color found
}

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
  const selectRef = useRef<HTMLSelectElement>(null);
  const theme = useThemeContext();

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
      ? "text-error dark:text-error-light"
      : "peer-focus:text-primary-600 dark:text-dark-300 dark:peer-focus:text-primary-500 text-gray-400",
  );

  useEffect(() => {
    const el = selectRef.current;
    if (!el) return;
    const color = findNearestBackgroundColor(el);
    el.style.setProperty("--bg-color", color);
  }, [theme]);

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
        <select
          className={clsx(
            multiple ? "form-multiselect" : "form-select-base",
            !unstyled && [
              !multiple && "form-select",
              suffix && "ltr:pr-9 rtl:pl-9",
              prefix && "ltr:pl-9 rtl:pr-9",
              error
                ? "border-error dark:border-error-lighter"
                : [
                    disabled
                      ? "bg-gray-150 dark:border-dark-500 dark:bg-dark-600 cursor-not-allowed border-gray-300 opacity-60"
                      : "peer focus:border-primary-600 dark:border-dark-450 dark:hover:border-dark-400 dark:focus:border-primary-500 border-gray-300 hover:border-gray-400",
                  ],
            ],
            className,
            classNames.select,
          )}
          id={inputId}
          ref={ref || selectRef}
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

Select.displayName = "Select";

export { Select };
