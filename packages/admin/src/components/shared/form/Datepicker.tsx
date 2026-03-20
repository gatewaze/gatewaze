// Import Dependencies
import { CalendarIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import { forwardRef, useEffect, useRef, useState, useMemo } from "react";
import { BaseOptions } from "flatpickr/dist/types/options";
// import Flatpickr from "react-flatpickr";
import flatpickrCSS from "flatpickr/dist/themes/light.css?inline";

// Local Imports
import { Input, InputProps } from "@/components/ui";
import { useLocaleContext } from "@/app/contexts/locale/context";
import { useMergedRef } from "@/hooks";
import { locales } from "@/i18n/langs";
import {
  injectStyles,
  insertStylesToHead,
  makeStyleTag,
} from "@/utils/dom/injectStylesToHead";

import { Flatpickr, FlatpickrProps, FlatpickrRef } from "./Flatpickr";

// ----------------------------------------------------------------------

// Define prop types for the DatePicker component
interface DatePickerProps
  extends Omit<FlatpickrProps, "options">,
    Omit<
      InputProps<"input">,
      "defaultValue" | "value" | "onChange" | "prefix" | "type"
    > {
  options?: Partial<BaseOptions>;
  isCalendar?: boolean;
  hasCalenderIcon?: boolean;
}

const styles = `@layer vendor {
  ${flatpickrCSS}
}`;

const sheet = makeStyleTag();

injectStyles(sheet, styles);
insertStylesToHead(sheet);

const DatePicker = forwardRef<FlatpickrRef, DatePickerProps>(
  (
    {
      options: userOptions,
      className,
      isCalendar = false,
      hasCalenderIcon = true,
      ...props
    },
    ref,
  ) => {
    const flatpickrRef = useRef<FlatpickrRef | null>(null);
    const { locale } = useLocaleContext();
    const [localeData, setLocaleData] = useState<any>(null);

    useEffect(() => {
      const loadLocale = async () => {
        const currentLocale = locales[locale];
        if (currentLocale?.flatpickr) {
          const loadedLocale = await currentLocale.flatpickr();
          setLocaleData(loadedLocale);
        } else {
          setLocaleData(null);
        }
      };

      loadLocale();
    }, [locale]);

    const options = {
      inline: isCalendar,
      locale: localeData,
      ...userOptions,
    };

    const mergedRef = useMergedRef(flatpickrRef, ref);

    useEffect(() => {
      const calendarContainer =
        flatpickrRef.current?._flatpickr?.calendarContainer;
      if (calendarContainer) {
        calendarContainer.classList.toggle("is-calendar", isCalendar);
      }
    }, [isCalendar]);

    const renderComponent = useMemo(
      () => (props: any, ref: any) => {
        return isCalendar ? (
          <input ref={ref} readOnly {...props} />
        ) : (
          <Input
            ref={ref}
            prefix={
              !userOptions?.inline &&
              hasCalenderIcon && <CalendarIcon className="size-5" />
            }
            readOnly
            {...props}
          />
        );
      },
      [isCalendar, hasCalenderIcon, userOptions?.inline],
    );

    return (
      <Flatpickr
        className={clsx("cursor-pointer", isCalendar && "hidden", className)}
        options={options}
        ref={mergedRef}
        {...props}
        render={renderComponent}
      />
    );
  },
);

export { DatePicker };
