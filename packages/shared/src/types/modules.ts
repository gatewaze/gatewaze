export type ModuleType = 'feature' | 'integration' | 'theme';
export type ModuleVisibility = 'public' | 'hidden' | 'premium';

// ---------------------------------------------------------------------------
// Theme override types — used by modules with type === 'theme'
// ---------------------------------------------------------------------------

export interface AdminThemeOverrides {
  /** Force a specific theme mode (or leave undefined to respect user preference) */
  themeMode?: 'light' | 'dark' | 'system';
  /** Force a primary accent color (Radix color name) */
  primaryColor?: string;
  /** Force light color scheme */
  lightColor?: string;
  /** Force dark color scheme */
  darkColor?: string;
  /** Force card skin */
  cardSkin?: 'shadow' | 'bordered';
  /** Force layout */
  themeLayout?: 'main-layout' | 'sideblock';
  /** Path to a custom CSS file relative to the module directory, bundled by Vite */
  customCss?: string;
  /** Additional props merged into the Radix <Theme> component */
  radixThemeProps?: Record<string, unknown>;
}

export interface PortalThemeOverrides {
  /** Override platform_settings branding keys (keys match the DB key column) */
  brandingDefaults?: Record<string, string>;
  /** Force a portal theme */
  portalTheme?: 'blobs' | 'gradient_wave' | 'basic';
  /** Override default theme colors per portal theme type */
  themeColors?: Record<string, Record<string, string>>;
  /** Override corner style */
  cornerStyle?: 'square' | 'rounded' | 'pill';
  /** Additional CSS class added to the portal <html> element */
  htmlClassName?: string;
  /** URL to a custom CSS file (e.g. served from the module's public assets) */
  customCssUrl?: string;
}

export interface ThemeOverrides {
  admin?: AdminThemeOverrides;
  portal?: PortalThemeOverrides;
  /**
   * Platform settings keys that this theme module controls.
   * The Settings UI will show these as read-only when the theme is active.
   */
  lockedSettings?: string[];
}

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
  /** Navigation config for the portal header — persisted in installed_modules.portal_nav on enable */
  portalNav?: {
    label: string;
    path: string;
    icon: string;
    order: number;
  };
  /** Slot registrations for the public portal Next.js app */
  portalSlots?: SlotRegistration[];
  apiRoutes?: (app: unknown, context?: ModuleContext) => void | Promise<void>;
  workers?: WorkerDefinition[];
  schedulers?: SchedulerDefinition[];
  edgeFunctions?: string[];
  migrations?: string[];
  dependencies?: string[];
  configSchema?: Record<string, ConfigField>;
  /** Theme overrides — only meaningful when type === 'theme' */
  themeOverrides?: ThemeOverrides;
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
  /** Access token for private git repositories */
  token?: string;
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
  token: string | null;
  origin: 'config' | 'user' | 'upload';
  created_at: string;
}

export interface InstalledModuleRow {
  id: string;
  name: string;
  version: string;
  features: string[];
  status: 'enabled' | 'disabled' | 'not_installed' | 'error';
  config: Record<string, unknown>;
  type?: string;
  source?: string;
  visibility?: string;
  description?: string;
  portal_nav?: {
    label: string;
    path: string;
    icon: string;
    order: number;
  } | null;
  installed_at: string;
  updated_at: string;
}
