import { Tabs as RadixTabs } from "@radix-ui/themes";
import type { ReactNode } from "react";
import clsx from "clsx";

export interface Tab {
  id: string;
  label: string;
  count?: number;
  icon?: ReactNode;
}

export interface TabsProps {
  value: string;
  onChange: (tabId: string) => void;
  tabs: Tab[];
  className?: string;
  /** When true, uses wider padding suited for full-width hero headers */
  fullWidth?: boolean;
  /**
   * Visual variant.
   * - `default`: Radix Themes Tabs (used for the primary/top-level tab strip)
   * - `underline`: flat hand-rolled underline tabs, intended for secondary
   *   sub-tabs nested under a primary tab strip so the two levels are
   *   visually distinct.
   */
  variant?: "default" | "underline";
}

export function Tabs({
  value,
  onChange,
  tabs,
  className,
  fullWidth,
  variant = "default",
}: TabsProps) {
  if (variant === "underline") {
    return (
      <div
        role="tablist"
        className={clsx(
          "flex gap-1 border-b border-[var(--gray-a5)]",
          fullWidth && "px-(--margin-x)",
          className,
        )}
      >
        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.id)}
              className={clsx(
                "px-4 py-2 text-sm font-medium transition-colors -mb-px inline-flex items-center gap-2 whitespace-nowrap",
                active
                  ? "border-b-2 border-[var(--accent-9)] text-[var(--accent-11)]"
                  : "border-b-2 border-transparent text-[var(--gray-a9)] hover:text-[var(--gray-12)]",
              )}
            >
              {tab.icon && <span className="inline-flex shrink-0">{tab.icon}</span>}
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className={clsx("text-xs", active ? "text-[var(--accent-11)]" : "text-[var(--gray-a9)]")}>
                  ({tab.count})
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // Default (Radix Themes) variant. Radix already renders a horizontal
  // bottom underline at the base of the tab strip; pages compose their
  // own surrounding layout (action bars, cards, etc.) below it.
  return (
    <RadixTabs.Root value={value} onValueChange={onChange} className={className} {...(fullWidth ? { "data-full-width": "" } : {})}>
      <RadixTabs.List>
        {tabs.map((tab) => (
          <RadixTabs.Trigger key={tab.id} value={tab.id}>
            {tab.icon && <span className="inline-flex shrink-0">{tab.icon}</span>}
            {tab.label}
            {tab.count !== undefined && ` (${tab.count})`}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
    </RadixTabs.Root>
  );
}
