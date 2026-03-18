// Import Dependencies
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Label,
  Transition,
  ComboboxProps as HeadlessComboboxProps,
} from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";
import { forwardRef, Fragment, useRef, ElementType, ReactNode } from "react";

// Local Imports
import { Input, InputErrorMsg } from "@/components/ui";
import { useFuse, useBoxPosition, useBoxSize, mergeRefs } from "@/hooks";
import { Highlight } from "../Highlight";

// ----------------------------------------------------------------------

type DefaultComboboxTag = "div";

interface DataItem {
  [key: string]: any;
}

interface ClassNames {
  root?: string;
  input?: string;
}

export type StyledComboboxProps<
  TValue,
  TMultiple extends boolean | undefined = false,
  TTag extends ElementType = DefaultComboboxTag,
> = {
  data: DataItem[];
  placeholder?: string;
  label?: ReactNode;
  displayField?: string;
  error?: boolean | string;
  inputProps?: Record<string, any>;
  rootProps?: Record<string, any>;
  className?: string;
  classNames?: ClassNames;
  searchFields?: string[];
  highlight?: boolean;
  as?: TTag;
  multiple?: TMultiple;
  disabled?: boolean;
  name?: string;
  form?: string;
  invalid?: boolean;
} & Omit<HeadlessComboboxProps<TValue, TMultiple, TTag>, "as">;

const CustomCombobox = forwardRef(function CustomCombobox<
  TValue,
  TMultiple extends boolean | undefined = false,
  TTag extends ElementType = DefaultComboboxTag,
>(
  props: StyledComboboxProps<TValue, TMultiple, TTag>,
  ref: React.ForwardedRef<HTMLElement>,
) {
  const {
    data,
    multiple,
    placeholder,
    label,
    error,
    displayField = "label",
    searchFields = [],
    highlight,
    inputProps,
    rootProps,
    className,
    classNames,
    ...headlessProps
  } = props;

  const {
    result: filteredData,
    query,
    setQuery,
  } = useFuse(data, {
    keys: searchFields,
    threshold: 0.2,
    matchAllOnEmptyQuery: true,
  });

  const boxSizeRef = useRef<HTMLDivElement>(null);
  const { width: inputWidth } = useBoxSize({ ref: boxSizeRef });
  const { left: inputLeft, ref: boxPositionRef } = useBoxPosition();

  const comboboxProps = {
    as: "div",
    className: clsx(classNames?.root, className),
    multiple,
    ref,
    ...headlessProps,
  } as any;

  return (
    <div className={clsx("flex flex-col", classNames?.root)} {...rootProps}>
      <Combobox value="55" onChange={() => {}} {...comboboxProps}>
        {({ open, value: selectedValue }: { open: boolean; value: any }) => {
          return (
            <>
              {label && <Label>{label}</Label>}
              <div
                ref={mergeRefs(boxPositionRef, boxSizeRef)}
                className={clsx("relative", label && "mt-1.5")}
              >
                {multiple ? (
                  <div>
                    <ComboboxButton
                      as="div"
                      className={clsx(
                        "outline-hidden focus:outline-hidden relative w-full cursor-default overflow-hidden rounded-lg border text-start transition-colors",
                        error
                          ? "border-error dark:border-error-lighter"
                          : "focus-within:border-primary-600! dark:focus-within:border-primary-500! border-gray-300 hover:border-gray-400 dark:border-dark-450 dark:hover:border-dark-400",
                      )}
                    >
                      <div className="flex flex-wrap justify-start gap-2 px-3 py-2 ltr:pr-9 rtl:pl-9">
                        {selectedValue?.length > 0 && (
                          <div>
                            {(selectedValue as DataItem[])
                              .map((val) => val?.[displayField])
                              .join(", ")}
                          </div>
                        )}
                        <ComboboxInput
                          as={Input}
                          classNames={{
                            root: "flex-1",
                            input:
                              "placeholder:font-light placeholder:text-gray-600 dark:placeholder:text-dark-200",
                          }}
                          unstyled
                          displayValue={(val: { item?: DataItem }) =>
                            val?.item?.[displayField]
                          }
                          autoComplete="new"
                          placeholder={
                            (selectedValue as any[])?.length === 0 &&
                            query === ""
                              ? placeholder
                              : undefined
                          }
                          onChange={(event) => {
                            setQuery(event.target.value);
                          }}
                          value={query}
                          {...inputProps}
                        />
                      </div>

                      <div className="absolute inset-y-0 flex items-center ltr:right-0 ltr:pr-2 rtl:left-0 rtl:pl-2">
                        <ChevronDownIcon
                          className={clsx(
                            "size-5 text-gray-400 transition-transform dark:text-dark-300",
                            open && "rotate-180",
                          )}
                          aria-hidden="true"
                        />
                      </div>
                    </ComboboxButton>
                    <InputErrorMsg
                      when={Boolean(error && typeof error !== "boolean")}
                    >
                      {error}
                    </InputErrorMsg>
                  </div>
                ) : (
                  <ComboboxButton className="relative w-full cursor-pointer overflow-hidden text-start">
                    <ComboboxInput
                      as={Input}
                      autoComplete="new"
                      error={error}
                      displayValue={(val: DataItem) => val?.[displayField]}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={placeholder}
                      suffix={
                        <ChevronDownIcon
                          className={clsx(
                            "size-5 transition-transform",
                            open && "rotate-180",
                          )}
                          aria-hidden="true"
                        />
                      }
                      {...inputProps}
                    />
                  </ComboboxButton>
                )}

                <Transition
                  as={Fragment}
                  enter="transition ease-out"
                  enterFrom="opacity-0 translate-y-2"
                  enterTo="opacity-100 translate-y-0"
                  leave="transition ease-in"
                  leaveFrom="opacity-100 translate-y-0"
                  leaveTo="opacity-0 translate-y-2"
                  afterLeave={() => setQuery("")}
                >
                  <ComboboxOptions
                    anchor={{ to: "bottom end", gap: 8 }}
                    style={{
                      width: inputWidth,
                      ["--left-anchor" as string]: `${inputLeft}px`,
                    }}
                    className={clsx(
                      "left-(--left-anchor)! outline-hidden focus-visible:outline-hidden absolute z-10 max-h-60 overflow-y-auto overflow-x-hidden rounded-lg border border-gray-300 bg-white py-1 shadow-lg shadow-gray-200/50 dark:border-dark-500 dark:bg-dark-750 dark:shadow-none",
                      multiple && "mt-2",
                    )}
                  >
                    {filteredData.length === 0 && query !== "" ? (
                      <div className="relative cursor-default select-none px-4 py-2 text-gray-800 dark:text-dark-100">
                        Nothing found for {query}
                      </div>
                    ) : (
                      filteredData.map(({ item, refIndex }) => (
                        <ComboboxOption
                          key={refIndex}
                          className={({
                            selected,
                            active,
                          }: {
                            selected: boolean;
                            active: boolean;
                          }) =>
                            clsx(
                              "outline-hidden relative cursor-pointer select-none px-4 py-2 transition-colors",
                              active &&
                                !selected &&
                                "bg-gray-100 dark:bg-dark-600",
                              selected
                                ? "bg-primary-600 text-white dark:bg-primary-500"
                                : "text-gray-800 dark:text-dark-100",
                            )
                          }
                          value={item}
                        >
                          {({ selected }: { selected: boolean }) => (
                            <span
                              className={`block truncate ${
                                selected ? "font-medium" : "font-normal"
                              }`}
                            >
                              {highlight ? (
                                <Highlight query={query}>
                                  {String(
                                    item?.[displayField as keyof DataItem] ??
                                      "",
                                  )}
                                </Highlight>
                              ) : (
                                String(
                                  item?.[displayField as keyof DataItem] ?? "",
                                )
                              )}
                            </span>
                          )}
                        </ComboboxOption>
                      ))
                    )}
                  </ComboboxOptions>
                </Transition>
              </div>
            </>
          );
        }}
      </Combobox>
    </div>
  );
});

CustomCombobox.displayName = "Combobox";

export { CustomCombobox as Combobox };
