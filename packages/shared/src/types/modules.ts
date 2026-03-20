export type ModuleType = 'feature' | 'integration';
export type ModuleVisibility = 'public' | 'hidden' | 'premium';

export interface GatewazeModule {
  id: string;
  name: string;
  description: string;
  version: string;
  /**
   * Minimum platform version required by this module.
   * If set, the module cannot be enabled or updated unless the core
   * Gatewaze platform meets this version requirement (semver).
   *
   * Example: '1.2.0' means the module needs at least platform v1.2.0.
   */
  minPlatformVersion?: string;
  type?: ModuleType;
  visibility?: ModuleVisibility;
  group?: string;
  features: string[];
  adminRoutes?: AdminRouteDefinition[];
  adminNavItems?: NavigationItem[];
  /** Slot registrations for the admin React app */
  adminSlots?: SlotRegistration[];
  portalRoutes?: PortalRouteDefinition[];
  /** Slot registrations for the public portal Next.js app */
  portalSlots?: SlotRegistration[];
  apiRoutes?: (app: unknown, context?: ModuleContext) => void | Promise<void>;
  workers?: WorkerDefinition[];
  schedulers?: SchedulerDefinition[];
  edgeFunctions?: string[];
  migrations?: string[];
  dependencies?: string[];
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
  guard?: 'none' | 'auth' | 'admin' | 'super_admin';
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

/**
 * A slot registration allows a module to inject UI fragments into named
 * extension points defined by the host application.
 *
 * Host pages render `<ModuleSlot name="event-detail:tabs" />` and all
 * enabled modules that registered components for that slot name will
 * have their components rendered (lazy-loaded, sorted by `order`).
 */
export interface SlotRegistration {
  /** Dot-delimited slot name, e.g. 'event-detail:tabs' or 'person-detail:sidebar' */
  slotName: string;
  /** Lazy-loaded component — receives the props passed to <ModuleSlot props={...} /> */
  component: () => Promise<{ default: unknown }>;
  /** Ordering weight — lower numbers render first (default: 100) */
  order?: number;
  /** Only render when this feature flag is enabled */
  requiredFeature?: string;
  /**
   * Arbitrary metadata available to the host without loading the component.
   * Use this for lightweight data like tab labels, icon names, or section titles.
   */
  meta?: Record<string, unknown>;
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

export interface ModuleContext {
  /** Absolute path to the project root directory */
  projectRoot: string;
  /** Absolute path to the module's own directory on disk */
  moduleDir: string;
}

export interface ConfigField {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'secret';
  required: boolean;
  default?: string;
  description: string;
}

/**
 * A module source is a directory (or git repo) containing one or more module packages.
 * Each module package is a subdirectory with an index.ts exporting a GatewazeModule.
 *
 * Supported formats:
 *   - Local path (relative or absolute): '../gatewaze-modules/modules'
 *   - Git URL: 'https://github.com/org/modules-repo.git'
 *   - Git URL with subdirectory: 'https://github.com/org/repo.git#path=modules'
 *   - Git URL with branch: 'https://github.com/org/repo.git#branch=main&path=modules'
 */
export type ModuleSource = string | {
  /** Local path or git URL */
  url: string;
  /** Subdirectory within the repo that contains module folders (default: root) */
  path?: string;
  /** Git branch/tag (default: main) */
  branch?: string;
};

export interface GatewazeConfig {
  name: string;
  /**
   * The current platform version (semver).
   * Modules may declare a `minPlatformVersion` — if the platform version
   * is lower than that requirement, the module cannot be enabled or updated.
   */
  platformVersion: string;
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
  /**
   * Sources of module packages. Each source is a directory containing
   * module subdirectories. Can be local paths or git repo URLs.
   *
   * Default: ['../gatewaze-modules/modules']
   */
  moduleSources?: ModuleSource[];
  /**
   * List of module IDs (or package names) to include in the build.
   * If omitted, all modules found in moduleSources are included automatically.
   */
  modules?: string[];
  moduleConfig?: Record<string, Record<string, unknown>>;
}

export interface LoadedModule {
  config: GatewazeModule;
  packageName: string;
  moduleConfig: Record<string, unknown>;
  /** Absolute path to the module directory on disk (when resolved from a source directory). */
  resolvedDir?: string;
}

export interface ModuleSourceRow {
  id: string;
  url: string;
  path: string | null;
  branch: string | null;
  label: string | null;
  origin: 'config' | 'user' | 'upload';
  created_at: string;
}

export interface InstalledModuleRow {
  id: string;
  name: string;
  version: string;
  features: string[];
  status: 'enabled' | 'disabled' | 'error';
  config: Record<string, unknown>;
  type?: string;
  source?: string;
  visibility?: string;
  description?: string;
  installed_at: string;
  updated_at: string;
}
