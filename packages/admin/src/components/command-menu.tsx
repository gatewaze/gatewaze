import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Laptop, Moon, Sun } from 'lucide-react';
import { useSearch } from '@/app/contexts/search/SearchProvider';
import { useTheme } from '@/app/contexts/theme/ThemeProvider';
import { CORE_NAV_ITEMS, NAV_GROUPS } from '@/config/features';
import { moduleRegistry } from '@/config/modules';
import { isFeatureEnabled } from '@/config/modules';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { ScrollArea } from '@/components/ui/scroll-area';

export function CommandMenu() {
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const { open, setOpen } = useSearch();

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      setOpen(false);
      command();
    },
    [setOpen],
  );

  // Build nav items filtered by enabled features
  const allNavItems = [...CORE_NAV_ITEMS, ...moduleRegistry.getNavItems()];
  const enabledItems = allNavItems.filter((item) =>
    isFeatureEnabled(item.requiredFeature),
  );

  // Group items
  const groupedItems = NAV_GROUPS.map((group) => ({
    ...group,
    items: enabledItems
      .filter((item) => item.parentGroup === group.id)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
  })).filter((group) => group.items.length > 0);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <ScrollArea className="h-72 pr-1">
          <CommandEmpty>No results found.</CommandEmpty>
          {groupedItems.map((group) => (
            <CommandGroup key={group.id} heading={group.label}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.path}
                  value={item.label}
                  onSelect={() => {
                    runCommand(() => navigate(item.path));
                  }}
                >
                  <div className="mr-2 flex size-4 items-center justify-center">
                    <ArrowRight className="size-2 text-muted-foreground/80" />
                  </div>
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          <CommandSeparator />
          <CommandGroup heading="Theme">
            <CommandItem onSelect={() => runCommand(() => setTheme('light'))}>
              <Sun className="mr-2" />
              <span>Light</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('dark'))}>
              <Moon className="mr-2" />
              <span>Dark</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('system'))}>
              <Laptop className="mr-2" />
              <span>System</span>
            </CommandItem>
          </CommandGroup>
        </ScrollArea>
      </CommandList>
    </CommandDialog>
  );
}
