/**
 * BadgeSelect — a clickable status badge that opens a dropdown to pick a
 * new value. Lives in admin-core (not in a module) on purpose: it imports
 * `@radix-ui/themes`, and Radix's DropdownMenu calls `useThemeContext`,
 * which must resolve to the SAME physical copy of the package as the app's
 * <Theme> provider. Module bundles get code-split into their own chunk in
 * the production Rollup build and can end up with a *duplicate* copy of
 * `@radix-ui/themes` — a second ThemeContext with no provider — which
 * throws "useThemeContext must be used within a Theme". Keeping the Radix
 * import here (consumed by modules via the `@/` alias) guarantees the
 * singleton, exactly like RowActions.
 */

import { DropdownMenu } from '@radix-ui/themes';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { Badge } from '@/components/ui';

type BadgeColor = 'green' | 'amber' | 'gray' | 'red' | 'blue';

export interface BadgeSelectOption {
  value: string;
  label: string;
  color?: BadgeColor;
}

interface BadgeSelectProps {
  value: string;
  options: BadgeSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
}

export function BadgeSelect({ value, options, onChange, disabled, title }: BadgeSelectProps) {
  const current = options.find((o) => o.value === value);
  const color: BadgeColor = current?.color ?? 'gray';
  const label = current?.label ?? value;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button
          type="button"
          disabled={disabled}
          title={title ?? 'Change'}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="cursor-pointer disabled:opacity-60"
        >
          <Badge color={color} variant="soft" className="cursor-pointer">
            {label}
            <ChevronDownIcon className="size-3 ml-0.5 opacity-70" />
          </Badge>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" size="1" onClick={(e) => e.stopPropagation()}>
        {options.map((o) => (
          <DropdownMenu.Item
            key={o.value}
            disabled={disabled || o.value === value}
            onClick={(e) => {
              e.stopPropagation();
              onChange(o.value);
            }}
          >
            {o.label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
