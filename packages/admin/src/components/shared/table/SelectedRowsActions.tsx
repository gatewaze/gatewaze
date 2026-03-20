// Import Dependencies
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from "@headlessui/react";
import { EllipsisHorizontalIcon } from "@heroicons/react/20/solid";
import {
  ArrowUpTrayIcon,
  ArrowUturnLeftIcon,
  PrinterIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { Fragment, useState } from "react";
import { CiViewTable } from "react-icons/ci";
import { Table } from "@tanstack/react-table";
import invariant from "tiny-invariant";

// Local Imports
import { Button, GhostSpinner } from "@/components/ui";

// ----------------------------------------------------------------------

export function SelectedRowsActions({
  table,
  height,
}: {
  table: Table<any>;
  height?: number;
}) {
  const [deleteLoading, setDeleteLoading] = useState(false);
  const selectedRows = table.getSelectedRowModel().rows;

  const handleDeleteRows = () => {
    invariant(table.options.meta?.deleteRows, "deleteRows is not defined");

    if (selectedRows.length > 0) {
      setDeleteLoading(true);
      setTimeout(() => {
        table.options.meta?.deleteRows?.(selectedRows);
        setDeleteLoading(false);
      }, 1000);
    }
  };

  if (!table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()) {
    return null;
  }

  return (
    <div
      className="absolute top-0 w-full rounded-t-lg bg-gray-800 text-gray-100"
      style={{ height }}
    >
      <div className="flex h-full items-center justify-between rounded-t-lg px-4 sm:px-5">
        <p className="font-medium">
          <span>{selectedRows.length} Selected</span>
          <span className="max-sm:hidden">
            {" "}
            from {table.getCoreRowModel().rows.length}
          </span>
        </p>
        <div className="flex space-x-1.5">
          <Button
            onClick={handleDeleteRows}
            className="text-xs-plus w-7 gap-1.5 rounded-full px-3 py-1.5 sm:w-auto sm:rounded-sm"
            color="error"
            disabled={deleteLoading || selectedRows.length <= 0}
          >
            {deleteLoading ? (
              <div className="flex size-4 items-center justify-center">
                <GhostSpinner
                  className="size-3.5 shrink-0 border-2"
                  variant="soft"
                />
              </div>
            ) : (
              <TrashIcon className="size-4 shrink-0" />
            )}
            <span className="max-sm:hidden">Delete</span>
          </Button>
          <Button
            onClick={() => table.resetRowSelection()}
            className="text-xs-plus w-7 gap-1.5 rounded-full px-3 py-1.5 sm:w-auto sm:rounded-sm"
          >
            <ArrowUturnLeftIcon className="size-3.5 shrink-0" />
            <span className="max-sm:hidden">Cancel</span>
          </Button>
          <Menu as="div" className="relative inline-block text-left">
            <MenuButton
              as={Button}
              className="text-xs-plus w-7 gap-1.5 rounded-full px-3 py-1.5 sm:w-auto sm:rounded-sm"
            >
              <EllipsisHorizontalIcon className="size-4 shrink-0" />
              <span className="max-sm:hidden"> More</span>{" "}
            </MenuButton>
            <Transition
              as={Fragment}
              enter="transition ease-out"
              enterFrom="opacity-0 translate-y-2"
              enterTo="opacity-100 translate-y-0"
              leave="transition ease-in"
              leaveFrom="opacity-100 translate-y-0"
              leaveTo="opacity-0 translate-y-2"
            >
              <MenuItems className="text-xs-plus shadow-soft absolute z-100 mt-1.5 min-w-[10rem] rounded-lg border border-[var(--gray-a5)] bg-[var(--color-background)] py-1 text-[var(--gray-11)] outline-hidden focus-visible:outline-hidden ltr:right-0 rtl:left-0 dark:shadow-none">
                <MenuItem>
                  {({ focus }) => (
                    <button
                      className={clsx(
                        "flex h-9 w-full items-center space-x-3 px-3 tracking-wide outline-hidden transition-colors",
                        focus &&
                          "bg-[var(--gray-a3)] text-[var(--gray-12)]",
                      )}
                    >
                      <ArrowUpTrayIcon className="size-4.5" />
                      <span>Export CVS</span>
                    </button>
                  )}
                </MenuItem>
                <MenuItem>
                  {({ focus }) => (
                    <button
                      className={clsx(
                        "flex h-9 w-full items-center space-x-3 px-3 tracking-wide outline-hidden transition-colors",
                        focus &&
                          "bg-[var(--gray-a3)] text-[var(--gray-12)]",
                      )}
                    >
                      <ArrowUpTrayIcon className="size-4.5" />
                      <span>Export PDF</span>
                    </button>
                  )}
                </MenuItem>
                <MenuItem>
                  {({ focus }) => (
                    <button
                      className={clsx(
                        "flex h-9 w-full items-center space-x-3 px-3 tracking-wide outline-hidden transition-colors",
                        focus &&
                          "bg-[var(--gray-a3)] text-[var(--gray-12)]",
                      )}
                    >
                      <CiViewTable className="size-4.5" />
                      <span>Save as view</span>
                    </button>
                  )}
                </MenuItem>
                <MenuItem>
                  {({ focus }) => (
                    <button
                      className={clsx(
                        "flex h-9 w-full items-center space-x-3 px-3 tracking-wide outline-hidden transition-colors",
                        focus &&
                          "bg-[var(--gray-a3)] text-[var(--gray-12)]",
                      )}
                    >
                      <PrinterIcon className="size-4.5" />
                      <span>Print</span>
                    </button>
                  )}
                </MenuItem>
              </MenuItems>
            </Transition>
          </Menu>
        </div>
      </div>
    </div>
  );
}
