// Import Dependencies
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from "@headlessui/react";
import { ViewColumnsIcon } from "@heroicons/react/24/outline";
import { Fragment, ReactNode } from "react";

// Local Imports
import { Button, Checkbox } from "@/components/ui";
import { Table } from "@tanstack/react-table";

// ----------------------------------------------------------------------

export function TableColumnVisibility({
  table,
  description,
  header,
}: {
  table: Table<any>;
  description: string;
  header: string;
}) {
  return (
    <Popover className="relative w-full">
      <PopoverButton
        isIcon
        variant="ghost"
        className="size-8 rounded-full"
        as={Button}
      >
        <ViewColumnsIcon className="size-5" />
      </PopoverButton>
      <Transition
        as={Fragment}
        enter="transition ease-out"
        enterFrom="opacity-0 translate-y-2"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-2"
      >
        <PopoverPanel
          anchor={{ to: "bottom end", gap: 8 }}
          className="ring-primary-500/50 absolute z-100 w-60 rounded-md border border-[var(--gray-a5)] bg-[var(--color-background)] shadow-lg shadow-gray-200/50 outline-hidden focus-visible:ring-3 focus-visible:outline-hidden dark:shadow-none"
        >
          <div className="p-4">
            <h3 className="-mt-1 text-base font-medium tracking-wide text-[var(--gray-12)]">
              {header}
            </h3>
            <p className="text-xs-plus mt-1 opacity-80">{description}</p>
            <div className="mt-4 flex flex-col space-y-4 text-[var(--gray-11)]">
              {table.getAllLeafColumns().map((column) => (
                <Checkbox
                  key={column.id}
                  label={(column?.columnDef?.header || column.id) as ReactNode}
                  checked={column.getIsVisible()}
                  onChange={column.getToggleVisibilityHandler()}
                />
              ))}
            </div>
          </div>
          <Button
            variant="ghost"
            className="text-xs-plus h-9 w-full rounded-t-none border-t border-[var(--gray-a5)] leading-none"
            onClick={() => table.resetColumnVisibility()}
          >
            Show All
          </Button>
        </PopoverPanel>
      </Transition>
    </Popover>
  );
}
