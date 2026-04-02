import { Tabs as RadixTabs } from "@radix-ui/themes";
import type { ReactNode } from "react";

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
}

export function Tabs({ value, onChange, tabs, className, fullWidth }: TabsProps) {
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
