import type { NavigationItem } from '@gatewaze/shared';

export const CORE_NAV_ITEMS: NavigationItem[] = [
  {
    path: '/home',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    requiredFeature: 'dashboard_home',
    parentGroup: 'main',
    order: 1,
  },
  {
    path: '/events',
    label: 'Events',
    icon: 'Calendar',
    requiredFeature: 'events',
    parentGroup: 'main',
    order: 2,
  },
  {
    path: '/calendars',
    label: 'Calendars',
    icon: 'CalendarDays',
    requiredFeature: 'calendars',
    parentGroup: 'main',
    order: 3,
  },
  {
    path: '/members',
    label: 'Members',
    icon: 'Users',
    requiredFeature: 'dashboard_members',
    parentGroup: 'main',
    order: 4,
  },
  {
    path: '/admin/emails',
    label: 'Emails',
    icon: 'Mail',
    requiredFeature: 'emails',
    parentGroup: 'admin',
    order: 10,
  },
  {
    path: '/admin/users',
    label: 'Users',
    icon: 'UserCog',
    requiredFeature: 'users',
    parentGroup: 'admin',
    order: 11,
  },
  {
    path: '/admin/accounts',
    label: 'Accounts',
    icon: 'Building2',
    requiredFeature: 'accounts',
    parentGroup: 'admin',
    order: 12,
  },
  {
    path: '/admin/db-copy',
    label: 'Database',
    icon: 'DatabaseZap',
    requiredFeature: 'db_copy',
    parentGroup: 'system',
    order: 19,
  },
  {
    path: '/settings',
    label: 'Settings',
    icon: 'Settings',
    requiredFeature: 'settings',
    parentGroup: 'system',
    order: 20,
  },
];

export const NAV_GROUPS = [
  { id: 'main', label: 'Main', order: 1 },
  { id: 'admin', label: 'Administration', order: 2 },
  { id: 'system', label: 'System', order: 3 },
] as const;
