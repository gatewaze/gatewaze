import { ReactNode } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import { EllipsisVerticalIcon } from "@heroicons/react/20/solid";

export interface RowAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  color?: "red";
  disabled?: boolean;
  hidden?: boolean;
}

interface RowActionsProps {
  actions: RowAction[];
}

export function RowActions({ actions }: RowActionsProps) {
  const visibleActions = actions.filter((a) => !a.hidden);

  if (visibleActions.length === 0) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button
          className="inline-flex items-center justify-center size-8 rounded-md text-[var(--accent-9)] hover:text-[var(--accent-11)] hover:bg-[var(--accent-a3)] transition-colors cursor-pointer"
          aria-label="Row actions"
        >
          <EllipsisVerticalIcon className="size-5" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" size="1">
        {visibleActions.map((action) => (
          <DropdownMenu.Item
            key={action.label}
            onClick={action.onClick}
            disabled={action.disabled}
            color={action.color}
          >
            {action.icon && (
              <span className="size-4 shrink-0">{action.icon}</span>
            )}
            {action.label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
