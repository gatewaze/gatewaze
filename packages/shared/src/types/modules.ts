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

/**
 * A structured logger interface injected into module runtime contexts.
 */
export interface StructuredLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Runtime context provided to module lifecycle hooks, API routes,
 * workers, and schedulers. Replaces direct process.env access.
 */
export interface ModuleRuntimeContext {
  /** The module's canonical ID */
  moduleId: string;
  /** Absolute path to the module's directory on disk */
  moduleDir: string;
  /** Absolute path to the project root */
  projectRoot: string;
  /** Structured logger scoped to this module */
  logger: StructuredLogger;
  /** Pre-configured Supabase client (service_role) */
  supabase: unknown; // SupabaseClient - kept as unknown to avoid circular dep
  /** Instance-level Gatewaze configuration */
  config: GatewazeConfig;
  /** This module's validated config values (secrets decrypted) */
  moduleConfig: Record<string, unknown>;
  /** Present when invoked from an HTTP request */
  requestId?: string;
  /** Present when invoked from an authenticated admin action */
  actor?: { userId: string; role: 'admin' | 'super_admin' };
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
  apiRoutes?: ((app: unknown, context?: ModuleContext) => void | Promise<void>) |
              ((router: unknown, ctx: ModuleRuntimeContext) => void | Promise<void>);
  workers?: WorkerDefinition[];
  schedulers?: SchedulerDefinition[];
  edgeFunctions?: string[];
  /**
   * Additional files from the module root to deploy into the edge functions
   * directory under the module ID. Used by provider modules that export a
   * provider.ts without being a full edge function handler.
   *
   * Example: `['provider.ts']` copies `<moduleDir>/provider.ts` to
   * `supabase/functions/<moduleId>/provider.ts`.
   */
  functionFiles?: string[];
  migrations?: string[];
  dependencies?: string[];
  configSchema?: Record<string, ConfigField>;
  /**
   * Module guide/documentation content (markdown string).
   * When present, the modules page shows an info button that opens a
   * modal rendering this content.  Typically auto-populated by the Vite
   * plugin from a `guide.md` file in the module directory.
   */
  guide?: string;
  /** Theme overrides — only meaningful when type === 'theme' */
  themeOverrides?: ThemeOverrides;
  onInstall?: (ctx?: ModuleRuntimeContext) => Promise<void>;
  onEnable?: (ctx?: ModuleRuntimeContext) => Promise<void>;
  onDisable?: (ctx?: ModuleRuntimeContext) => Promise<void>;

  // ── Public API contributions ──────────────────────────────────────────

  /**
   * Custom base path for public API routes.
   * Default: `/${id}`. Must start with `/` and match [a-z0-9-/].
   * Example: event-speakers module sets '/speakers'.
   */
  publicApiBasePath?: string;

  /**
   * Scopes this module supports for its public API.
   * Authoritative source — requireScope() only checks, does not register.
   */
  publicApiScopes?: PublicApiScopeDefinition[];

  /**
   * Public API route contributions. Mounted at /api/v1/<basePath>/ with API key auth.
   * Receives a scoped Router (not the full Express app).
   */
  publicApiRoutes?: (router: unknown, ctx: PublicApiContext) => void | Promise<void>;

  /**
   * OpenAPI schema contributions for the public API.
   * Used to generate the /api/v1/openapi.json spec.
   */
  publicApiSchema?: OpenApiContribution;

  // ── MCP contributions ─────────────────────────────────────────────────

  /**
   * MCP server contributions — tools, resources, and prompts exposed
   * to AI assistants when this module is enabled.
   */
  mcpContributions?: McpContributions | ((ctx: ModuleRuntimeContext) => McpContributions);
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
  type: 'string' | 'number' | 'boolean' | 'secret' | 'select';
  label?: string;
  required: boolean;
  default?: string;
  description: string;
  options?: { label: string; value: string }[]; // for type === 'select'
  validationRegex?: string; // for type === 'string'
  min?: number; // for type === 'number'
  max?: number; // for type === 'number'
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
  /** Human-readable label for this source (shown on Modules page) */
  label?: string;
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
  /** Human-readable label for the source this module was loaded from. */
  sourceLabel?: string;
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
  admin_nav?: Array<{
    path: string;
    label: string;
    icon: string;
    requiredFeature?: string;
    parentGroup?: string;
    order?: number;
  }> | null;
  edge_functions_hash?: string | null;
  source_id?: string | null;
  on_install_ran_at?: string | null;
  install_completed_at?: string | null;
  ui_contributions_ignored?: string[];
  installed_at: string;
  updated_at: string;
}

/** Warning emitted during module loading or validation */
export interface ModuleWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Result of loading a module, including provenance and warnings */
export interface LoadedModuleRecord {
  module: GatewazeModule;
  source: {
    kind: 'local' | 'git' | 'workspace' | 'upload';
    sourceId?: string;
    rootPath: string; // server-internal, NEVER return via API
    locationHint: string; // safe for API responses
  };
  warnings: ModuleWarning[];
}

/** Canonical error codes for module operations */
export type ModuleErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'UPLOAD_DISABLED'
  | 'NOT_FOUND'
  | 'DEPENDENCY_CYCLE'
  | 'MODULE_ID_CONFLICT'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'MIGRATION_FAILED'
  | 'MIGRATION_TIMEOUT'
  | 'MIGRATION_UNSAFE_SQL'
  | 'EDGE_DEPLOY_FAILED'
  | 'EDGE_BUNDLE_FAILED'
  | 'EDGE_RELOAD_UNAVAILABLE'
  | 'BOOTSTRAP_FAILED'
  | 'ALREADY_BOOTSTRAPPED'
  | 'K8S_STRATEGY_NOT_IMPLEMENTED'
  | 'MODULE_LOAD_FAILED'
  | 'MODULE_SOURCE_UNREACHABLE'
  | 'SOURCE_IN_USE'
  | 'GIT_HOST_NOT_ALLOWED'
  | 'IDEMPOTENCY_KEY_REUSE'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'ROTATION_FAILED'
  | 'LEADERSHIP_LOST'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** Structured error response for module API endpoints */
export interface ModuleApiError {
  error: {
    code: ModuleErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Worker handler signature for module workers */
export type ModuleWorkerHandler = (
  job: { id: string; name: string; data: unknown; attemptsMade: number },
  ctx: ModuleRuntimeContext,
) => Promise<unknown>;

/** Scheduler handler signature for module schedulers */
export type ModuleSchedulerHandler = (
  ctx: ModuleRuntimeContext,
) => Promise<void>;

/** Installed module config storage envelope */
export interface ModuleConfigEnvelope {
  version: number;
  values: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'secret' | 'select';
    value?: string | number | boolean | null;
    ciphertext?: string; // for secrets only
    last4?: string; // for secrets only, for display masking
  }>;
}

// ── Public API types ──────────────────────────────────────────────────────

export interface PublicApiScopeDefinition {
  action: string;       // e.g. 'read', 'submit', 'create'
  description: string;  // human-readable, shown in admin UI and docs
}

/** Cache policy for public API endpoints */
export type CachePolicy =
  | { kind: 'public'; maxAge: number; sMaxAge?: number }
  | { kind: 'no-store' };

/**
 * Context provided to public API route handlers.
 * Extends ModuleRuntimeContext with public-API-specific helpers.
 */
export interface PublicApiContext extends ModuleRuntimeContext {
  /** Middleware factory — auto-prefixes moduleId: requireScope('read') checks 'events:read' */
  requireScope: (action: string) => unknown; // Express RequestHandler
  /** Parse ?fields= against an allowlist. Unpermitted fields silently stripped. */
  parseFields: (fieldsParam: string | undefined, allowedFields: string[], defaultFields?: string[]) => string[];
  /** Parse and validate limit/offset pagination parameters. */
  parsePagination: (query: { limit?: string; offset?: string }) => { limit: number; offset: number };
  /** Set Cache-Control headers from a typed policy. */
  setCache: (res: unknown, policy: CachePolicy) => void;
}

/** OpenAPI 3.1 schema contribution from a module */
export interface OpenApiContribution {
  /** Module's API tag (used for grouping in docs) */
  tag: { name: string; description: string };
  /** Path definitions (relative to /api/v1/<basePath>/) */
  paths: Record<string, unknown>;
  /** Schema definitions (merged into components/schemas, auto-prefixed with moduleId) */
  schemas?: Record<string, unknown>;
}

// ── MCP types ─────────────────────────────────────────────────────────────

export interface McpContributions {
  tools?: McpToolDefinition[];
  resources?: McpResourceDefinition[];
  prompts?: McpPromptDefinition[];
}

export interface McpToolDefinition {
  /** Tool name — namespaced as moduleId_toolName by the MCP server */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  handler: (params: Record<string, unknown>, ctx: ModuleRuntimeContext) => Promise<unknown>;
}

export interface McpResourceDefinition {
  /** URI template — auto-prefixed: gatewaze://modules/{moduleId}/... */
  uriTemplate: string;
  name: string;
  description: string;
  handler: (uri: string, ctx: ModuleRuntimeContext) => Promise<unknown>;
}

export interface McpPromptDefinition {
  name: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
  handler: (args: Record<string, string>, ctx: ModuleRuntimeContext) => Promise<string>;
}
