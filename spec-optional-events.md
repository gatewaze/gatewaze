# OpenSpec: Extract Events into an Optional Core Module

```
openspec: 1.0.0
id: gatewaze-optional-events
title: Extract Events into an Optional Core Module
status: draft
authors:
  - name: Gatewaze Team
created: 2026-03-29
```

## 1. Executive Summary

This specification defines the plan to extract the Events feature from Gatewaze's core into an optional `core-events` module. Currently, Events is deeply embedded across the database schema, API routes, admin UI, and portal — treated as an always-on capability. This change enables Gatewaze to function as a general-purpose people/community platform without events, while preserving full event functionality when the module is enabled.

## 2. Problem Statement

Gatewaze is evolving beyond an event-centric platform. The current architecture assumes events are always present, which:

- **Forces unnecessary complexity** on deployments that don't need events
- **Creates maintenance burden** — event code runs even when unused
- **Limits market positioning** — the platform can't serve pure community/CRM use cases
- **Contradicts the module architecture** — sub-features of events (speakers, sponsors, agenda) are already modular, but their parent feature is not

## 3. Goals

1. Events become an optional module using the existing `GatewazeModule` interface
2. The platform is fully functional without events installed (people, community features work independently)
3. All existing event sub-modules declare `core-events` as a dependency
4. Existing deployments experience zero breaking changes during migration
5. The portal operates in both event-mode and non-event-mode
6. Database migrations are conditional — event tables only exist when the module is installed

## 4. Non-Goals

- Extracting People into a module (People remains core)
- Rewriting the module system itself
- Changing the event sub-module architecture (speakers, sponsors, etc.)
- Supporting partial event functionality (events are all-or-nothing)
- Multi-tenant module configurations (module state is instance-wide)

## 4.1. Broader Pattern: Core Modules with Sub-Modules

While this spec focuses on extracting Events, it establishes a **repeatable pattern** for other features. The same core-module + sub-module architecture applies to:

- **Events**: `core-events` + sub-modules (`event-speakers`, `event-sponsors`, `event-agenda`, etc.)
- **Newsletters**: `core-newsletters` + output-type sub-modules (`newsletter-customerio`, `newsletter-substack`, `newsletter-beehiiv`)
- **Future features**: Any feature that has a core capability with pluggable extensions

Additionally, the platform has **integration-type sub-modules** that provide swappable implementations of a capability:

- **Short Links**: Currently hardcoded to Short.io. Should become a pluggable integration where exactly one provider is active at a time (`shortlink-shortio`, `shortlink-bitly`, etc.). Other modules (e.g., newsletters) consume the short link service generically without knowing which provider is active.

The design decisions in this spec (permission model, dependency declarations, conditional route mounting, portal mode switching) SHALL be general enough to apply to any core-module extraction and integration pattern, not just events.

---

## 5. Current Architecture

### 5.1 Core Event Assets (to be extracted)

**Database tables** (migration `00004_events.sql`):
- `events` — core events table (~107 columns)
- `events_registrations` — links people to events (FK to both `events` and `people`)
- `events_attendance` — check-in records (FK to both `events` and `people`)
- `registration_field_mappings` — maps form fields to people attributes

**API routes** (mounted unconditionally in `packages/api/src/server.ts`):
- `/api/events` — CRUD operations
- `/api/registrations` — registration management
- `/api/attendance` — check-in/attendance
- `/api/csv` — event import/export

**Admin UI** (defined in `packages/admin/src/app/router/protected.tsx`):
- `/admin/events` — events list page
- `/admin/events/:eventId` — event detail
- `/admin/events/:eventId/:tab` — event detail tabs
- Navigation item in `dashboards.ts` with `requiredFeature: "events"`

**Admin services** (in `packages/admin/src/`):
- `eventService.ts`, `bulkRegistrationService.ts`, `notificationService.ts`
- `registrationService.ts` / `registrationService_v2.ts`, `eventQrService.ts`

**Portal** (entire `packages/portal/` is event-centric):
- `middleware.ts` — resolves custom domains to events
- Sitemap generation with event pages
- All portal routes under `/events/[identifier]/(portal)/`

### 5.2 Dependent Modules

These modules declare `group: "events"` and register `event-detail:tab` admin slots:
- `event-speakers` (depends on `event-sponsors`)
- `event-sponsors`
- `event-agenda` (depends on `event-speakers`)
- `event-interest`
- `event-invites` (depends on `calendars`)
- `event-media` (depends on `event-sponsors`)
- `event-topics`

### 5.3 Feature Flag System

Routes are already guarded by `requiredFeature` flags checked via `useFeaturePermissions()`. The events navigation item already has `requiredFeature: "events"`. This existing system will be leveraged.

### 5.4 People as Core

People is a core feature that remains non-modular:
- Database: `people`, `people_profiles`, `people_badges`, `people_qr_tokens`, `contact_scans`
- API: `/api/people` mounted unconditionally
- Admin: `/admin/people` with `requiredFeature: "dashboard_people"`
- People can exist independently of events

---

## 6. Proposed Architecture

### Requirement: Core-Events Module Definition

A new module `core-events` SHALL be created following the `GatewazeModule` interface. It SHALL contain all event-related code currently embedded in the core platform.

#### Scenario: Module registration
- **GIVEN** the `core-events` module is discovered by the module loader
- **WHEN** the system reconciles modules
- **THEN** it SHALL appear in `installed_modules` with its declared features
- **AND** it SHALL declare `features: ['events']`
- **AND** it SHALL declare `dependencies: []` (people is core, not a module dependency)
- **AND** it SHALL declare `group: 'feature'`

#### Scenario: Module structure
- **GIVEN** the `core-events` module directory
- **WHEN** its contents are examined
- **THEN** it SHALL contain:
  - `index.ts` — module definition with `GatewazeModule` export
  - `api/events.ts` — events CRUD route handler
  - `api/registrations.ts` — registration management route handler
  - `api/attendance.ts` — attendance/check-in route handler
  - `api/csv.ts` — event CSV import/export handler
  - `admin/pages/EventsPage.tsx` — events list page
  - `admin/pages/EventDetailPage.tsx` — event detail page
  - `admin/services/` — event admin services (eventService, registrationService, etc.)
  - `portal/` — event portal pages and middleware logic
  - `migrations/001_create_events_tables.sql` — event table creation

---

### Requirement: Conditional API Route Mounting

The API server SHALL conditionally mount event-related routes based on the `core-events` module status.

**Rationale**: Currently `server.ts` unconditionally imports and mounts event routes. This must change so that event endpoints only exist when the module is enabled.

#### Scenario: Events module enabled
- **GIVEN** `core-events` module has status `'enabled'` in `installed_modules`
- **WHEN** the API server starts or reconciles
- **THEN** it SHALL mount routes at `/api/events`, `/api/registrations`, `/api/attendance`
- **AND** CSV event endpoints SHALL be mounted at `/api/csv`
- **AND** all routes SHALL function identically to the current implementation

#### Scenario: Events module not installed or disabled
- **GIVEN** `core-events` module has status `'not_installed'` or `'disabled'`
- **WHEN** a client sends a request to `/api/events`, `/api/registrations`, or `/api/attendance`
- **THEN** the server SHALL return `404 Not Found`
- **AND** all non-event API endpoints SHALL function normally

#### Scenario: Route path preservation
- **GIVEN** the existing module API route convention namespaces under `/api/m/<module-id>/`
- **WHEN** `core-events` routes are mounted
- **THEN** they SHALL be mounted at their current paths (`/api/events`, `/api/registrations`, `/api/attendance`) NOT under `/api/m/core-events/`
- **AND** this is to preserve backward compatibility with all existing API consumers

**Rationale**: Unlike regular modules which are namespaced under `/api/m/`, core-events routes must maintain their existing paths to avoid breaking every API consumer, mobile app, and integration.

---

### Requirement: Admin UI Extraction

Event admin pages, navigation, and services SHALL be moved from the core admin app into the `core-events` module and loaded dynamically.

#### Scenario: Navigation provided by module
- **GIVEN** `core-events` is enabled
- **WHEN** the admin navigation renders
- **THEN** the "Events" nav item SHALL appear at its current position
- **AND** it SHALL be provided via `adminNavItems` in the module definition, not hardcoded in `dashboards.ts`
- **AND** it SHALL retain `requiredFeature: "events"`, icon `"admin.events"`, and path `/events`

#### Scenario: Navigation hidden when disabled
- **GIVEN** `core-events` is not enabled
- **WHEN** the admin navigation renders
- **THEN** no "Events" nav item SHALL appear
- **AND** no event-related navigation SHALL be visible

#### Scenario: Admin routes provided by module
- **GIVEN** `core-events` is enabled
- **WHEN** the admin router builds its route tree
- **THEN** it SHALL include routes for `/events`, `/events/:eventId`, and `/events/:eventId/:tab`
- **AND** these routes SHALL be lazy-loaded from the module
- **AND** they SHALL be wrapped with `FeatureGuard` checking for `"events"` feature

#### Scenario: Admin routes absent when disabled
- **GIVEN** `core-events` is not enabled
- **WHEN** a user navigates to `/admin/events`
- **THEN** the admin SHALL show a 404 or redirect to the dashboard
- **AND** no event admin components SHALL be loaded

#### Scenario: Event detail tab slots preserved
- **GIVEN** the event detail page uses `<ModuleSlot name="event-detail:tab">` for sub-module tabs
- **WHEN** `core-events` provides the event detail page
- **THEN** it SHALL continue to render the `event-detail:tab` slot
- **AND** existing sub-modules (speakers, sponsors, etc.) SHALL inject their tabs as before

---

### Requirement: Portal Architecture Changes

The portal SHALL support two operating modes: event-mode (when `core-events` is enabled) and community-mode (when `core-events` is disabled).

**Rationale**: The portal is the most deeply event-coupled component. Currently, all routing flows through event resolution (custom domains → event ID). This must be refactored to handle a non-event portal.

#### Scenario: Portal in event mode
- **GIVEN** `core-events` is enabled
- **WHEN** a request reaches the portal
- **THEN** it SHALL behave identically to the current implementation
- **AND** custom domain resolution, event pages, registration, and check-in SHALL all function

#### Scenario: Portal in community mode
- **GIVEN** `core-events` is not enabled
- **WHEN** a request reaches the portal
- **THEN** the middleware SHALL NOT attempt event resolution
- **AND** the portal SHALL serve community/people content
- **AND** routes under `/events/*` SHALL return 404
- **AND** the sitemap SHALL exclude event URLs

#### Scenario: Portal middleware mode detection
- **GIVEN** the portal middleware processes an incoming request
- **WHEN** it determines which mode to operate in
- **THEN** it SHALL check the `core-events` module status (cached, not per-request DB query)
- **AND** it SHALL route to the appropriate handler based on mode

#### Scenario: Custom domain resolution in community mode
- **GIVEN** `core-events` is disabled and a custom domain is configured
- **WHEN** a request arrives at the custom domain
- **THEN** the portal SHALL resolve the domain to the organization/community context
- **AND** it SHALL NOT attempt to resolve to an event

#### Scenario: Portal sitemap generation
- **GIVEN** the portal generates a sitemap
- **WHEN** `core-events` is not enabled
- **THEN** the sitemap SHALL exclude all `/events/*` URLs
- **AND** it SHALL include only community/people pages

---

### Requirement: Database Migration Strategy

Event database tables SHALL be owned by the `core-events` module. Existing installations SHALL be migrated seamlessly.

#### Scenario: Fresh installation without events
- **GIVEN** a new Gatewaze installation
- **WHEN** the core migrations run
- **THEN** they SHALL NOT create `events`, `events_registrations`, `events_attendance`, or `registration_field_mappings` tables
- **AND** the `people` table SHALL be created normally
- **AND** the platform SHALL function without event tables present

#### Scenario: Fresh installation with events
- **GIVEN** a new Gatewaze installation where the admin installs `core-events`
- **WHEN** the module is enabled
- **THEN** the module's migration SHALL create `events`, `events_registrations`, `events_attendance`, and `registration_field_mappings` tables
- **AND** foreign keys from `events_registrations` and `events_attendance` to `people` SHALL be created

#### Scenario: Upgrade existing installation
- **GIVEN** an existing Gatewaze installation with event tables already present
- **WHEN** the platform upgrades to the version containing this change
- **THEN** a core migration SHALL run that:
  1. Inserts `core-events` into `installed_modules` with status `'enabled'`
  2. Records the events table migration as already applied in `module_migrations`
- **AND** no tables SHALL be dropped, recreated, or altered
- **AND** all event data SHALL remain intact and accessible
- **AND** the platform SHALL function identically to before the upgrade

#### Scenario: Core migration is idempotent
- **GIVEN** the upgrade migration runs on an installation that already has `core-events` registered
- **WHEN** the migration executes
- **THEN** it SHALL use `ON CONFLICT DO NOTHING` semantics
- **AND** no errors SHALL occur
- **AND** no data SHALL be modified

#### Scenario: Removing core migration from sequence
- **GIVEN** the original `00004_events.sql` core migration
- **WHEN** the extraction is complete
- **THEN** the migration file SHALL be retained in the core migrations directory (for existing checksum validation)
- **AND** it SHALL be wrapped with a guard that skips execution if the tables already exist
- **AND** for fresh installations, it SHALL NOT execute (event tables come from the module)

---

### Requirement: Dependent Module Updates

All event sub-modules SHALL declare `core-events` as a dependency.

#### Scenario: Sub-module dependency declaration
- **GIVEN** each event sub-module (`event-speakers`, `event-sponsors`, `event-agenda`, `event-interest`, `event-invites`, `event-media`, `event-topics`)
- **WHEN** their module definitions are examined
- **THEN** each SHALL include `'core-events'` in their `dependencies` array

#### Scenario: Sub-module enable blocked without core-events
- **GIVEN** `core-events` is not enabled
- **WHEN** an admin attempts to enable `event-speakers`
- **THEN** the system SHALL return a 400 error: "Dependency core-events is not enabled"

#### Scenario: Cascade disable
- **GIVEN** `core-events` is enabled along with `event-speakers` and `event-agenda`
- **WHEN** an admin disables `core-events`
- **THEN** the system SHALL either:
  - Block the disable with error listing dependent modules, OR
  - Prompt for confirmation and cascade-disable all dependent modules
- **AND** the chosen behavior SHALL match the existing module lifecycle cascade rules

#### Scenario: Calendars module junction table
- **GIVEN** the `calendars` module creates a `calendars_events` junction table
- **WHEN** `core-events` is not installed (no `events` table)
- **THEN** the `calendars` module migration SHALL handle the missing `events` table gracefully
- **AND** the `calendars_events` junction table SHALL only be created when both `calendars` and `core-events` are enabled
- **AND** this MAY be achieved by making `calendars` optionally depend on `core-events` or by splitting the junction table into a bridge module

---

### Requirement: Per-Module Permissions

Admin permissions SHALL be tied to the module system. Each module SHALL declare the permissions it provides, and the existing permission infrastructure SHALL dynamically incorporate module-provided permissions.

**Rationale**: Currently, features like `events` are hardcoded in the `CoreFeature` type and `FEATURE_METADATA` constant. With events becoming a module, permissions must be dynamically registered by modules rather than statically defined in core. This also establishes the pattern for all future modules (newsletters, etc.).

#### Scenario: Module declares permissions
- **GIVEN** the `core-events` module definition
- **WHEN** its `features` array is examined
- **THEN** it SHALL declare features that map to permission identifiers: `['events']`
- **AND** it MAY declare additional granular permissions via a `permissions` field:
  ```typescript
  permissions: [
    { id: 'events', label: 'Events', description: 'View and manage events', category: 'dashboard' },
    { id: 'events.registrations', label: 'Registrations', description: 'Manage event registrations', category: 'dashboard' },
    { id: 'events.attendance', label: 'Attendance', description: 'Check-in and attendance tracking', category: 'dashboard' }
  ]
  ```

#### Scenario: Sub-module inherits parent permissions
- **GIVEN** `event-speakers` sub-module depends on `core-events`
- **WHEN** the sub-module declares its own permissions
- **THEN** those permissions SHALL only be grantable when `core-events` is enabled
- **AND** the permission UI SHALL group sub-module permissions under the parent module

#### Scenario: Dynamic feature type resolution
- **GIVEN** the `AdminFeature` type currently unions `CoreFeature` with module features
- **WHEN** `core-events` is enabled
- **THEN** `'events'` SHALL appear as a valid `AdminFeature`
- **AND** when `core-events` is disabled, `'events'` SHALL NOT appear in the available features list
- **AND** existing `admin_permissions` rows referencing `'events'` SHALL be preserved but inactive

#### Scenario: Permission metadata provided by module
- **GIVEN** core currently defines `FEATURE_METADATA` with static entries for events
- **WHEN** events are extracted to a module
- **THEN** the module SHALL provide its own feature metadata (label, description, category, route)
- **AND** the `FEATURE_METADATA` registry SHALL merge core metadata with module-provided metadata at runtime
- **AND** the hardcoded `events` entry SHALL be removed from core `FEATURE_METADATA`

#### Scenario: Permission group interaction
- **GIVEN** an `admin_permission_groups` group includes `'events'` as a feature
- **WHEN** `core-events` is disabled
- **THEN** the `'events'` feature in the group SHALL be treated as inactive (not grantable)
- **AND** the group SHALL still function for its other features
- **AND** when `core-events` is re-enabled, the `'events'` feature in the group SHALL become active again

#### Scenario: Permission UI shows module permissions
- **GIVEN** an admin is managing another admin's permissions
- **WHEN** the permission management UI renders
- **THEN** it SHALL show permissions grouped by module
- **AND** disabled modules' permissions SHALL be hidden or shown as unavailable
- **AND** the category grouping (dashboard, admin, system) SHALL incorporate module-provided categories

#### Scenario: RPC function handles module permissions
- **GIVEN** the `admin_has_feature_permission()` RPC function checks permissions
- **WHEN** checking a module-provided feature like `'events'`
- **THEN** it SHALL verify both:
  1. The admin has been granted the permission (via `admin_permissions` or `admin_permission_groups`)
  2. The owning module is currently enabled
- **AND** if the module is disabled, the function SHALL return `false` regardless of granted permissions

#### Scenario: Newsletter module permissions (pattern validation)
- **GIVEN** a future `core-newsletters` module with sub-modules (`newsletter-customerio`, `newsletter-substack`, `newsletter-beehiiv`)
- **WHEN** the permission system processes these modules
- **THEN** `core-newsletters` SHALL declare permissions like `['newsletters']`
- **AND** each output sub-module SHALL declare its own permissions (e.g., `'newsletters.customerio'`)
- **AND** the permission UI SHALL group them hierarchically: Newsletters → Customer.io, Substack, Beehiiv
- **AND** disabling `core-newsletters` SHALL make all sub-module permissions inactive

---

### Requirement: Pluggable Integration Pattern (Short Links)

The module system SHALL support a **provider pattern** where multiple modules implement the same integration interface, but only one provider is active at a time. Short link generation is the first use case.

**Rationale**: Currently Short.io is hardcoded as the short link provider. Other modules (newsletters, event sharing) consume short links without caring which service generates them. This should be abstracted so the provider is swappable.

#### Scenario: Integration interface declaration
- **GIVEN** the platform defines a `shortlink` integration interface
- **WHEN** provider modules are examined
- **THEN** each provider module (`shortlink-shortio`, `shortlink-bitly`, etc.) SHALL declare:
  ```typescript
  {
    id: 'shortlink-shortio',
    type: 'integration',
    provides: 'shortlink',  // the integration interface it implements
    configSchema: [
      { key: 'apiKey', type: 'secret', required: true, description: 'Short.io API key' },
      { key: 'domain', type: 'string', required: true, description: 'Custom short domain' }
    ]
  }
  ```

#### Scenario: Single active provider enforcement
- **GIVEN** `shortlink-shortio` is enabled as the active `shortlink` provider
- **WHEN** an admin attempts to enable `shortlink-bitly`
- **THEN** the system SHALL prompt: "shortlink-shortio is currently the active short link provider. Switch to shortlink-bitly?"
- **AND** upon confirmation, it SHALL disable `shortlink-shortio` and enable `shortlink-bitly`
- **AND** at most one provider for each integration interface SHALL be enabled at any time

#### Scenario: Consumer modules use generic interface
- **GIVEN** a module (e.g., `core-newsletters`) needs to generate short links
- **WHEN** it calls the short link service
- **THEN** it SHALL call a generic platform service (e.g., `shortlinkService.create(url)`)
- **AND** the platform SHALL route the call to whichever `shortlink` provider is currently active
- **AND** if no provider is active, the service SHALL return the original URL unchanged (graceful degradation)

#### Scenario: Provider migration
- **GIVEN** an admin switches from `shortlink-shortio` to `shortlink-bitly`
- **WHEN** the switch occurs
- **THEN** existing short links SHALL continue to work (they are already generated)
- **AND** new short links SHALL be generated by the new provider
- **AND** no bulk re-generation SHALL occur automatically

#### Scenario: Integration interface registry
- **GIVEN** the module system discovers provider modules
- **WHEN** it builds the integration registry
- **THEN** it SHALL group providers by their `provides` field
- **AND** the admin module management UI SHALL show providers grouped under their integration type
- **AND** only one provider per integration type SHALL be toggleable to active

---

### Requirement: Module Disable vs Uninstall Behavior

The `core-events` module SHALL distinguish between disable (reversible) and uninstall (destructive).

#### Scenario: Disable preserves data
- **GIVEN** `core-events` is enabled with event data in the database
- **WHEN** an admin disables the module
- **THEN** event tables SHALL remain in the database with all data intact
- **AND** API routes SHALL be unmounted (requests return 404)
- **AND** admin UI SHALL hide event pages
- **AND** portal SHALL switch to community mode

#### Scenario: Re-enable restores functionality
- **GIVEN** `core-events` was previously disabled (data still in database)
- **WHEN** an admin re-enables the module
- **THEN** all event data SHALL be immediately accessible
- **AND** API routes SHALL be remounted
- **AND** admin UI SHALL show event pages
- **AND** portal SHALL switch back to event mode
- **AND** no migrations SHALL need to run

#### Scenario: Uninstall is destructive
- **GIVEN** an admin explicitly uninstalls `core-events` (not just disable)
- **WHEN** the uninstall is triggered
- **THEN** the system SHALL prompt for explicit confirmation with a data loss warning
- **AND** upon confirmation, it SHALL drop event tables via down migrations
- **AND** dependent module tables SHALL be cascade-dropped
- **AND** the `people` table SHALL NOT be affected (people are core)
- **AND** this action SHALL be irreversible

---

### Requirement: Default Module State for New Installations

New Gatewaze installations SHALL have `core-events` available but the default state shall be configurable.

#### Scenario: Default disabled for new installations
- **GIVEN** a fresh Gatewaze installation
- **WHEN** the module reconciliation runs
- **THEN** `core-events` SHALL appear in the modules list with status `'not_installed'`
- **AND** the admin SHALL be able to install and enable it from the modules page

#### Scenario: Pre-configured installations
- **GIVEN** a `gatewaze.config.ts` that includes `core-events` in its module sources
- **WHEN** the installation runs
- **THEN** `core-events` SHALL be available for installation
- **AND** an `autoEnable` configuration option MAY be provided to auto-enable on first discovery

---

### Requirement: Security Considerations

Module extraction SHALL not introduce security regressions. The permission and access control model SHALL be preserved or strengthened.

#### Scenario: RLS policies remain intact
- **GIVEN** event tables have Row-Level Security policies defined in `00007_rls_policies.sql`
- **WHEN** events are extracted to a module
- **THEN** the RLS policies SHALL be included in the module's migration
- **AND** they SHALL enforce the same access control as today
- **AND** service role bypass SHALL continue to work for admin operations

#### Scenario: Module-provided API routes respect auth
- **GIVEN** event API routes are served by the `core-events` module
- **WHEN** an unauthenticated request reaches `/api/events`
- **THEN** it SHALL be rejected with `401 Unauthorized`
- **AND** module routes SHALL use the same auth middleware as core routes

#### Scenario: Module configuration secrets
- **GIVEN** integration modules (e.g., `shortlink-shortio`) store API keys in their config
- **WHEN** the config is stored in `installed_modules.config` JSONB
- **THEN** secret-type config values SHALL be encrypted at rest
- **AND** they SHALL never be returned in plaintext via GET API responses

#### Scenario: Module isolation
- **GIVEN** a module provides API routes and admin components
- **WHEN** the module is disabled
- **THEN** its routes SHALL be completely unreachable (not just hidden)
- **AND** its admin components SHALL not be loaded into the browser bundle
- **AND** its database tables SHALL remain but be inaccessible via the API

---

### Requirement: Error Handling

The system SHALL handle module-related errors gracefully without breaking the core platform.

#### Scenario: Module fails to load
- **GIVEN** the `core-events` module source is corrupted or missing
- **WHEN** the API server starts
- **THEN** it SHALL log an error for the failed module
- **AND** all other modules and core functionality SHALL continue to work
- **AND** the module status SHALL be set to `'error'` in `installed_modules`

#### Scenario: Event API returns 404 when module disabled
- **GIVEN** `core-events` is disabled
- **WHEN** an API consumer calls `/api/events`
- **THEN** the response SHALL be `404 Not Found` with body: `{ "error": "Events module is not enabled", "code": 404 }`
- **AND** it SHALL NOT return `500` or leak internal module state

#### Scenario: Dependent module graceful degradation
- **GIVEN** `event-speakers` is enabled but `core-events` enters `'error'` state
- **WHEN** the system detects the inconsistency
- **THEN** it SHALL log a warning about the orphaned dependent module
- **AND** `event-speakers` API routes and UI SHALL gracefully degrade (show error state, not crash)

#### Scenario: Migration failure during module enable
- **GIVEN** the `core-events` module migration fails (e.g., table already exists with different schema)
- **WHEN** the admin attempts to enable the module
- **THEN** the migration SHALL be rolled back
- **AND** the module status SHALL be set to `'error'`
- **AND** the admin SHALL see a descriptive error message with the SQL error
- **AND** core platform functionality SHALL be unaffected

---

### Requirement: Performance

Module extraction SHALL not introduce measurable performance regressions.

#### Scenario: Module status check is cached
- **GIVEN** the API server needs to check whether `core-events` is enabled on each request
- **WHEN** a request arrives at an event endpoint
- **THEN** the module status SHALL be checked from an in-memory cache (not a per-request DB query)
- **AND** the cache SHALL be invalidated when module status changes (via reconcile or enable/disable)
- **AND** the overhead of the module status check SHALL be less than 1ms per request

#### Scenario: Portal mode detection is cached
- **GIVEN** the portal middleware checks the `core-events` module status
- **WHEN** a request reaches the portal
- **THEN** the mode (event vs community) SHALL be determined from a cached value
- **AND** the cache TTL SHALL be configurable (default: 60 seconds)
- **AND** mode changes SHALL take effect within one cache TTL period

#### Scenario: Admin bundle size
- **GIVEN** `core-events` admin pages are lazy-loaded from the module
- **WHEN** a user loads the admin app without navigating to events
- **THEN** the event admin code SHALL NOT be included in the initial bundle
- **AND** it SHALL only be loaded when the user navigates to `/admin/events`

#### Scenario: API response time targets
- **GIVEN** event API routes are conditionally mounted via the module system
- **WHEN** a request reaches a mounted event endpoint
- **THEN** the response time SHALL not exceed the current baseline by more than 10ms (p95)
- **AND** the module status check overhead SHALL be less than 1ms
- **AND** conditional route mounting at startup SHALL add less than 500ms to server boot time

---

### Requirement: Observability

Module lifecycle events SHALL be logged with structured data for operational visibility.

#### Scenario: Module state change logging
- **GIVEN** any module state transition (enable, disable, install, uninstall, error)
- **WHEN** the transition occurs
- **THEN** the system SHALL log at INFO level: `{ module_id, from_status, to_status, triggered_by, timestamp }`
- **AND** errors SHALL be logged at ERROR level with full stack trace

#### Scenario: Conditional route mounting logged
- **GIVEN** the API server conditionally mounts or skips event routes
- **WHEN** the server starts
- **THEN** it SHALL log which module routes were mounted and which were skipped
- **AND** the log SHALL include the module ID and route paths

---

## 7. Implementation Plan

### Phase 1: Module Shell & Feature Flags (Non-Breaking)

1. Create `modules/core-events/` directory with `GatewazeModule` definition
2. Add `features: ['events']` to the module
3. Add `dependencies: ['core-events']` to all event sub-modules
4. Ensure existing `requiredFeature: 'events'` guards work with module-provided features
5. Auto-install `core-events` as `enabled` for all existing deployments via core migration

**Validation**: All existing functionality works identically. This is a no-op change.

### Phase 2: Extract API Routes

1. Copy event route handlers into `modules/core-events/api/`
2. Update `server.ts` to conditionally mount routes based on module status
3. Keep route handler logic unchanged — this is a pure relocation
4. Retain original path structure (`/api/events`, not `/api/m/core-events/events`)
5. Add integration tests for route availability based on module status

**Validation**: API tests pass. Disabling module returns 404 for event endpoints.

### Phase 3: Extract Admin UI

1. Move event admin pages into `modules/core-events/admin/`
2. Register pages via `adminRoutes` and `adminNavItems` in the module definition
3. Remove hardcoded events entries from `dashboards.ts` and `protected.tsx`
4. Move event admin services into the module
5. Verify the Vite plugin resolves module admin components correctly

**Validation**: Admin UI works with module enabled. Disabling module hides all event UI.

### Phase 4: Portal Refactoring

1. Add portal mode detection based on module status
2. Create community-mode portal routing (serves people/community pages)
3. Guard event-specific middleware logic behind module check
4. Update sitemap generation to be conditional
5. Handle custom domain resolution for non-event portals

**Validation**: Portal works in both modes. No broken routes in either mode.

### Phase 5: Database Migration Transfer

1. Create core migration `00018_transfer_events_to_module.sql`
2. For existing installs: auto-register `core-events` as installed, mark migration as applied
3. For new installs: event tables created only when `core-events` is installed
4. Gate `00004_events.sql` behind a check (skip if tables already exist or if module will manage them)
5. Test fresh install without events, fresh install with events, upgrade from existing

**Validation**: Fresh installs work with and without events. Upgrades are seamless.

### Phase 6: Testing & Validation

**Unit tests:**
- Module loader correctly discovers and validates `core-events`
- Feature flag resolution includes/excludes `'events'` based on module status
- Permission RPC function respects module enable state
- Portal mode detection returns correct mode based on module status

**Integration tests:**
- Full module lifecycle: install → enable → disable → re-enable → uninstall
- API route availability: all event endpoints return 200 when enabled, 404 when disabled
- Database migration: fresh install creates tables on enable, upgrade transfers ownership
- Dependent module cascade: disabling `core-events` blocks or cascades sub-modules
- Permission grants: event permissions grantable when enabled, inactive when disabled

**End-to-end tests:**
- Admin UI: events navigation and pages appear/disappear based on module state
- Portal event mode: event pages, registration, check-in all functional
- Portal community mode: no event routes, community content served
- Upgrade path: existing deployment upgrades without data loss or downtime

**Performance tests:**
- Measure API response time delta between direct mounting and conditional mounting
- Measure admin app initial load time with and without events module
- Measure portal middleware latency with cached module status check

### Deployment & Rollback Strategy

**Deployment**: Each phase SHALL be deployable independently. Phases 1-2 are backend-only. Phase 3 requires an admin app rebuild. Phase 4 requires a portal rebuild. Phase 5 is a database migration.

**Rollback per phase:**
- **Phase 1**: Revert the core migration that auto-installs `core-events`. Module system ignores unknown entries.
- **Phase 2**: Re-add unconditional route mounting in `server.ts`. Module routes are a superset of the old routes.
- **Phase 3**: Re-add hardcoded admin routes/nav in `protected.tsx` and `dashboards.ts`. Rebuild admin app.
- **Phase 4**: Re-enable old portal middleware logic via feature flag. Rebuild portal.
- **Phase 5**: No rollback needed — the migration only inserts metadata rows. Event tables are never dropped during the extraction.

**Zero-downtime**: The auto-install migration (Phase 1) ensures existing deployments get `core-events` as `enabled` before any code changes. This means the conditional checks in Phases 2-4 will always evaluate to `true` on upgrade, making the behavior identical to the pre-extraction state.

---

## 8. Risks and Mitigations

### Risk: Portal refactoring breaks custom domain routing
- **Impact**: High
- **Likelihood**: Medium
- **Mitigation**: Feature flag to toggle new portal behavior during rollout. Keep old portal logic as fallback until community mode is validated.

### Risk: Existing deployments don't get auto-install migration
- **Impact**: High
- **Likelihood**: Low
- **Mitigation**: Migration runs idempotently with `ON CONFLICT DO NOTHING`. Manual fix script available. Migration is part of the core migration sequence so it runs on every upgrade.

### Risk: Event sub-modules don't properly declare dependency
- **Impact**: Medium
- **Likelihood**: Low
- **Mitigation**: CI check validates module dependency declarations. Module loader checks at runtime.

### Risk: Admin Vite plugin doesn't handle module-provided routes/nav
- **Impact**: Medium
- **Likelihood**: Medium
- **Mitigation**: The existing module system already supports `adminRoutes` and `adminNavItems`. Test early in Phase 3.

### Risk: Data loss from accidental module uninstall
- **Impact**: High
- **Likelihood**: Low
- **Mitigation**: Uninstall requires explicit confirmation with data loss warning. Disable (default action) preserves all data.

### Risk: API consumer breakage from path changes
- **Impact**: High
- **Likelihood**: Low (mitigated by design)
- **Mitigation**: Event API routes retain their existing paths (`/api/events`, not `/api/m/core-events/events`).

---

## 9. Success Criteria

1. A fresh Gatewaze install without `core-events` has zero event-related UI, routes, or database tables
2. Installing `core-events` on a clean instance creates all event infrastructure and enables full functionality
3. Disabling `core-events` on an existing instance hides all event UI/routes but preserves data
4. Re-enabling `core-events` restores full functionality with no data loss
5. All existing event sub-modules work unchanged when `core-events` is enabled
6. Upgrading an existing deployment auto-enables `core-events` with no user action required
7. The portal serves appropriate content in both event and community modes
8. No API path changes — existing consumers are unaffected

---

## 10. Open Questions

1. **Portal community mode scope**: What pages/features should the portal show when events are disabled? Just a landing page, or a full people directory?
2. **CSV endpoints**: Should CSV import/export be part of `core-events` or remain in core (for people-only CSV operations)?
3. **Calendar module junction**: The `calendars` module creates a `calendars_events` junction table. Should this junction be owned by `core-events`, `calendars`, or a bridge module?
4. **Notification service**: Some notifications are event-specific (registration confirmations). Should the notification service split into core and event-specific parts?
5. **Default state**: Should new installations include `core-events` as enabled by default (opt-out) or not installed by default (opt-in)?
