import { InputHTMLAttributes, ReactNode, Ref } from "react";
import type { Instance } from "flatpickr/dist/types/instance";
import type { DateOption } from "flatpickr/dist/types/options";

export const hooks = [
  "onChange",
  "onOpen",
  "onClose",
  "onMonthChange",
  "onYearChange",
  "onReady",
  "onValueUpdate",
  "onDayCreate",
] as const;

export const callbacks = ["onCreate", "onDestroy"] as const;

export type HookName = (typeof hooks)[number];

export type FlatpickrHookCallback = (
  selectedDates: Date[],
  dateStr: string,
  instance: Instance,
  data?: any,
) => void;

export interface FlatpickrProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "defaultValue"
  > {
  defaultValue?: DateOption | DateOption[] | "";
  options?: Record<string, any>;
  onChange?: FlatpickrHookCallback | FlatpickrHookCallback[];
  onOpen?: FlatpickrHookCallback | FlatpickrHookCallback[];
  onClose?: FlatpickrHookCallback | FlatpickrHookCallback[];
  onMonthChange?: FlatpickrHookCallback | FlatpickrHookCallback[];
  onYearChange?: FlatpickrHookCallback | FlatpickrHookCallback[];
  onReady?: FlatpickrHookCallback | FlatpickrHookCallback[];
  onValueUpdate?: FlatpickrHookCallback | FlatpickrHookCallback[];
  onDayCreate?: FlatpickrHookCallback | FlatpickrHookCallback[];
  onCreate?: (instance: Instance) => void;
  onDestroy?: (instance: Instance) => void;
  value?: DateOption | DateOption[] | "";
  children?: ReactNode;
  className?: string;
  render?: (props: any, nodeRef: Ref<HTMLElement>) => ReactNode;
  wrap?: boolean;
}

export interface FlatpickrRef extends HTMLElement {
  _flatpickr?: Instance;
}
