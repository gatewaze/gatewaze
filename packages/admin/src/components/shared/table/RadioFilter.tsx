// Import Dependencies
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useEffect, useRef, ComponentType } from "react";
import { Column } from "@tanstack/react-table";

// Local Imports
import { Badge, Button, Input, Radio } from "@/components/ui";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { useFuse } from "@/hooks";
import { ResponsiveFilter } from "./ResponsiveFilter";
import { compareArrays } from "@/utils/compareArrays";

// ----------------------------------------------------------------------

interface OptionType {
  value: any[];
  label: string;
}

interface ContentProps {
  column: Column<any>;
  title: string;
  options: OptionType[];
}

interface RadioFilterProps extends ContentProps {
  Icon?: ComponentType<{ className?: string }>;
}

export function RadioFilter({
  column,
  options,
  title,
  Icon,
}: RadioFilterProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => column?.setFilterValue(undefined), []);

  const selectedValue = (column?.getFilterValue() || []) as any[];

  const selectedItem = options.find(({ value }) => {
    return compareArrays(value, selectedValue);
  });

  return (
    <ResponsiveFilter
      buttonContent={
        <>
          {Icon && <Icon className="size-4" />}
          <span> {title} </span>
          {selectedItem && (
            <>
              <div className="h-full w-px bg-[var(--gray-a5)]" />
              <Badge>{selectedItem.label}</Badge>
            </>
          )}
        </>
      }
    >
      <Content {...{ column, title, options }} />
    </ResponsiveFilter>
  );
}

function Content({ column, title, options }: ContentProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { smAndDown } = useBreakpointsContext();

  const {
    result: filteredItems,
    query,
    setQuery,
  } = useFuse(options, {
    keys: ["label"],
    threshold: 0.2,
    matchAllOnEmptyQuery: true,
  });

  const selectedValue = (column?.getFilterValue() || []) as any[];

  useEffect(() => {
    if (!smAndDown && inputRef.current) {
      inputRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Combobox
      value={
        options.find((item: OptionType) => item.value === selectedValue) || null
      }
      onChange={(item: OptionType | null) => {
        if (item) column.setFilterValue(item?.value);
      }}
    >
      <div className="relative">
        <div className="relative bg-[var(--gray-a3)] py-1">
          <ComboboxInput
            as={Input}
            className="border-none"
            ref={inputRef}
            autoComplete="new"
            placeholder={title}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setQuery(event.target.value)
            }
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
                  <div className="flex min-w-0 items-center space-x-2">
                    <Radio checked={selected} readOnly />
                    <span className="text-xs-plus block truncate">
                      {(item as OptionType).label}
                    </span>
                  </div>
                )}
              </ComboboxOption>
            ))
          )}
        </ComboboxOptions>
        {selectedValue?.length > 0 && (
          <Button
            onClick={() => column?.setFilterValue(undefined)}
            className="w-full rounded-none"
          >
            Clear Filter
          </Button>
        )}
      </div>
    </Combobox>
  );
}
