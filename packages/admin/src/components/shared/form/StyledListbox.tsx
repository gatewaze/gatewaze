// Import Dependencies
import {
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Transition,
  ListboxProps as HeadlessListboxProps,
} from "@headlessui/react";
import { CheckIcon, ChevronDownIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";
import { Fragment, ReactNode, forwardRef, ElementType } from "react";

// Local Imports
import { Input } from "@/components/ui";

// ----------------------------------------------------------------------

interface DataItem {
  [key: string]: any;
}

const DEFAULT_LISTBOX_TAG = "div";

export type StyledListboxProps<
  TTag extends ElementType = typeof DEFAULT_LISTBOX_TAG,
  TType = string,
  TActualType = TType extends (infer U)[] ? U : TType,
> = {
  data: DataItem[];
  placeholder?: string;
  label?: ReactNode;
  displayField?: string;
  error?: boolean | string;
  inputProps?: Record<string, any>;
  rootProps?: Record<string, any>;
  className?: string;
  classNames?: {
    root?: string;
    listbox?: string;
  };
  as?: TTag;
} & Omit<HeadlessListboxProps<TTag, TActualType>, "as" | "children">;

type ListboxComponentType = React.ForwardRefExoticComponent<
  StyledListboxProps<typeof DEFAULT_LISTBOX_TAG, any> &
    React.RefAttributes<HTMLElement>
> & {
  displayName?: string;
};

const StyledListbox: ListboxComponentType = forwardRef((props, ref) => {
  const {
    data,
    placeholder,
    label,
    displayField = "label",
    error,
    inputProps,
    rootProps,
    className,
    classNames,
    multiple,
    as = DEFAULT_LISTBOX_TAG,
    by,
    ...listboxProps
  } = props;

  return (
    <div
      className={clsx(
        "flex flex-col [&_.suffix]:pointer-events-none",
        classNames?.root,
      )}
      {...rootProps}
    >
      <Listbox
        as={as}
        className={clsx(className, classNames?.listbox)}
        ref={ref}
        multiple={multiple}
        by={by}
        {...listboxProps}
      >
        {({ open, value: selectedValue }: { open: boolean; value: any }) => (
          <>
            {label && <Label>{label}</Label>}

            <div className={clsx("relative", label && "mt-1.5")}>
              <ListboxButton
                as={Input}
                component="button"
                type="button"
                error={error}
                suffix={
                  <ChevronDownIcon
                    className={clsx(
                      "size-5 transition-transform",
                      open && "rotate-180",
                    )}
                  />
                }
                {...inputProps}
              >
                <span className="block truncate">
                  <span className="dark:text-dark-200 text-gray-600">
                    {!selectedValue?.[multiple ? "length" : displayField] &&
                      placeholder}
                  </span>
                  <span>
                    {multiple
                      ? (selectedValue as DataItem[])
                          .map((item) => item[displayField])
                          .join(", ")
                      : (selectedValue as DataItem)?.[displayField]}
                  </span>
                </span>
              </ListboxButton>
              <Transition
                as={Fragment}
                enter="transition ease-out"
                enterFrom="opacity-0 translate-y-2"
                enterTo="opacity-100 translate-y-0"
                leave="transition ease-in"
                leaveFrom="opacity-100 translate-y-0"
                leaveTo="opacity-0 translate-y-2"
              >
                <ListboxOptions
                  anchor={{ to: "bottom end", gap: 8 }}
                  className="dark:border-dark-500 dark:bg-dark-750 absolute z-100 max-h-60 w-(--button-width) overflow-auto rounded-lg border border-gray-300 bg-white py-1 shadow-lg shadow-gray-200/50 outline-hidden focus-visible:outline-hidden dark:shadow-none"
                >
                  {data.map((item: DataItem, i: number) => (
                    <ListboxOption
                      key={i}
                      className={({
                        selected,
                        active,
                      }: {
                        selected: boolean;
                        active: boolean;
                      }) =>
                        clsx(
                          "relative cursor-pointer py-2 pr-10 pl-4 outline-hidden transition-colors select-none rtl:pr-4 rtl:pl-10",
                          active && !selected && "dark:bg-dark-600 bg-gray-100",
                          selected
                            ? "bg-primary-600 dark:bg-primary-500 text-white"
                            : "dark:text-dark-100 text-gray-800",
                        )
                      }
                      value={item}
                    >
                      {({ selected }: { selected: boolean }) => (
                        <>
                          <span className="block truncate">
                            {item[displayField]}
                          </span>

                          {selected ? (
                            <span className="absolute inset-y-0 flex items-center ltr:right-0 ltr:pr-3 rtl:left-0 rtl:pl-3">
                              <CheckIcon
                                className="size-5"
                                aria-hidden="true"
                              />
                            </span>
                          ) : null}
                        </>
                      )}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </Transition>
            </div>
          </>
        )}
      </Listbox>
    </div>
  );
});

StyledListbox.displayName = "Listbox";

export { StyledListbox as Listbox };
