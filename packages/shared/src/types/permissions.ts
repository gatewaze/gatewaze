export type AdminFeature =
  | 'dashboard_home'
  | 'dashboard_people'
  | 'accounts'
  | 'users'
  | 'events'
  | 'calendars'
  | 'emails'
  | 'settings'
  | 'scheduler'
  // Portal-manageable module features (workspace shell RBAC, spec §5.2). Shared so the portal
  // and admin app use the same feature vocabulary. `events` (above) is reused for EventOps.
  | 'blog'
  | 'newsletters'
  | 'ambassadors';

export const CORE_FEATURES: readonly string[] = [
  'dashboard_home',
  'dashboard_people',
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
  { key: 'dashboard_people', label: 'People Dashboard', description: 'People analytics', category: 'dashboard', route: '/people' },
  { key: 'events', label: 'Events', description: 'Event management', category: 'content', route: '/events' },
  { key: 'calendars', label: 'Calendars', description: 'Calendar management', category: 'content', route: '/calendars' },
  { key: 'emails', label: 'Emails', description: 'Email templates and logs', category: 'admin', route: '/admin/emails' },
  { key: 'settings', label: 'Settings', description: 'Application settings', category: 'system', route: '/settings' },
  { key: 'users', label: 'Users', description: 'Admin user management', category: 'admin', route: '/admin/users' },
  { key: 'accounts', label: 'Accounts', description: 'Account management', category: 'admin', route: '/admin/accounts' },
  { key: 'scheduler', label: 'Scheduler', description: 'Job scheduling', category: 'system', route: '/admin/scheduler' },
  { key: 'blog', label: 'Blog', description: 'Blog post management (portal)', category: 'content', route: '/admin/blog' },
  { key: 'newsletters', label: 'Newsletters', description: 'Newsletter management (portal)', category: 'content', route: '/admin/newsletters' },
  { key: 'ambassadors', label: 'Ambassadors', description: 'Ambassador program admin (portal)', category: 'content', route: '/admin/ambassadors' },
];
