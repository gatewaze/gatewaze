/**
 * Admin feature permissions types
 */

/** Core platform features */
export type CoreFeature =
  | 'dashboard_home'
  | 'dashboard_people'
  | 'accounts'
  | 'users'
  | 'calendars'
  | 'events'
  | 'blog'
  | 'scrapers'
  | 'competitions'
  | 'discounts'
  | 'offers'
  | 'cohorts'
  | 'payments'
  | 'emails'
  | 'compliance'
  | 'scheduler'
  | 'surveys'
  | 'redirects'
  | 'newsletters'
  | 'slack'
  | 'settings';

/** Accepts core features and module-defined features (arbitrary strings) */
export type AdminFeature = CoreFeature | (string & {});

export interface AdminPermission {
  id: string;
  admin_id: string;
  feature: AdminFeature;
  account_id: string | null;
  granted_by: string | null;
  granted_at: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PermissionGroup {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PermissionGroupFeature {
  id: string;
  group_id: string;
  feature: AdminFeature;
  created_at: string;
}

export interface PermissionGroupAssignment {
  id: string;
  admin_id: string;
  group_id: string;
  account_id: string | null;
  assigned_by: string | null;
  assigned_at: string;
  expires_at: string | null;
  is_active: boolean;
}

export interface PermissionAuditLog {
  id: string;
  admin_id: string;
  action: 'granted' | 'revoked' | 'expired';
  feature: AdminFeature | null;
  permission_id: string | null;
  group_id: string | null;
  account_id: string | null;
  performed_by: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface GrantPermissionRequest {
  admin_id: string;
  feature: AdminFeature;
  account_id?: string | null;
  expires_at?: string | null;
}

export interface RevokePermissionRequest {
  admin_id: string;
  feature: AdminFeature;
  account_id?: string | null;
}

export interface AssignGroupRequest {
  admin_id: string;
  group_id: string;
  account_id?: string | null;
  expires_at?: string | null;
}

export interface CreatePermissionGroupRequest {
  name: string;
  description?: string;
  features: AdminFeature[];
}

export interface UpdatePermissionGroupRequest {
  name?: string;
  description?: string;
  features?: AdminFeature[];
  is_active?: boolean;
}

export interface PermissionCheckResult {
  hasPermission: boolean;
  source?: 'super_admin' | 'direct' | 'group';
  expires_at?: string | null;
}

export interface AdminPermissionsMap {
  [feature: string]: boolean;
}

// Feature metadata for UI
export interface FeatureMetadata {
  key: AdminFeature;
  label: string;
  description: string;
  category: 'dashboard' | 'admin' | 'account' | 'content' | 'system';
  route?: string;
}

export const FEATURE_METADATA: Record<AdminFeature, FeatureMetadata> = {
  dashboard_home: {
    key: 'dashboard_home',
    label: 'Dashboard Home',
    description: 'Access to main dashboard overview',
    category: 'dashboard',
    route: '/home',
  },
  dashboard_people: {
    key: 'dashboard_people',
    label: 'Dashboard People',
    description: 'View and manage people data',
    category: 'dashboard',
    route: '/people',
  },
accounts: {
    key: 'accounts',
    label: 'Accounts',
    description: 'Manage accounts and organizations',
    category: 'admin',
    route: '/admin/accounts',
  },
  users: {
    key: 'users',
    label: 'Users',
    description: 'Manage admin users',
    category: 'admin',
    route: '/admin/users',
  },
  calendars: {
    key: 'calendars',
    label: 'Calendars',
    description: 'Manage calendars and calendar members',
    category: 'content',
    route: '/calendars',
  },
  events: {
    key: 'events',
    label: 'Events',
    description: 'Manage events and conferences',
    category: 'content',
    route: '/events',
  },
  blog: {
    key: 'blog',
    label: 'Blog',
    description: 'Manage blog posts',
    category: 'content',
    route: '/blog/posts',
  },
  scrapers: {
    key: 'scrapers',
    label: 'Scrapers',
    description: 'Manage web scrapers',
    category: 'admin',
    route: '/admin/scrapers',
  },
  competitions: {
    key: 'competitions',
    label: 'Competitions',
    description: 'Manage competitions',
    category: 'account',
    route: '/competitions',
  },
  discounts: {
    key: 'discounts',
    label: 'Discounts',
    description: 'Manage discount codes',
    category: 'account',
    route: '/discounts',
  },
  offers: {
    key: 'offers',
    label: 'Offers',
    description: 'Manage special offers',
    category: 'account',
    route: '/offers',
  },
  cohorts: {
    key: 'cohorts',
    label: 'Cohorts',
    description: 'Manage cohorts and programs',
    category: 'account',
    route: '/cohorts',
  },
  payments: {
    key: 'payments',
    label: 'Payments',
    description: 'Manage Stripe payments, invoices, and transactions',
    category: 'admin',
    route: '/admin/payments',
  },
  emails: {
    key: 'emails',
    label: 'Emails',
    description: 'Manage email templates and view email logs',
    category: 'admin',
    route: '/admin/emails',
  },
  compliance: {
    key: 'compliance',
    label: 'Compliance',
    description: 'Privacy compliance management (GDPR, CCPA, etc.)',
    category: 'admin',
    route: '/admin/compliance',
  },
scheduler: {
    key: 'scheduler',
    label: 'Scheduler',
    description: 'Job queue and scraper scheduler management',
    category: 'admin',
    route: '/admin/scheduler',
  },
  surveys: {
    key: 'surveys',
    label: 'Surveys',
    description: 'Manage surveys and view survey submissions',
    category: 'dashboard',
    route: '/surveys',
  },
  redirects: {
    key: 'redirects',
    label: 'Redirects',
    description: 'Manage Short.io URL redirects and short links',
    category: 'admin',
    route: '/admin/redirects',
  },
  newsletters: {
    key: 'newsletters',
    label: 'Newsletters',
    description: 'View and sync newsletter content from Google Sheets',
    category: 'dashboard',
    route: '/newsletters',
  },
  slack: {
    key: 'slack',
    label: 'Slack',
    description: 'Manage Slack workspace invitations',
    category: 'dashboard',
    route: '/slack/invitations',
  },
  settings: {
    key: 'settings',
    label: 'Settings',
    description: 'Application settings',
    category: 'system',
    route: '/settings',
  },
};

export const FEATURE_CATEGORIES = [
  { key: 'dashboard', label: 'Dashboard', description: 'Dashboard features' },
  { key: 'admin', label: 'Admin', description: 'Administrative features' },
  { key: 'account', label: 'Account', description: 'Account-specific features' },
  { key: 'content', label: 'Content', description: 'Content management' },
  { key: 'system', label: 'System', description: 'System settings' },
] as const;

// Calendar-level permission types
export type CalendarPermissionLevel = 'view' | 'edit' | 'manage';

export interface AdminCalendarPermission {
  id: string;
  admin_id: string;
  calendar_id: string;
  permission_level: CalendarPermissionLevel;
  granted_by: string | null;
  granted_at: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminEventPermission {
  id: string;
  admin_id: string;
  event_id: string;
  permission_level: CalendarPermissionLevel;
  granted_by: string | null;
  granted_at: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GrantCalendarPermissionRequest {
  admin_id: string;
  calendar_id: string;
  permission_level?: CalendarPermissionLevel;
  expires_at?: string | null;
}

export interface GrantEventPermissionRequest {
  admin_id: string;
  event_id: string;
  permission_level?: CalendarPermissionLevel;
  expires_at?: string | null;
}

export interface CalendarPermissionCheckResult {
  hasPermission: boolean;
  permissionLevel?: CalendarPermissionLevel;
  source?: 'super_admin' | 'direct';
  expires_at?: string | null;
}

export interface EventPermissionCheckResult {
  hasPermission: boolean;
  permissionLevel?: CalendarPermissionLevel;
  source?: 'super_admin' | 'direct' | 'calendar';
  expires_at?: string | null;
}
