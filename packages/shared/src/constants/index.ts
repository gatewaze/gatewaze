export const APP_NAME = 'Gatewaze';
export const APP_VERSION = '1.0.0';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const EVENT_STATUSES = ['draft', 'published', 'cancelled', 'completed'] as const;
export const REGISTRATION_STATUSES = ['pending', 'confirmed', 'cancelled', 'attended', 'no_show'] as const;
export const ADMIN_ROLES = ['super_admin', 'admin', 'editor'] as const;
export const AUTH_PROVIDERS = ['supabase', 'oidc'] as const;
export const EMAIL_PROVIDERS = ['sendgrid', 'smtp'] as const;
