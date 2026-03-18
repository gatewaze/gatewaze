// @ts-nocheck
import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  HTMLAttributes,
  InputHTMLAttributes,
  useCallback,
  useMemo,
} from "react";
import flatpickr from "flatpickr";
import type { Instance } from "flatpickr/dist/types/instance";

import { FlatpickrProps, FlatpickrRef, hooks, callbacks } from "./types";
import { formatDateValue, formatAndSetValue } from "./utils";

const Flatpickr = forwardRef<FlatpickrRef, FlatpickrProps>((props, ref) => {
  const {
    options = {},
    defaultValue,
    value,
    children,
    render,
    onChange,
    onOpen,
    onClose,
    onMonthChange,
    onYearChange,
    onReady,
    onValueUpdate,
    onDayCreate,
    onCreate,
    onDestroy,
    wrap,
    ...restProps
  } = props;

  const elementRef = useRef<FlatpickrRef | null>(null);
  const fpRef = useRef<Instance | null>(null);

  const flatpickrOptions = useMemo(() => {
    return {
      ...options,
      onChange,
      onOpen,
      onClose,
      onMonthChange,
      onYearChange,
      onReady,
      onValueUpdate,
      onDayCreate,
    };
  }, [
    options,
    onChange,
    onOpen,
    onClose,
    onMonthChange,
    onYearChange,
    onReady,
    onValueUpdate,
    onDayCreate,
  ]);

  useImperativeHandle(ref, () => {
    if (elementRef.current) {
      elementRef.current._flatpickr = fpRef.current || undefined;
    }
    return elementRef.current as FlatpickrRef;
  });

  const initFlatpickr = useCallback(() => {
    if (!elementRef.current) return;

    try {
      const instance = flatpickr(
        elementRef.current,
        flatpickrOptions,
      ) as Instance;

      fpRef.current = instance;

      if (value !== undefined && value !== "") {
        formatAndSetValue(instance, value);
      }

      if (onCreate) {
        onCreate(instance);
      }
    } catch (error) {
      console.error("Error initializing flatpickr:", error);
    }
  }, [flatpickrOptions, value, onCreate]);

  const destroyFlatpickr = useCallback(() => {
    if (fpRef.current) {
      if (onDestroy) {
        onDestroy(fpRef.current);
      }
      fpRef.current.destroy();
      fpRef.current = null;
    }
  }, [onDestroy]);

  const handleElementRef = useCallback(
    (element: FlatpickrRef | null) => {
      elementRef.current = element;

      if (element && !fpRef.current) {
        initFlatpickr();
      }
    },
    [initFlatpickr],
  );

  useEffect(() => {
    if (elementRef.current && !fpRef.current) {
      initFlatpickr();
    }

    return () => {
      destroyFlatpickr();
    };
  }, [destroyFlatpickr, initFlatpickr]);

  useEffect(() => {
    if (fpRef.current && value !== undefined) {
      formatAndSetValue(fpRef.current, value);
    }
  }, [value]);

  useEffect(() => {
    if (wrap) {
      destroyFlatpickr();
      initFlatpickr();
    }
  }, [children, wrap, destroyFlatpickr, initFlatpickr]);

  const filteredProps = useMemo(() => {
    const filtered = { ...restProps };
    hooks.forEach((hook) => {
      delete (filtered as any)[hook];
    });
    callbacks.forEach((callback) => {
      delete (filtered as any)[callback];
    });
    return filtered;
  }, [restProps]);

  const getFormattedValue = useCallback(() => {
    if (value === undefined || value === "") {
      if (defaultValue && fpRef.current) {
        return formatDateValue(fpRef.current, defaultValue);
      }
      return defaultValue || "";
    }

    if (fpRef.current) {
      return formatDateValue(fpRef.current, value);
    }

    return value;
  }, [value, defaultValue]);

  const renderedValue = useMemo(() => getFormattedValue(), [getFormattedValue]);

  if (render) {
    return render({ ...filteredProps, value: renderedValue }, elementRef);
  }

  return wrap ? (
    <div
      {...(filteredProps as HTMLAttributes<HTMLDivElement>)}
      ref={handleElementRef}
    >
      {children}
    </div>
  ) : (
    <input
      {...(filteredProps as InputHTMLAttributes<HTMLInputElement>)}
      defaultValue={String(renderedValue)}
      ref={handleElementRef}
    />
  );
});

Flatpickr.displayName = "Flatpickr";

export { Flatpickr };
