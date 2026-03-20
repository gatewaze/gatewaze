// Import Dependencies
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";
import { useEffect, useRef, ElementType, ReactElement } from "react";

// Local Imports
import { Badge, Button, Checkbox, Input } from "@/components/ui";
import { useFuse } from "@/hooks";
import { ResponsiveFilter } from "./ResponsiveFilter";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { Column } from "@tanstack/react-table";

// ----------------------------------------------------------------------

interface FilterOption {
  [key: string]: any;
  icon?: ElementType;
}

interface FacetedFilterProps {
  column: Column<any>;
  title: string;
  options: FilterOption[];
  labelField?: string;
  valueField?: string;
  Icon?: ElementType;
  renderPrefix?: (item: FilterOption, selected: boolean) => ReactElement;
  showCheckbox?: boolean;
}

export function FacedtedFilter({
  column,
  title,
  options,
  labelField = "label",
  valueField = "value",
  Icon,
  renderPrefix,
  showCheckbox = true,
}: FacetedFilterProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => column?.setFilterValue(undefined), []);

  const selectedValues = column?.getFilterValue() as string[] || [];
  const selectedItems = options?.filter((o: FilterOption) =>
    selectedValues.includes(o[valueField as string]),
  );

  return (
    <ResponsiveFilter
      buttonContent={
        <>
          {Icon && <Icon className="size-4" />}

          <span>{title}</span>

          {selectedItems?.length > 0 && (
            <>
              <div className="h-full w-px bg-[var(--gray-a5)]" />
              <Badge className="lg:hidden">{selectedItems.length}</Badge>

              {selectedItems.length > 2 ? (
                <Badge className="max-lg:hidden">
                  {selectedItems.length} selected
                </Badge>
              ) : (
                <div className="hidden gap-1 lg:flex">
                  {selectedItems.map((val: FilterOption) => (
                    <Badge key={val[valueField as string]} className="gap-1">
                      {val.icon && <val.icon className="size-4 stroke-1" />}
                      <span>{val[labelField as string]}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      }
    >
      <ComboboxFilter
        {...{
          column,
          title,
          options,
          labelField,
          valueField,
          renderPrefix,
          showCheckbox,
        }}
      />
    </ResponsiveFilter>
  );
}

function ComboboxFilter({
  column,
  title,
  options,
  labelField,
  valueField,
  renderPrefix,
  showCheckbox,
}: FacetedFilterProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    result: filteredItems,
    query,
    setQuery,
  } = useFuse(options, {
    keys: [labelField as string],
    threshold: 0.2,
    matchAllOnEmptyQuery: true,
  });

  const { smAndUp } = useBreakpointsContext();
  const facets = column?.getFacetedUniqueValues();
  const selectedValues = column?.getFilterValue() as string[] || [];

  useEffect(() => {
    if (smAndUp && inputRef.current) {
      inputRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Combobox
      value={options?.filter((o: FilterOption) => selectedValues.includes(o[valueField as string]))}
      onChange={(list: FilterOption[]) => {
        column.setFilterValue(list.map((item: FilterOption) => item[valueField as string]));
      }}
      multiple
    >
      <div className="relative flex flex-col h-[366px] sm:h-auto sm:max-h-80 sm:w-56">
        <div className="relative bg-[var(--gray-a3)] py-1">
          <ComboboxInput
            as={Input}
            className="border-none"
            ref={inputRef}
            autoComplete="new"
            placeholder={title}
            displayValue={({ name }: { name: string }) => name}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            prefix={<MagnifyingGlassIcon className="size-4" />}
          />
        </div>

        <ComboboxOptions
          static
          className="h-auto w-full overflow-y-auto py-1 outline-hidden"
        >
          {filteredItems.length === 0 && query !== "" ? (
            <div className="relative cursor-default select-none px-2.5 py-2 text-[var(--gray-12)]">
              Nothing found for {query}
            </div>
          ) : (
            filteredItems.map(({ item, refIndex }: { item: FilterOption; refIndex: number }) => (
              <ComboboxOption
                key={refIndex}
                className={({ focus }: { focus: boolean }) =>
                  clsx(
                    "relative cursor-pointer select-none px-2.5 py-2 text-[var(--gray-12)] outline-hidden transition-colors",
                    focus && "bg-[var(--gray-a3)]",
                  )
                }
                value={item}
              >
                {({ selected }: { selected: boolean }) => (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {showCheckbox && <Checkbox checked={selected} readOnly />}
                      {item.icon && <item.icon className="size-4.5 stroke-1" />}
                      {renderPrefix && renderPrefix(item, selected)}
                      <span className="block truncate text-xs-plus">
                        {item[labelField as string]}
                      </span>
                    </div>
                    <span className="font-mono text-xs">
                      {facets?.get(item[valueField as string])}
                    </span>
                  </div>
                )}
              </ComboboxOption>
            ))
          )}
        </ComboboxOptions>
        {selectedValues?.length > 0 && (
          <Button
            onClick={() => column?.setFilterValue(undefined)}
            className="w-full shrink-0 rounded-none"
          >
            Clear Filter
          </Button>
        )}
      </div>
    </Combobox>
  );
}