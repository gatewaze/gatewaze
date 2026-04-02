// Import Dependencies
import { ReactNode, useEffect, useRef } from "react";
import clsx from "clsx";
import { Column } from "@tanstack/react-table";

// Local Imports
import { Button, Input } from "@/components/ui";
import { ResponsiveFilter } from "./ResponsiveFilter";

interface FilterContentProps {
  column: Column<any>;
  title: string;
  MinPrefixIcon?: React.ComponentType<{ className?: string }>;
  MaxPrefixIcon?: React.ComponentType<{ className?: string }>;
}

interface RangeFilterProps extends FilterContentProps {
  Icon?: React.ComponentType<{ className?: string }>;
  buttonText: (values: { min?: number; max?: number }) => ReactNode;
}

// ----------------------------------------------------------------------

export function RangeFilter({
  column,
  title,
  Icon,
  MinPrefixIcon,
  MaxPrefixIcon,
  buttonText,
}: RangeFilterProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => column?.setFilterValue(undefined), []);

  const selectedValues = column?.getFilterValue() as
    | [number, number]
    | undefined;

  return (
    <ResponsiveFilter
      buttonContent={
        <>
          {Icon && <Icon className="size-4" />}

          <span> {title}</span>

          {selectedValues && selectedValues.length > 0 && (
            <>
              <div className="h-full w-px bg-[var(--gray-a5)]" />
              <span>
                {buttonText({
                  min: selectedValues?.[0],
                  max: selectedValues?.[1],
                })}
              </span>
            </>
          )}
        </>
      }
    >
      <FilterContent {...{ column, title, MinPrefixIcon, MaxPrefixIcon }} />
    </ResponsiveFilter>
  );
}

function FilterContent({
  column,
  title,
  MinPrefixIcon,
  MaxPrefixIcon,
}: FilterContentProps) {
  const selectedValues = column?.getFilterValue() as
    | [number, number]
    | undefined;
  const [min, max] = column.getFacetedMinMaxValues() as [number, number];
  const minInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => minInputRef.current?.focus(), []);

  return (
    <div className="sm:w-72">
      <div className="bg-[var(--gray-a3)] flex items-center justify-between px-2.5 py-2">
        <p className="truncate py-1 text-start font-medium text-[var(--gray-12)]">
          {title}
        </p>
        {selectedValues && (
          <Button
            onClick={() => column?.setFilterValue(undefined)}
            className="h-7 px-3 text-xs"
          >
            Clear
          </Button>
        )}
      </div>

      <div className="flex gap-2 p-3">
        <Input
          type="number"
          ref={minInputRef}
          value={selectedValues?.[0] ?? ""}
          onChange={(e) =>
            column.setFilterValue((old: [number, number] | undefined) => [
              e.target.value,
              old?.[1] ?? "",
            ])
          }
          label="Min"
          placeholder={min.toString()}
          className={clsx(MinPrefixIcon && "ltr:pl-8! rtl:pr-8!")}
          prefix={
            MinPrefixIcon && <MinPrefixIcon className="stroke-1.5 size-4.5" />
          }
        />
        <Input
          type="number"
          value={selectedValues?.[1] ?? ""}
          onChange={(e) =>
            column.setFilterValue((old: [number, number] | undefined) => [
              old?.[0] ?? "",
              e.target.value,
            ])
          }
          placeholder={max.toString()}
          label="Max"
          className={clsx(MaxPrefixIcon && "ltr:pl-8! rtl:pr-8!")}
          prefix={
            MaxPrefixIcon && <MaxPrefixIcon className="stroke-1.5 size-4.5" />
          }
        />
      </div>
    </div>
  );
}
