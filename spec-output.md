# Module System

The Gatewaze Dynamic Module System enables external feature modules to be discovered, installed, enabled, disabled, updated, and removed at runtime without requiring changes to the core platform codebase. The core platform MUST contain zero hardcoded references to any specific module.

---

## Requirement: Module Definition Contract

Every module MUST export a `GatewazeModule` object as its default export from `index.ts`. The export MUST include: `id` (unique string), `name`, `description`, `version` (semver), and `features` (string array). The export MAY include: `type` ('feature' | 'integration' | 'theme'), `visibility` ('public' | 'hidden' | 'premium'), `group`, `minPlatformVersion`, `adminRoutes`, `adminNavItems`, `adminSlots`, `portalRoutes`, `portalNav`, `portalSlots`, `apiRoutes`, `workers`, `schedulers`, `edgeFunctions`, `migrations`, `configSchema`, `config`, `dependencies`, `themeOverrides`, `onInstall`, `onEnable`, `onDisable`, `onUninstall`.

**Rationale**: TypeScript-based module definitions allow compile-time validation of the contract and enable the Vite plugin to statically analyze module exports at build time without executing arbitrary code. The `index.ts` convention was chosen over JSON manifests to allow modules to declare lazy-loaded component imports and async lifecycle hooks inline.

### Scenario: Valid module export
- **GIVEN** a directory containing an `index.ts` file
- **WHEN** the file exports a default object with `id`, `name`, `description`, `version`, and `features`
- **THEN** the module loader SHALL accept it as a valid module
- **AND** it SHALL appear in the available modules list

### Scenario: Invalid module export
- **GIVEN** a directory containing an `index.ts` file
- **WHEN** the file exports an object missing any required field (`id`, `name`, `description`, `version`, or `features`)
- **THEN** the module loader SHALL reject it with a validation error
- **AND** it SHALL log the error with the module path
- **AND** other valid modules SHALL continue to load

### Scenario: Duplicate module ID
- **GIVEN** two module sources each contain a module with the same `id`
- **WHEN** the module loader scans all sources
- **THEN** the first-loaded module SHALL be used
- **AND** a warning SHALL be logged about the duplicate

---

## Requirement: Module Source Resolution

The system MUST support four module source types: local filesystem paths, git repositories, zip file uploads, and pnpm workspace packages. Sources SHALL be resolved from two origins: the `gatewaze.config.ts` configuration file (origin: `'config'`) and the `module_sources` database table (origin: `'user'` or `'upload'`). Database sources SHALL override config sources with the same `(url, path)` key.

### Scenario: Local path source
- **GIVEN** a module source pointing to a local filesystem path
- **WHEN** the module loader resolves the source
- **THEN** it SHALL scan each subdirectory for an `index.ts` file
- **AND** each valid subdirectory SHALL be treated as a module candidate

### Scenario: Git repository source
- **GIVEN** a module source with a git URL
- **WHEN** the module loader resolves the source
- **THEN** it SHALL clone the repository to `.gatewaze-modules/` cache directory
- **AND** if `path` is specified, it SHALL use that subdirectory as the module root
- **AND** if `branch` is specified, it SHALL checkout that ref
- **AND** if `token` is specified, it SHALL use it for authentication

### Scenario: Zip upload source
- **GIVEN** a zip file uploaded via the module upload endpoint
- **WHEN** the system processes the upload
- **THEN** it SHALL extract contents to `data/uploaded-modules/<module-id>/`
- **AND** it SHALL validate the presence of `index.ts`
- **AND** it SHALL register a module source with origin `'upload'`
- **AND** if no `index.ts` is found, it SHALL return a 400 error

### Scenario: pnpm workspace source
- **GIVEN** pnpm workspace packages matching `@gatewaze-modules/*`
- **WHEN** the module loader scans workspace packages
- **THEN** each matching package SHALL be treated as a module candidate

### Scenario: Source deduplication
- **GIVEN** the same source URL and path exist in both `gatewaze.config.ts` and `module_sources` table
- **WHEN** the module loader merges sources
- **THEN** the database source SHALL take precedence
- **AND** only one copy of the source SHALL be processed

---

## Requirement: Module Loader

The module loader (`shared/modules/loader.ts`) MUST discover and validate modules from all configured sources at startup and on-demand via the reconcile endpoint. The loader MUST NOT contain any hardcoded module names, paths, or identifiers.

### Scenario: Full module discovery
- **GIVEN** multiple module sources are configured (config file and database)
- **WHEN** the module loader executes
- **THEN** it SHALL merge sources from both origins
- **AND** it SHALL deduplicate by `(url, path)` key
- **AND** it SHALL dynamically import each module's `index.ts`
- **AND** it SHALL validate each export against the `GatewazeModule` interface
- **AND** it SHALL return an array of `LoadedModule` objects with resolved filesystem paths

### Scenario: Platform version check
- **GIVEN** a module specifies `minPlatformVersion: "2.0.0"`
- **WHEN** the current platform version is `"1.5.0"`
- **THEN** the module loader SHALL reject the module with a version incompatibility error

### Scenario: Source unavailable
- **GIVEN** a git repository source is unreachable
- **WHEN** the module loader attempts to clone it
- **THEN** it SHALL log a warning
- **AND** it SHALL skip the unreachable source
- **AND** it SHALL continue loading modules from other sources

---

## Requirement: Module Lifecycle Management

The system MUST support the following module states: `'not_installed'`, `'enabled'`, `'disabled'`, `'error'`. State transitions MUST be managed through the lifecycle manager (`shared/modules/lifecycle.ts`). The system MUST detect circular dependencies during reconciliation and reject them with a descriptive error.

**Rationale**: Explicit state machine management ensures modules cannot enter invalid states. The four-state model was chosen over a simpler enabled/disabled binary to distinguish between modules that have never been configured (`not_installed`), modules intentionally turned off (`disabled`), and modules that failed during lifecycle operations (`error`).

### Scenario: Module registration (first discovery)
- **GIVEN** a module is discovered for the first time
- **WHEN** the reconciliation process runs
- **THEN** the module SHALL be inserted into `installed_modules` with status `'not_installed'`

### Scenario: Enable module without dependencies
- **GIVEN** a module with status `'not_installed'` or `'disabled'` and no `dependencies`
- **WHEN** an admin enables the module
- **THEN** the system SHALL set status to `'enabled'`
- **AND** it SHALL apply any pending migrations
- **AND** it SHALL deploy any edge functions
- **AND** it SHALL execute the `onEnable` hook if defined
- **AND** it SHALL return success with migration and deployment counts

### Scenario: Enable module with satisfied dependencies
- **GIVEN** a module with `dependencies: ["auth", "ticketing"]`
- **WHEN** an admin enables the module and both "auth" and "ticketing" are already enabled
- **THEN** the system SHALL enable the module successfully

### Scenario: Enable module with unsatisfied dependencies
- **GIVEN** a module with `dependencies: ["auth"]`
- **WHEN** an admin enables the module and "auth" is not enabled
- **THEN** the system SHALL return a 400 error
- **AND** the error message SHALL list the missing dependency

### Scenario: Disable module with no dependents
- **GIVEN** an enabled module with no other enabled modules depending on it
- **WHEN** an admin disables the module
- **THEN** the system SHALL set status to `'disabled'`
- **AND** it SHALL execute the `onDisable` hook if defined

### Scenario: Disable module with active dependents
- **GIVEN** an enabled module "auth" with another enabled module "sso" that depends on it
- **WHEN** an admin attempts to disable "auth"
- **THEN** the system SHALL return a 400 error
- **AND** the error message SHALL list the dependent module "sso"

### Scenario: Module enable fails (migration error)
- **GIVEN** a module with a migration that contains invalid SQL
- **WHEN** the system attempts to enable the module
- **THEN** the migration transaction SHALL be rolled back
- **AND** the module status SHALL be set to `'error'`
- **AND** the error details SHALL be returned to the admin

### Scenario: Reconciliation with topological ordering
- **GIVEN** modules A, B, C where B depends on A and C depends on B
- **WHEN** the reconciliation process runs
- **THEN** modules SHALL be processed in dependency order: A, then B, then C

### Scenario: Circular dependency detection
- **GIVEN** module A depends on B and module B depends on A
- **WHEN** the reconciliation process runs
- **THEN** the system SHALL detect the circular dependency
- **AND** it SHALL reject both modules with a descriptive error listing the cycle
- **AND** it SHALL log the circular dependency at ERROR level

### Scenario: Uninstall module
- **GIVEN** an installed module with status `'disabled'`
- **WHEN** an admin triggers uninstall for the module
- **THEN** the system SHALL execute the `onUninstall` hook if defined
- **AND** it SHALL remove the module's record from `installed_modules`
- **AND** it SHALL remove associated records from `module_migrations`
- **AND** it SHALL NOT automatically roll back applied migrations (destructive; requires explicit admin action)

---

## Requirement: Module Migrations

Modules MAY declare SQL migrations via the `migrations` field. The system MUST track applied migrations in the `module_migrations` table with checksums for idempotency. Migrations MUST be executed via the Supabase `exec_sql` RPC function under service role.

### Scenario: Apply new migration
- **GIVEN** a module declares `migrations: ["001_create_table.sql", "002_add_index.sql"]`
- **WHEN** the module is enabled and `001_create_table.sql` has not been applied
- **THEN** both migrations SHALL be executed in order
- **AND** each SHALL be recorded in `module_migrations` with module_id, filename, and checksum

### Scenario: Skip already-applied migration
- **GIVEN** a migration `001_create_table.sql` is already recorded in `module_migrations` for this module
- **WHEN** the module is enabled or updated
- **THEN** that migration SHALL be skipped
- **AND** only unapplied migrations SHALL be executed

### Scenario: Migration checksum mismatch
- **GIVEN** a migration file has been modified since it was last applied (checksum differs)
- **WHEN** the system checks migrations
- **THEN** it SHOULD warn about the checksum mismatch
- **AND** it SHALL NOT re-execute the modified migration automatically

---

## Requirement: Edge Function Deployment

Modules MAY declare edge functions via the `edgeFunctions` field. The system MUST deploy edge function source files to the `supabase/functions/` directory and optionally to Supabase Cloud.

### Scenario: Deploy edge function
- **GIVEN** a module declares `edgeFunctions: ["process-webhook"]`
- **WHEN** the module is enabled or updated
- **THEN** the system SHALL copy `<module>/functions/process-webhook/` to `supabase/functions/process-webhook/`
- **AND** it SHALL copy any `_shared/` directories
- **AND** if Supabase Cloud is configured, it SHALL run `supabase functions deploy`

### Scenario: Edge runtime container restart
- **GIVEN** the `EDGE_FUNCTIONS_CONTAINER` environment variable is set
- **WHEN** edge functions are deployed
- **THEN** the system SHALL restart the specified Docker container

---

## Requirement: Admin UI Build-Time Integration

The Vite plugin (`vite-plugin-gatewaze-modules.ts`) MUST provide a virtual module `virtual:gatewaze-modules` that exports all discovered module definitions. The admin application MUST import modules exclusively through this virtual module. The Vite plugin MUST NOT contain any hardcoded module names or paths.

### Scenario: Virtual module generation
- **GIVEN** module sources are configured in `gatewaze.config.ts`
- **WHEN** the Vite dev server starts or a production build runs
- **THEN** the plugin SHALL scan all module sources
- **AND** it SHALL generate a virtual module exporting all discovered `GatewazeModule` objects
- **AND** the admin app SHALL import from `virtual:gatewaze-modules` to access modules

### Scenario: Git source cloning at build time
- **GIVEN** a module source is a git repository URL
- **WHEN** the Vite plugin initializes
- **THEN** it SHALL clone the repository to `.gatewaze-modules/` cache
- **AND** it SHALL resolve module paths within the cloned repo

### Scenario: HMR support during development
- **GIVEN** the Vite dev server is running
- **WHEN** a file within a module source directory changes
- **THEN** the plugin SHALL trigger hot module replacement for affected modules

---

## Requirement: Admin Runtime Module Context

The `ModulesProvider` React context MUST provide runtime module state to the entire admin application. It MUST NOT reference any specific module by name or ID.

### Scenario: Context initialization
- **GIVEN** the admin application loads
- **WHEN** the `ModulesProvider` mounts
- **THEN** it SHALL fetch all records from `installed_modules`
- **AND** it SHALL seed any bundled modules not yet in the database with status `'disabled'`
- **AND** it SHALL expose: `modules`, `isModuleEnabled(id)`, `isFeatureEnabled(feature)`, `activeThemeModule`

### Scenario: Feature flag check
- **GIVEN** module "ticketing" is enabled and declares `features: ["ticketing", "ticket-export"]`
- **WHEN** the admin app calls `isFeatureEnabled("ticketing")`
- **THEN** it SHALL return `true`
- **AND** when called with `isFeatureEnabled("nonexistent")` it SHALL return `false`

---

## Requirement: Admin Dynamic Route Registration

The admin router MUST generate routes dynamically from `module.adminRoutes` declarations. Route components MUST be lazy-loaded and wrapped with `FeatureGuard` for feature-gated access. The router MUST NOT contain any hardcoded module route paths.

### Scenario: Module route rendering
- **GIVEN** a module declares `adminRoutes: [{ path: "/ticketing", component: () => import("./pages/Dashboard"), requiredFeature: "ticketing" }]`
- **WHEN** the admin router builds its route tree
- **THEN** it SHALL add a route at `/ticketing` with a lazy-loaded component
- **AND** the route SHALL be wrapped with `FeatureGuard` checking for the `"ticketing"` feature

### Scenario: Nested route merging
- **GIVEN** two modules both declare routes under `/settings/*`
- **WHEN** the admin router processes module routes
- **THEN** it SHALL merge nested routes under the shared parent path

---

## Requirement: Admin Dynamic Navigation

The admin navigation MUST be generated dynamically from `module.adminNavItems` declarations. Navigation items MUST respect `requiredFeature`, `order`, and `parentGroup` fields. The navigation system MUST NOT contain any hardcoded module navigation entries.

### Scenario: Navigation item rendering
- **GIVEN** a module declares `adminNavItems: [{ label: "Tickets", path: "/ticketing", icon: "ticket", order: 50, requiredFeature: "ticketing" }]`
- **WHEN** the navigation renders and "ticketing" feature is enabled
- **THEN** the navigation SHALL display "Tickets" at the specified order position
- **AND** if the feature is disabled, the item SHALL be hidden

### Scenario: Grouped navigation
- **GIVEN** a module declares nav items with `parentGroup: "admin"`
- **WHEN** the navigation renders
- **THEN** those items SHALL appear under the "admin" section of the sidebar

---

## Requirement: Extension Points (Slots System)

The system MUST provide named extension points (slots) where modules can inject UI components. Slots MUST be rendered via the generic `<ModuleSlot>` component. The host component MUST NOT know which modules fill a slot.

### Scenario: Slot registration and rendering
- **GIVEN** module "ticketing" registers a slot: `{ slotName: "event-detail:tabs", component: () => import("./TicketTab"), order: 50, requiredFeature: "ticketing" }`
- **WHEN** a host component renders `<ModuleSlot name="event-detail:tabs" props={{ eventId: "123" }} />`
- **THEN** the slot system SHALL resolve all registrations for `"event-detail:tabs"`
- **AND** it SHALL filter by enabled features
- **AND** it SHALL sort by `order` ascending
- **AND** it SHALL lazy-load each component with Suspense
- **AND** it SHALL pass `props` through to each component

### Scenario: Empty slot
- **GIVEN** no modules register for slot `"dashboard:widgets"`
- **WHEN** a host component renders `<ModuleSlot name="dashboard:widgets" />`
- **THEN** nothing SHALL be rendered
- **AND** no errors SHALL occur

### Scenario: Slot metadata access
- **GIVEN** a slot registration includes `meta: { label: "Tickets" }`
- **WHEN** host code calls `useModuleSlots("event-detail:tabs")`
- **THEN** the `meta` field SHALL be accessible without loading the component

---

## Requirement: Portal Page Registration

Modules MAY provide portal pages at `<module>/portal/pages/*.tsx`. A build-time script MUST generate a route registry (`generated-portal-modules.ts`) from filesystem convention. The portal MUST NOT contain hardcoded page imports.

### Scenario: Portal page discovery
- **GIVEN** a module has files at `portal/pages/index.tsx` and `portal/pages/_slug.tsx`
- **WHEN** the portal build script runs
- **THEN** it SHALL generate route entries for both pages
- **AND** `_slug.tsx` SHALL be mapped to a `[slug]` dynamic route segment

### Scenario: Portal navigation
- **GIVEN** a module declares `portalNav: { label: "Tickets", path: "/tickets", icon: "ticket", order: 10 }`
- **WHEN** the module is enabled
- **THEN** the `portal_nav` field SHALL be stored in `installed_modules`
- **AND** the portal SHALL read navigation from the database at runtime

---

## Requirement: Theme Module System

Modules with `type: 'theme'` MAY provide visual overrides for Admin and Portal. The system MUST enforce that only one theme module is active at a time.

### Scenario: Enable theme module
- **GIVEN** no theme module is currently active
- **WHEN** an admin enables a theme module
- **THEN** the theme's `themeOverrides` SHALL be applied to Admin and/or Portal
- **AND** the module SHALL be recorded as the active theme

### Scenario: Theme replacement
- **GIVEN** theme module "dark-mode" is currently active
- **WHEN** an admin enables theme module "corporate-blue"
- **THEN** "dark-mode" SHALL be automatically disabled
- **AND** "corporate-blue" SHALL become the active theme

### Scenario: Theme overrides scope
- **GIVEN** a theme declares `themeOverrides.admin.primaryColor: "blue"` and `themeOverrides.portal.portalTheme: "gradient_wave"`
- **WHEN** the theme is active
- **THEN** the Admin UI SHALL apply the primary color override
- **AND** the Portal SHALL apply the portal theme override
- **AND** settings listed in `lockedSettings` SHALL be read-only in the settings UI

---

## Requirement: Module Configuration

Modules MAY declare a configuration schema via `configSchema`. Configuration values MUST be stored in `installed_modules.config` as JSONB. The system MUST provide UI for editing module configuration based on the schema.

### Scenario: Configuration with schema
- **GIVEN** a module declares `configSchema: [{ key: "apiKey", type: "secret", required: true, description: "API key for external service" }]`
- **WHEN** an admin views the module's configuration page
- **THEN** the UI SHALL render a form field for `apiKey` with type `secret`
- **AND** the field SHALL be marked as required

### Scenario: Configuration update
- **GIVEN** an admin submits updated configuration for a module
- **WHEN** the PUT `/api/modules/:id/config` endpoint is called
- **THEN** the configuration SHALL be merged/upserted into the module's `config` JSONB column

---

## Requirement: Module Source Management

The admin UI MUST provide CRUD operations for module sources. Admins MUST be able to add git repository sources, remove sources, and upload zip-packaged modules. Source access tokens MUST be write-only (never returned in API responses).

### Scenario: Add git source
- **GIVEN** an admin provides a git repository URL
- **WHEN** the POST `/api/modules/sources` endpoint is called
- **THEN** the source SHALL be inserted into `module_sources` with origin `'user'`
- **AND** the system SHALL attempt to discover modules from the new source

### Scenario: Remove source
- **GIVEN** an admin removes a module source
- **WHEN** the DELETE `/api/modules/sources/:id` endpoint is called
- **THEN** the source SHALL be deleted from `module_sources`

### Scenario: Token security
- **GIVEN** a source has a `token` field set
- **WHEN** the GET `/api/modules/sources` endpoint is called
- **THEN** the `token` field SHALL NOT be included in the response

---

## Requirement: Module Update Management

The system MUST support checking for module updates and applying them. Updates MUST apply new migrations and redeploy edge functions.

### Scenario: Check for updates
- **GIVEN** module "ticketing" is installed at version "1.0.0" and the source now provides version "1.1.0"
- **WHEN** the GET `/api/modules/check-updates` endpoint is called
- **THEN** it SHALL return an update entry with `currentVersion: "1.0.0"` and `availableVersion: "1.1.0"`

### Scenario: Apply update
- **GIVEN** an update is available for module "ticketing"
- **WHEN** the POST `/api/modules/:id/update` endpoint is called
- **THEN** the system SHALL apply any new migrations
- **AND** it SHALL redeploy edge functions
- **AND** it SHALL update the version in `installed_modules`

### Scenario: Partial update failure
- **GIVEN** a module update's migrations succeed but edge function deployment fails
- **WHEN** the update operation completes
- **THEN** the module version SHALL be updated (migrations are committed)
- **AND** the edge function failure SHALL be reported in the response as a non-fatal warning
- **AND** the module status SHALL remain `'enabled'`
- **AND** the admin SHALL be able to retry edge function deployment via a subsequent update or reconcile

---

## Requirement: Core Decoupling Invariants

The core Gatewaze platform MUST maintain strict decoupling from all modules. The following invariants MUST hold:

1. The admin app SHALL import modules only via `virtual:gatewaze-modules` — no direct imports of any module package.
2. Admin routes SHALL be generated dynamically from `module.adminRoutes` — no hardcoded route paths for modules.
3. Admin navigation SHALL be generated dynamically from `module.adminNavItems` — no hardcoded nav entries for modules.
4. Admin slots SHALL be rendered via the generic `<ModuleSlot>` component — host components SHALL NOT reference specific modules.
5. Portal pages SHALL be generated at build time from filesystem convention — no hardcoded page imports for modules.
6. The API server SHALL load modules dynamically from sources — no hardcoded module requires or imports.
7. The database schema SHALL use generic tables (`installed_modules`, `module_sources`, `module_migrations`) — no module-specific columns or tables in the core schema.
8. Feature flags SHALL be checked generically via `isFeatureEnabled(flag)` — core code SHALL NOT check for specific module feature flags by name.
9. The config file (`gatewaze.config.ts`) SHALL list module sources (directories/repos), NOT individual module names or IDs.

### Scenario: Verify no module-specific imports in core
- **GIVEN** the core codebase (packages/admin/src, packages/api/src, packages/portal/src, packages/shared/src)
- **WHEN** a static analysis scan is performed
- **THEN** no import statements SHALL reference any specific module package name
- **AND** no string literals SHALL match known module IDs in conditional logic

---

## Requirement: Database Schema

The system MUST use three database tables for module state management. All tables MUST have Row-Level Security (RLS) enabled.

### Table: installed_modules
- `id` TEXT PRIMARY KEY — Module ID
- `name` TEXT NOT NULL
- `description` TEXT
- `version` TEXT NOT NULL
- `features` TEXT[] DEFAULT '{}'
- `status` TEXT NOT NULL DEFAULT 'not_installed' CHECK (status IN ('enabled', 'disabled', 'not_installed', 'error'))
- `config` JSONB DEFAULT '{}'
- `type` TEXT — 'feature', 'integration', 'theme'
- `source` TEXT
- `visibility` TEXT DEFAULT 'public'
- `portal_nav` JSONB
- `installed_at` TIMESTAMPTZ DEFAULT NOW()
- `updated_at` TIMESTAMPTZ DEFAULT NOW()

### Table: module_sources
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `url` TEXT NOT NULL
- `path` TEXT
- `branch` TEXT
- `label` TEXT
- `token` TEXT
- `origin` TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('config', 'user', 'upload'))
- `created_at` TIMESTAMPTZ DEFAULT NOW()
- UNIQUE (url, COALESCE(path, ''))

### Table: module_migrations
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `module_id` TEXT NOT NULL REFERENCES installed_modules(id) ON DELETE CASCADE
- `filename` TEXT NOT NULL
- `applied_at` TIMESTAMPTZ DEFAULT NOW()
- `checksum` TEXT NOT NULL
- UNIQUE (module_id, filename)

### Scenario: RLS enforcement
- **GIVEN** a non-admin authenticated user
- **WHEN** they attempt to modify `installed_modules`
- **THEN** the operation SHALL be denied by RLS policy
- **AND** read access SHALL be permitted for all authenticated users

---

## Requirement: API Security

All module management endpoints MUST require an authenticated admin session. Module source tokens MUST be write-only. Migrations MUST execute under service role only.

### Scenario: Unauthenticated access
- **GIVEN** an unauthenticated request
- **WHEN** it hits any `/api/modules/*` endpoint
- **THEN** the system SHALL return 401 Unauthorized

### Scenario: Non-admin access
- **GIVEN** an authenticated non-admin user
- **WHEN** they attempt to enable/disable a module
- **THEN** the system SHALL return 403 Forbidden

### Scenario: Upload input validation
- **GIVEN** a zip file is uploaded via `/api/modules/upload`
- **WHEN** the system processes the upload
- **THEN** it SHALL validate: file size does not exceed 50MB, the archive contains no path traversal sequences (e.g., `../`), the archive contains an `index.ts` at the root level, and the extracted content does not contain executable binaries
- **AND** any validation failure SHALL return 400 with a descriptive error

### Scenario: Module source URL validation
- **GIVEN** an admin submits a module source URL
- **WHEN** the POST `/api/modules/sources` endpoint processes it
- **THEN** it SHALL validate the URL is a valid git URL or local path
- **AND** it SHALL reject URLs pointing to internal/private network ranges unless explicitly allowed
- **AND** any validation failure SHALL return 400 with a descriptive error

---

## Requirement: Error Handling

The system MUST handle all failure scenarios gracefully without crashing the platform.

### Scenario: Migration failure with rollback
- **GIVEN** a module migration contains invalid SQL
- **WHEN** the migration is executed
- **THEN** the transaction SHALL be rolled back
- **AND** the module status SHALL be set to `'error'`
- **AND** the error details SHALL be returned to the caller

### Scenario: Edge function deployment failure
- **GIVEN** edge function deployment fails
- **WHEN** a module is being enabled
- **THEN** the enable operation SHALL continue (non-blocking)
- **AND** the failure SHALL be logged and reported in the response

### Scenario: Lifecycle hook failure
- **GIVEN** a module's `onEnable` hook throws an error
- **WHEN** the module is being enabled
- **THEN** the error SHALL be caught and logged
- **AND** the module status SHALL reflect the error state

---

## Requirement: Performance

The module system MUST meet the following performance targets.

- Module discovery (full scan of up to 50 sources) SHALL complete in under 5 seconds.
- Module enable without migrations SHALL complete in under 2 seconds.
- Module enable with migrations SHALL complete in under 30 seconds.
- Feature flag checks SHALL complete in under 1 millisecond (in-memory lookup).
- Slot resolution SHALL complete in under 5 milliseconds per slot.
- Admin UI initial load with modules SHALL complete in under 3 seconds (with lazy-loaded routes).

**Measurement conditions**: Performance targets assume a standard deployment environment (single API server instance, managed Supabase database, SSD storage) with up to 50 module sources and 100 total discovered modules.

---

## Requirement: API Contracts

All module management endpoints MUST return consistent JSON response envelopes. Success responses MUST include a `success: true` field. Error responses MUST include `error` (string message) and `code` (HTTP status code) fields.

### Shared Types

```typescript
type ConfigField = {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'secret';
  required: boolean;
  default?: unknown;
  description: string;
};

type ModuleSource = {
  id: string;        // UUID
  url: string;
  path: string | null;
  branch: string | null;
  label: string | null;
  // token is NEVER included in responses
  origin: 'config' | 'user' | 'upload';
  created_at: string; // ISO 8601
};
```

### Endpoint: GET /api/modules/available
- **Request**: No body. Requires authenticated admin session.
- **Response 200**: `{ "modules": [{ "id": string, "name": string, "description": string, "version": string, "type": string | null, "features": string[], "status": "enabled" | "disabled" | "not_installed" | "error", "hasUpdate": boolean, "availableVersion": string | null, "configSchema": ConfigField[], "dependencies": string[] }] }`

### Endpoint: POST /api/modules/:id/enable
- **Request**: No body. Requires authenticated admin session.
- **Response 200**: `{ "success": true, "migrationsApplied": number, "edgeFunctionsDeployed": string[] }`
- **Response 400**: `{ "error": "Dependency X is not enabled", "code": 400 }`
- **Response 404**: `{ "error": "Module not found", "code": 404 }`

### Endpoint: POST /api/modules/:id/disable
- **Request**: No body. Requires authenticated admin session.
- **Response 200**: `{ "success": true }`
- **Response 400**: `{ "error": "Module Y depends on this module", "code": 400 }`

### Endpoint: PUT /api/modules/:id/config
- **Request**: `{ "config": Record<string, unknown> }`. Requires authenticated admin session.
- **Response 200**: `{ "success": true }`
- **Response 400**: `{ "error": "Validation failed: apiKey is required", "code": 400 }`
- **Response 404**: `{ "error": "Module not found", "code": 404 }`

### Endpoint: POST /api/modules/sources
- **Request**: `{ "url": string, "path"?: string, "branch"?: string, "label"?: string, "token"?: string }`. Requires authenticated admin session.
- **Response 201**: `{ "source": ModuleSource }`
- **Response 400**: `{ "error": "Invalid URL format", "code": 400 }`
- **Response 409**: `{ "error": "Source with this URL and path already exists", "code": 409 }`

### Endpoint: POST /api/modules/upload
- **Request**: `multipart/form-data` with `file` field (zip). Requires authenticated admin session.
- **Response 200**: `{ "success": true, "moduleId": string, "source": ModuleSource }`
- **Response 400**: `{ "error": "No index.ts found in upload", "code": 400 }`

### Endpoint: POST /api/modules/:id/update
- **Request**: No body. Requires authenticated admin session.
- **Response 200**: `{ "success": true, "newVersion": string, "migrationsApplied": number }`
- **Response 404**: `{ "error": "Module not found", "code": 404 }`
- **Response 400**: `{ "error": "No update available", "code": 400 }`

### Endpoint: POST /api/modules/reconcile
- **Request**: No body. Requires authenticated admin session.
- **Response 200**: `{ "registered": number, "updated": number, "migrationsApplied": number }`

---

## Requirement: Runtime API Route Registration

Modules MAY declare `apiRoutes` to extend the Express API server with custom endpoints. The API server MUST mount module routes dynamically at startup and after reconciliation. Module API routes MUST be namespaced under `/api/m/<module-id>/` to prevent path collisions with core routes.

### Scenario: Module API route mounting
- **GIVEN** a module declares `apiRoutes: [{ method: "GET", path: "/events", handler: () => import("./api/events") }]`
- **WHEN** the API server starts and the module is enabled
- **THEN** the route SHALL be mounted at `/api/m/<module-id>/events`
- **AND** the handler SHALL be lazy-loaded

### Scenario: Module API route isolation
- **GIVEN** two modules both declare a route at path `/events`
- **WHEN** both modules are enabled
- **THEN** they SHALL be mounted at `/api/m/<module-a-id>/events` and `/api/m/<module-b-id>/events` respectively
- **AND** there SHALL be no path collision

### Scenario: Disabled module routes
- **GIVEN** a module with API routes is disabled
- **WHEN** a request hits `/api/m/<module-id>/*`
- **THEN** the system SHALL return 404

---

## Requirement: Observability

The module system MUST provide structured logging, key metrics, and alerting hooks for all lifecycle operations.

### Scenario: Lifecycle event logging
- **GIVEN** any module lifecycle operation (enable, disable, update, uninstall)
- **WHEN** the operation completes (success or failure)
- **THEN** the system SHALL log at INFO level: module ID, operation type, duration, and result
- **AND** on failure, it SHALL log at ERROR level with full error details

### Scenario: Module source error logging
- **GIVEN** a module source fails to resolve (git clone failure, validation error)
- **WHEN** the module loader encounters the error
- **THEN** the system SHALL log at WARN level: source URL, error type, error message

### Scenario: Migration execution logging
- **GIVEN** a module migration is executed
- **WHEN** the migration completes
- **THEN** the system SHALL log at INFO level: module ID, migration filename, execution duration

### Scenario: Edge function deployment logging
- **GIVEN** an edge function is deployed
- **WHEN** the deployment completes
- **THEN** the system SHALL log at INFO level: function name, deployment method (local copy or cloud deploy), result

### Scenario: Key metrics tracking
- **GIVEN** the module system is running
- **WHEN** metrics are collected
- **THEN** the system SHALL track: total modules by status (enabled/disabled/error), module enable/disable operation count, migration execution count and failure rate, module discovery scan duration, and edge function deployment count
- **AND** these metrics SHALL be accessible via structured log aggregation or an observability endpoint

---

## Requirement: Testing Strategy

The module system MUST be testable at unit, integration, and end-to-end levels.

- **Unit tests** SHALL cover: module loader validation logic, dependency topological sort, source deduplication, feature flag resolution, and slot filtering/sorting.
- **Integration tests** SHALL cover: full module lifecycle (add source, discover, enable with migrations, configure, disable, uninstall) against a test Supabase instance.
- **Contract tests** SHALL validate sample modules against the `GatewazeModule` interface to catch contract drift.
- **E2E tests** SHALL cover: Admin UI module management flows (enable/disable toggle, configuration form, source management).
- **Decoupling verification** SHALL be automated: a CI check SHALL scan `packages/admin/src`, `packages/api/src`, `packages/portal/src`, and `packages/shared/src` for hardcoded module references.

---

## Requirement: Deployment Strategy

Admin and Portal applications MUST be rebuilt when module sources change (Vite plugin re-scans, portal registry regenerates). The API server SHALL re-discover modules on startup and on-demand via the `/api/modules/reconcile` endpoint.

### Scenario: Module source change requires rebuild
- **GIVEN** a new module source is added or an existing source is updated
- **WHEN** the admin or portal needs to reflect the change
- **THEN** a rebuild of the respective application SHALL be triggered
- **AND** the build process SHALL be repeatable and produce deterministic output

### Scenario: Rollback procedure
- **GIVEN** a module update causes errors in production
- **WHEN** an admin needs to roll back
- **THEN** the admin SHALL be able to disable the problematic module via the Admin UI
- **AND** the system SHALL revert to the previous state (module disabled, routes removed from runtime)
- **AND** database migrations SHALL NOT be automatically rolled back (requires explicit admin action)

---

## Requirement: Open Questions and Future Considerations

The following items are identified as open questions or future enhancements that MAY be addressed in subsequent specification revisions:

1. **Module sandboxing**: Should future versions introduce WASM or process-level isolation for untrusted modules? Currently modules run with full platform privileges.
2. **Module signing**: Should modules be cryptographically signed to verify authenticity and prevent tampering?
3. **Dependent disable cascade**: When disabling a module, should dependents be automatically disabled (with confirmation) or should it only block with an error?
4. **Module versioning conflicts**: When two sources provide the same module ID with different versions, should the system prefer the higher version, the first-loaded, or prompt the admin?
5. **Hot reload for Portal**: The portal currently requires a full rebuild — could incremental static regeneration or dynamic imports be used to avoid rebuilds?
6. **Migration rollback**: Should modules be able to declare reverse migrations (`down` SQL) for clean uninstall?
7. **Module health checks**: Should modules expose a health check endpoint that the platform monitors after enable?
8. **Rate limiting for module API routes**: Should `/api/m/<module-id>/*` routes have per-module rate limiting to prevent a misbehaving module from affecting the platform?
