import { Link, useLocation } from 'react-router-dom';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { iconMap } from './icon-map';
import type { NavigationItem } from '@gatewaze/shared';

interface NavGroupProps {
  title: string;
  items: NavigationItem[];
}

export function NavGroup({ title, items }: NavGroupProps) {
  const { pathname } = useLocation();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const Icon = iconMap[item.icon] ?? iconMap.LayoutDashboard;
          const isActive =
            pathname === item.path || pathname.startsWith(item.path + '/');

          return (
            <NavLink
              key={item.path}
              item={item}
              Icon={Icon}
              isActive={isActive}
            />
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function NavLink({
  item,
  Icon,
  isActive,
}: {
  item: NavigationItem;
  Icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
        <Link to={item.path} onClick={() => setOpenMobile(false)}>
          <Icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
