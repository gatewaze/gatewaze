// Import Dependencies
import { FunnelIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useEffect, useRef } from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { Table } from "@tanstack/react-table";
import invariant from "tiny-invariant";

// Local Imports
import { Badge, Button, Checkbox, Input } from "@/components/ui";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { useFuse } from "@/hooks";
import { ResponsiveFilter } from "./ResponsiveFilter";

// ----------------------------------------------------------------------

export interface FilterOption {
  value: string;
  label: string;
}

export function FilterSelector({
  table,
  options,
}: {
  table: Table<any>;
  options: FilterOption[];
}) {
  const selectedFiltersLength = table?.getState()?.toolbarFilters?.length ?? 0;

  return (
    <ResponsiveFilter
      buttonContent={
        <>
          <FunnelIcon className="size-4" />
          <span> Filter </span>

          {selectedFiltersLength > 0 && (
            <>
              <div className="h-full w-px bg-[var(--gray-a5)]" />
              <Badge>{selectedFiltersLength}</Badge>
            </>
          )}
        </>
      }
    >
      <Content
        {...{
          table,
          options,
        }}
      />
    </ResponsiveFilter>
  );
}

function Content({
  table,
  options,
}: {
  table: Table<any>;
  options: FilterOption[];
}) {
  const selectedValues = table?.getState()?.toolbarFilters || [];
  const inputRef = useRef<HTMLInputElement>(null);
  const { smAndUp } = useBreakpointsContext();
  const setToolbarFilters = table?.options?.meta?.setToolbarFilters;

  invariant(setToolbarFilters, "setToolbarFilters is required");

  const {
    result: filteredItems,
    query,
    setQuery,
  } = useFuse(options, {
    keys: ["label"],
    threshold: 0.2,
    matchAllOnEmptyQuery: true,
  });

  useEffect(() => {
    if (smAndUp && inputRef.current) inputRef.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (list: FilterOption[]) => {
    setToolbarFilters(list?.map((item) => item.value));
  };

  return (
    <Combobox
      value={selectedValues.map((value) =>
        options.find((obj) => obj.value === value),
      )}
      onChange={(value) => handleChange(value.filter(v => v !== undefined) as FilterOption[])}
      as="div"
      multiple
      className="sm:w-56"
    >
      <div className="relative">
        <div className="relative bg-[var(--gray-a3)] py-1">
          <ComboboxInput
            as={Input}
            className="border-none"
            ref={inputRef}
            autoComplete="new"
            placeholder="Select Filters"
            onChange={(event) => setQuery(event.target.value)}
            prefix={<MagnifyingGlassIcon className="size-4" />}
          />
        </div>

        <ComboboxOptions
          static
          className="max-h-72 w-full overflow-y-auto py-1 outline-hidden"
        >
          {filteredItems.length === 0 && query !== "" ? (
            <div className="relative cursor-default px-2.5 py-2 text-[var(--gray-12)] select-none">
              Nothing found for {query}
            </div>
          ) : (
            filteredItems.map(({ item, refIndex }) => (
              <ComboboxOption
                key={refIndex}
                className={({ focus }) =>
                  clsx(
                    "relative cursor-pointer px-2.5 py-2 text-[var(--gray-12)] outline-hidden transition-colors select-none",
                    focus && "bg-[var(--gray-a3)]",
                  )
                }
                value={item}
              >
                {({ selected }) => (
                  <div className="flex items-center justify-between space-x-2">
                    <div className="flex min-w-0 items-center space-x-2">
                      <Checkbox checked={selected} readOnly />

                      <span className="text-xs-plus block truncate">
                        {item.label}
                      </span>
                    </div>
                  </div>
                )}
              </ComboboxOption>
            ))
          )}
        </ComboboxOptions>
        {selectedValues?.length > 0 && (
          <Button
            onClick={() => setToolbarFilters([])}
            className="w-full rounded-none"
          >
            Clear Filter
          </Button>
        )}
      </div>
    </Combobox>
  );
}
