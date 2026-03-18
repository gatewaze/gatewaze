export interface GatewazeModule {
  id: string;
  name: string;
  description: string;
  version: string;
  features: string[];
  adminRoutes?: AdminRouteDefinition[];
  adminNavItems?: NavigationItem[];
  portalRoutes?: PortalRouteDefinition[];
  apiRoutes?: (app: unknown) => void;
  workers?: WorkerDefinition[];
  schedulers?: SchedulerDefinition[];
  edgeFunctions?: string[];
  migrations?: string[];
  configSchema?: Record<string, ConfigField>;
  onInstall?: () => Promise<void>;
  onEnable?: () => Promise<void>;
  onDisable?: () => Promise<void>;
}

export interface AdminRouteDefinition {
  path: string;
  component: () => Promise<{ default: unknown }>;
  requiredFeature: string;
  parentPath?: string;
  guard?: 'auth' | 'admin' | 'super_admin';
}

export interface NavigationItem {
  path: string;
  label: string;
  icon: string;
  requiredFeature: string;
  parentGroup?: string;
  order?: number;
}

export interface PortalRouteDefinition {
  path: string;
  component: () => Promise<{ default: unknown }>;
}

export interface WorkerDefinition {
  name: string;
  handler: string;
  concurrency?: number;
}

export interface SchedulerDefinition {
  name: string;
  cron: string;
  handler: string;
}

export interface ConfigField {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'secret';
  required: boolean;
  default?: string;
  description: string;
}

export interface GatewazeConfig {
  name: string;
  auth: {
    provider: 'supabase' | 'oidc';
    oidc?: {
      issuerUrl?: string;
      clientId?: string;
      clientSecret?: string;
      scopes?: string[];
      roleMapping?: {
        claimPath: string;
        superAdmin: string;
        admin: string;
        editor: string;
      };
    };
  };
  email: {
    provider: 'sendgrid' | 'smtp';
  };
  modules: string[];
  moduleConfig?: Record<string, Record<string, unknown>>;
}
