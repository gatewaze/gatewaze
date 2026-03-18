export type AdminFeature =
  | 'dashboard_home'
  | 'dashboard_members'
  | 'accounts'
  | 'users'
  | 'events'
  | 'calendars'
  | 'emails'
  | 'settings'
  | 'scheduler';

export const CORE_FEATURES: readonly string[] = [
  'dashboard_home',
  'dashboard_members',
  'events',
  'calendars',
  'emails',
  'settings',
  'users',
  'accounts',
] as const;

export interface AdminPermission {
  id: string;
  admin_id: string;
  feature: string;
  is_active: boolean;
  granted_by?: string;
  granted_at: string;
  expires_at?: string;
}

export interface PermissionGroup {
  id: string;
  name: string;
  description?: string;
  features: string[];
  created_at: string;
}

export type AdminPermissionsMap = Record<string, boolean>;

export interface FeatureMetadata {
  key: string;
  label: string;
  description: string;
  category: 'dashboard' | 'admin' | 'content' | 'account' | 'system';
  route: string;
}

export const FEATURE_METADATA: FeatureMetadata[] = [
  { key: 'dashboard_home', label: 'Dashboard', description: 'Main dashboard', category: 'dashboard', route: '/home' },
  { key: 'dashboard_members', label: 'Members Dashboard', description: 'Member analytics', category: 'dashboard', route: '/members' },
  { key: 'events', label: 'Events', description: 'Event management', category: 'content', route: '/events' },
  { key: 'calendars', label: 'Calendars', description: 'Calendar management', category: 'content', route: '/calendars' },
  { key: 'emails', label: 'Emails', description: 'Email templates and logs', category: 'admin', route: '/admin/emails' },
  { key: 'settings', label: 'Settings', description: 'Application settings', category: 'system', route: '/settings' },
  { key: 'users', label: 'Users', description: 'Admin user management', category: 'admin', route: '/admin/users' },
  { key: 'accounts', label: 'Accounts', description: 'Account management', category: 'admin', route: '/admin/accounts' },
  { key: 'scheduler', label: 'Scheduler', description: 'Job scheduling', category: 'system', route: '/admin/scheduler' },
];
