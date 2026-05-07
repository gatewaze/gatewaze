export type ModuleType = 'feature' | 'integration' | 'theme' | 'core';
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
  /**
   * Module-owned BullMQ queues. Each declared queue gets its own Queue
   * instance, Worker (with declared concurrency + defaultJobOptions), and
   * handler set. Use this when the shared `jobs` queue's defaults don't
   * fit (custom retry/backoff, distinct concurrency, or a LISTEN/NOTIFY
   * wake path). Otherwise, prefer `workers[]` on the shared `jobs` queue.
   *
   * See spec-job-queue-redis-architecture.md §15.
   */
  queues?: QueueDefinition[];
  /**
   * Scheduled (repeatable) jobs registered by the scheduler process.
   * Supersedes the legacy `schedulers[]` field — new modules should use
   * this. Each entry becomes a BullMQ `upsertJobScheduler` call.
   */
  crons?: CronDefinition[];
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

  /**
   * Declarative listing schemas per spec-platform-listing-pattern.md.
   * When set, the platform's listing factories (createAdminListingRoute,
   * createPublicApiListingRoute, etc.) consume these schemas to produce
   * paginated, server-validated, properly-indexed list endpoints across
   * admin / publicApi / mcp / portal consumers.
   *
   * The shape is opaque here to avoid pulling Supabase types into this
   * file; the canonical type is `ListingSchema` from
   * `@gatewaze/shared/listing`.
   */
  listings?: unknown[];
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

  /**
   * Content sources exposed via the unified /api/v1/content endpoint.
   * Each source describes a content-bearing table that supports the
   * platform-wide content_category column. The /content endpoint
   * unions across all enabled modules' sources.
   */
  publicContentSources?: PublicContentSource[];

  // ── MCP contributions ─────────────────────────────────────────────────

  /**
   * MCP server contributions — tools, resources, and prompts exposed
   * to AI assistants when this module is enabled.
   */
  mcpContributions?: McpContributions | ((ctx: ModuleRuntimeContext) => McpContributions);

  // ── Host-media consumer registration ──────────────────────────────────

  /**
   * Opts this module in as a consumer of `@gatewaze-modules/host-media`.
   * The shared host-media module owns the table, API routes, admin tab,
   * upload pipeline (Sharp/YouTube/ZIP/chunked), and reference tracking;
   * consumer modules just declare a `host_kind` and feature flags here.
   *
   * Per spec-host-media-module.md §3.2 + §4.4.
   */
  hostMediaConsumer?: HostMediaConsumer;
}

/**
 * Module-side declaration that this module owns a `host_kind` value in
 * the shared `host_media` table. The host-media module reads these
 * registrations at runtime to wire conditional features in
 * `<HostMediaTab>` and to drive the nightly used-in rebuild cron.
 */
export interface HostMediaConsumer {
  /** Discriminator value written to host_media.host_kind for this consumer. */
  hostKind: string;
  /**
   * Whether <HostMediaTab> shows the Albums section + the API routes
   * accept album_id parameters. Default false.
   */
  enableAlbums?: boolean;
  /**
   * Whether <HostMediaTab> shows the Sponsor Tagging UI on each media
   * item. Used by event-media. Default false.
   */
  enableSponsorTagging?: boolean;
  /**
   * Whether the upload pipeline delegates videos to YouTube. Requires
   * YOUTUBE_* env vars to be set. Default false.
   */
  enableYouTube?: boolean;
  /**
   * Whether the upload pipeline accepts application/zip and unpacks
   * archives into albums via the media-process-zip edge fn. Requires
   * enableAlbums: true. Default false.
   */
  enableZipUnpack?: boolean;
  /**
   * Optional content tables this module owns whose rows reference
   * host_media items. The nightly used-in rebuild cron walks these to
   * keep host_media.used_in in sync.
   */
  contentTables?: HostMediaContentTable[];
}

/** Per-table entry for the used-in rebuild cron. */
export interface HostMediaContentTable {
  /** Schema-qualified table name, e.g. 'pages' or 'events.event_descriptions' */
  table: string;
  /**
   * Column on the table that stores host_kind. If the table is
   * single-kind, set staticHostKind instead.
   */
  hostKindColumn?: string;
  /** Column on the table that stores host_id. */
  hostIdColumn: string;
  /** Column holding the jsonb content blob to walk. */
  contentColumn: string;
  /** String written to used_in.type, e.g. 'page'. */
  consumerType: string;
  /** Column holding the row's primary key (uuid). */
  idColumn: string;
  /** Column holding the row's display name (used in used_in.name). */
  nameColumn: string;
  /**
   * If set, every row from this table contributes host_kind = staticHostKind
   * regardless of any per-row column. Used when the table is owned by a
   * single-kind consumer (e.g. event_descriptions → 'event').
   */
  staticHostKind?: string;
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
  /** Job name this handler processes (e.g. `triage:resolve-route`). */
  name: string;
  /** Handler path relative to the module's directory. */
  handler: string;
  /**
   * @deprecated Concurrency is a queue-level setting, not a handler one.
   * Ignored by the worker; kept for backward-compat reading.
   */
  concurrency?: number;
  /**
   * Optional handler-level payload schema. If present, the worker
   * re-validates `job.data` against this schema on dequeue and fails the
   * job with a validation error on mismatch. Path to a file that default-
   * exports a Zod schema, relative to the module's directory.
   */
  schemaPath?: string;
}

/**
 * BullMQ queue declared by a module. The worker process constructs a
 * Queue + Worker pair for each entry. Handlers are dispatched by job
 * `name`.
 */
export interface QueueDefinition {
  /** Queue name; must be unique across all installed modules. By convention, prefix with `<moduleId>:`. */
  name: string;
  /**
   * BullMQ defaultJobOptions. Overrides the global built-in defaults
   * (3 attempts, 5s exponential backoff, 24h complete / 7d fail cleanup).
   */
  defaultJobOptions?: {
    attempts?: number;
    backoff?: {
      type: 'fixed' | 'exponential' | 'custom';
      delay?: number;
      /** For type='custom': ms per attempt, index 0 = attempt 1. */
      settings?: number[];
    };
    removeOnComplete?: { count?: number; age?: number };
    removeOnFail?: { count?: number; age?: number };
  };
  /**
   * Default concurrency for the Worker. May be overridden via env var
   * `WORKER_CONCURRENCY_<MODULE_ID>_<QUEUE_NAME>` (uppercased, non-alphanumerics → `_`).
   * Defaults to 2 if unset.
   */
  defaultConcurrency?: number;
  /** Handlers dispatched by job `name` within this queue. */
  handlers: QueueHandlerDefinition[];
  /**
   * Optional Postgres LISTEN/NOTIFY wake path. When set, the worker holds
   * a dedicated PG connection LISTENing on the channel; on notification
   * the worker invokes a module-provided reconcile hook. A poll fallback
   * runs every `poll.intervalMs` in case NOTIFY is lost.
   *
   * The reconcile hook is a module handler registered by name under
   * `handlers[]`; the worker dispatches a synthetic job of that name with
   * `{ _trigger: 'listen' | 'poll', payload?: ... }` data.
   */
  listen?: {
    channel: string;
    /** Handler name (within this queue's `handlers[]`) invoked on wake. */
    onWake: string;
    poll?: { intervalMs: number };
  };
}

export interface QueueHandlerDefinition {
  /** Job name handled. */
  name: string;
  /** Handler path, relative to the module's directory. */
  handler: string;
  /**
   * Path to a file that default-exports a Zod schema, relative to the
   * module's directory. Strongly recommended.
   */
  schemaPath?: string;
}

/**
 * Scheduled (repeatable) job. The scheduler process calls
 * `Queue.upsertJobScheduler(name, schedule, { name: data.kind, data })`
 * on the named queue at startup, and reconciles against installed
 * modules on each restart.
 */
export interface CronDefinition {
  /** Globally unique cron name (across all modules). */
  name: string;
  /**
   * Target queue. Built-in values: `jobs`, `email`, `image`. Module-
   * registered queues are referenced by their declared `name`.
   */
  queue: string;
  schedule:
    | { every: number }
    | { pattern: string; tz?: string };
  /** Payload. `data.kind` becomes the BullMQ job name. */
  data: Record<string, unknown> & { kind: string };
}

/**
 * @deprecated Use `crons[]`. Retained for backward-compat reading.
 */
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
  /**
   * ISO timestamp of the most-recently-modified source file inside the
   * module directory (index.ts, migrations, admin/, portal/, api/, …).
   * Used by the admin UI to show "Updated <relative>" in place of the
   * static manifest version. Computed at load time from filesystem mtimes.
   */
  lastModifiedAt?: string;
}

export interface ModuleSourceRow {
  id: string;
  url: string;
  path: string | null;
  branch: string | null;
  label: string | null;
  token: string | null;
  origin: 'config' | 'user' | 'upload' | 'env';
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
  /**
   * Content hash of the module source dir that was installed. The reconcile
   * loop compares this against the upstream source's current hash to decide
   * whether an update is available (see api/src/routes/modules.ts update-check).
   */
  source_snapshot_hash?: string | null;
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

/**
 * Declares a content-bearing table for the unified /api/v1/content endpoint.
 * The endpoint unions across all enabled modules' content sources, returning
 * a normalized response with type, id, title, date, content_category, and a
 * resource link for each record.
 */
export interface PublicContentSource {
  /** Stable type identifier returned in each row, e.g. 'event' or 'newsletter_edition'. */
  type: string;
  /** Database table or view to query. */
  table: string;
  /** Required scope to access this source — checked per row before inclusion. */
  scope: string;
  /**
   * Column mapping from the table to the normalized content row shape.
   * The endpoint will SELECT exactly these columns plus content_category.
   */
  fields: {
    id: string;
    title: string;
    date: string;
    /** Optional summary/description column. */
    summary?: string;
  };
  /** Filters that must always apply (e.g. `is_listed = true`). */
  visibilityFilter?: Array<{ column: string; eq: string | boolean | number }>;
  /**
   * Build the resource path (relative to /api/v1) for a row.
   * Example: (row) => `/events/${row.event_id ?? row.id}`
   */
  resourcePath: (row: Record<string, unknown>) => string;
  /**
   * All public columns to include when /content is called with ?expand=full.
   * The unified endpoint will SELECT these for each windowed row and attach
   * them under `full` on the response. If omitted, the source supports the
   * normalized response shape only — `?expand=full` will fall back to the
   * summary fields for that source.
   */
  fullFields?: readonly string[];
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
