// Import Dependencies
import { Radio, RadioGroup } from "@headlessui/react";
import {
  ComputerDesktopIcon,
  MoonIcon,
  SunIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";

// Local Imports
import { Button } from "@/components/ui";
import { useThemeContext } from "@/app/contexts/theme/context";
import { Fragment } from "react/jsx-runtime";

// ----------------------------------------------------------------------

export function Footer() {
  const { themeMode, setThemeMode } = useThemeContext();

  return (
    <div className="flex px-4 py-3">
      <RadioGroup
        value={themeMode}
        onChange={setThemeMode}
        className="flex w-max min-w-full rounded-lg bg-[var(--gray-a3)] px-1.5 py-1 text-[var(--gray-11)]"
      >
        <Radio value="system" as={Fragment}>
          {({ checked }) => (
            <Button
              className={clsx(
                "flex-1 shrink-0 rounded-lg px-3 py-1.5 font-medium whitespace-nowrap",
                checked
                  ? "bg-[var(--color-background)] shadow-sm text-[var(--gray-12)]"
                  : "hover:text-[var(--gray-12)] focus:text-[var(--gray-12)]",
              )}
              unstyled
            >
              <ComputerDesktopIcon className="size-5" />
            </Button>
          )}
        </Radio>
        <Radio value="light" as={Fragment}>
          {({ checked }) => (
            <Button
              unstyled
              className={clsx(
                "flex-1 shrink-0 rounded-lg px-3 py-1.5 font-medium whitespace-nowrap",
                checked
                  ? "bg-[var(--color-background)] shadow-sm text-[var(--gray-12)]"
                  : "hover:text-[var(--gray-12)] focus:text-[var(--gray-12)]",
              )}
            >
              <SunIcon className="size-5" />
            </Button>
          )}
        </Radio>
        <Radio value="dark" as={Fragment}>
          {({ checked }) => (
            <Button
              unstyled
              className={clsx(
                "flex-1 shrink-0 rounded-lg px-3 py-1.5 font-medium whitespace-nowrap",
                checked
                  ? "bg-[var(--color-background)] shadow-sm text-[var(--gray-12)]"
                  : "hover:text-[var(--gray-12)] focus:text-[var(--gray-12)]",
              )}
            >
              <MoonIcon className="size-5" />
            </Button>
          )}
        </Radio>
      </RadioGroup>
    </div>
  );
}
