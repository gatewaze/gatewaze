// Import Dependencies
import { useCallback, useEffect } from "react";
import { CalendarIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";
import dayjs from "dayjs";
import { Column } from "@tanstack/react-table";
import React from "react";

// Local Imports
import { Button } from "@/components/ui";
import { locale } from "@/utils/localeUtils";
import { DatePicker } from "../form/Datepicker";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { ResponsiveFilter } from "./ResponsiveFilter";
import { BaseOptions, DateOption } from "../form/Flatpickr";

// ----------------------------------------------------------------------

export const DateFilter = React.memo(({
  column,
  title,
  config,
}: {
  column: Column<any>;
  title: string;
  config: Partial<BaseOptions>;
}) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => column?.setFilterValue(undefined), []);
  const { smAndDown } = useBreakpointsContext();
  const selectedValues = column?.getFilterValue() as DateOption[] | undefined;

  
  const handleDateChange = useCallback((date: Date[]) => {
    if (date.length === 0) {
      column.setFilterValue([null, null]);
    }
    if (date.length === 2) {
      column.setFilterValue([date[0].getTime(), date[1].getTime()]);
    }
  }, [column]);

  return (
    <ResponsiveFilter
      buttonContent={
        <>
          <CalendarIcon className="size-4" />
          <span> {title}</span>

          {selectedValues && (
            <>
              <div className="h-full w-px bg-[var(--gray-a5)]" />
              <span>
                {dayjs(selectedValues[0]).locale(locale).format("DD MMM YYYY")}{" "}
                -{" "}
                {dayjs(selectedValues[1]).locale(locale).format("DD MMM YYYY")}
              </span>
            </>
          )}
        </>
      }
    >
      <div
        className={clsx(
          "mx-auto flex w-full items-center justify-between",
          smAndDown
            ? "mt-1 mb-2 h-10 w-full max-w-xs border-b border-[var(--gray-a5)] py-3"
            : "bg-[var(--gray-a3)] px-2.5 py-2",
        )}
      >
        <p className="truncate text-start text-base font-medium text-[var(--gray-12)] sm:py-1 sm:text-sm">
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

      <div className="max-sm:mx-auto max-sm:[&_.is-calendar]:w-80 max-sm:[&_.is-calendar]:max-w-none">
        <DatePicker
          isCalendar
          value={selectedValues ?? ""}
          onChange={handleDateChange}
          options={config}
        />
      </div>
    </ResponsiveFilter>
  );
});
