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
          // overflow-x-auto with hidden scrollbars: on a phone, a strip of
          // seven sub-tabs is wider than the screen, and without this it
          // widens the whole document instead of scrolling — every page
          // renders at phone width against a void (the Body metrics screen
          // was the reported case). flex-nowrap + shrink-0 children keep the
          // labels readable rather than crushing them.
          "flex gap-1 border-b border-[var(--gray-a5)]",
          "flex-nowrap overflow-x-auto overscroll-x-contain",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
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
                "px-4 py-2 text-sm font-medium transition-colors -mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap",
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
      {/* Same phone problem as the underline variant: Radix's list does not
          scroll on its own, so a long strip widens the document. */}
      <RadixTabs.List className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.id}
            value={tab.id}
            // Radix fires onValueChange only when the value actually changes,
            // so clicking the already-active tab is a no-op. For URL-driven
            // strips that strands a drill-in page (e.g. /series/:id, where the
            // Series tab is lit) with no way to use its own tab to get back to
            // the list. Re-fire onChange when the active tab is clicked so the
            // consumer can navigate to that tab's base route. Inactive clicks
            // are left to onValueChange to avoid a double call.
            onClick={() => {
              if (tab.id === value) onChange(tab.id);
            }}
          >
            {tab.icon && <span className="inline-flex shrink-0">{tab.icon}</span>}
            {tab.label}
            {tab.count !== undefined && ` (${tab.count})`}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
    </RadixTabs.Root>
  );
}
