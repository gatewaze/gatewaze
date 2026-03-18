import { Link } from 'react-router-dom';
import { Command } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { CORE_NAV_ITEMS, NAV_GROUPS } from '@/config/features';
import { moduleRegistry, isFeatureEnabled } from '@/config/modules';
import { useFeaturePermissions } from '@/hooks/useFeaturePermissions';
import { useAppSettings } from '@/hooks/useAppSettings';
import { isBrandingEnabled, GITHUB_URL } from '@/lib/branding';
import { NavGroup } from './NavGroup';
import { NavUser } from './NavUser';

export function AppSidebar() {
  const { hasFeature, isSuperAdmin } = useFeaturePermissions();
  const { appName } = useAppSettings();

  // Combine core nav items with module nav items
  const allNavItems = [...CORE_NAV_ITEMS, ...moduleRegistry.getNavItems()];

  // Filter by feature enablement and permissions
  const visibleItems = allNavItems.filter((item) => {
    if (!isFeatureEnabled(item.requiredFeature)) return false;
    if (isSuperAdmin) return true;
    return hasFeature(item.requiredFeature);
  });

  // Group items by parentGroup
  const groupedItems = NAV_GROUPS.map((group) => ({
    ...group,
    items: visibleItems
      .filter((item) => item.parentGroup === group.id)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
  })).filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/home">
                {isBrandingEnabled ? (
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg overflow-hidden">
                    <img
                      src="/gatewaze-icon-512.png"
                      alt={appName}
                      className="size-8"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <Command className="size-4" />
                  </div>
                )}
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{appName}</span>
                  <span className="truncate text-xs">Admin</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groupedItems.map((group) => (
          <NavGroup key={group.id} title={group.label} items={group.items} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
