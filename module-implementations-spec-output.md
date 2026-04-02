# Module Implementations Analysis

This specification defines the quality standards, conformance requirements, and identified issues across all 45 Gatewaze module implementations spanning three repositories: `gatewaze-modules` (26 modules), `premium-gatewaze-modules` (14 modules), and `lf-gatewaze-modules` (5 modules).

---

## Requirement: Module Contract Conformance

Every module MUST fully conform to the `GatewazeModule` contract defined in `packages/shared/src/types/modules.ts`. All required fields (`id`, `name`, `description`, `version`, `features`) MUST be present. All modules MUST declare `visibility` and SHOULD implement lifecycle hooks (`onInstall`, `onEnable`, `onDisable`).

### Current State: 41/45 Conformant (91%)

**Fully conformant modules (41):**
- gatewaze-modules: event-interest, calendars, event-agenda, badge-scanning, forms, event-speakers, environments, event-topics, compliance, blog, event-invites, event-sponsors, event-media, google-sheets, scrapers, bulk-emailing, luma-integration, slack-integration, people-enrichment, scheduler, people-warehouse
- premium-gatewaze-modules: accounts, cohorts, competitions, discounts, event-budget, event-reports, event-tracking, gradual-integration, newsletters, offers, redirects, segments, surveys, customerio
- lf-gatewaze-modules: content-discovery, content-pipeline, lf-theme, lfid-auth, podcasts

**Non-conformant modules (4):**

| Module | Repo | Issues |
|--------|------|--------|
| ad-conversions | gatewaze-modules | Missing `visibility`, missing `configSchema`, missing lifecycle hooks, wrong import path |
| cvent-integration | gatewaze-modules | Missing `visibility`, missing `configSchema`, missing lifecycle hooks, wrong import path |
| bigquery-integration | gatewaze-modules | Missing `visibility`, missing `configSchema`, missing lifecycle hooks, wrong import path |
| stripe-payments | gatewaze-modules | Missing lifecycle hooks (onInstall, onEnable, onDisable) |

### Scenario: Fix non-conformant modules
- **GIVEN** the 4 non-conformant modules listed above
- **WHEN** a developer updates them to match the contract
- **THEN** each module SHALL have all required fields (`id`, `name`, `description`, `version`, `features`)
- **AND** each SHALL declare `visibility` ('public' | 'hidden' | 'premium')
- **AND** each SHALL implement `onInstall`, `onEnable`, and `onDisable` hooks
- **AND** each SHALL use the standard import path `@gatewaze/shared` (not `@gatewaze/shared/modules`)

---

## Requirement: Import Path Consistency

All modules MUST use the standard import path `import type { GatewazeModule } from '@gatewaze/shared'`. The non-standard path `@gatewaze/shared/modules` MUST NOT be used.

### Current State: 3 modules use wrong import path

| Module | Current Import | Required Import |
|--------|---------------|-----------------|
| ad-conversions | `@gatewaze/shared/modules` | `@gatewaze/shared` |
| cvent-integration | `@gatewaze/shared/modules` | `@gatewaze/shared` |
| bigquery-integration | `@gatewaze/shared/modules` | `@gatewaze/shared` |

---

## Requirement: Lifecycle Hook Implementation Quality

All lifecycle hooks MUST perform meaningful operations beyond console logging. At minimum, `onEnable` SHOULD set `portal_nav` if the module declares `portalNav`, and `onDisable` SHOULD clean up any runtime state.

### Current State: Most hooks are console.log-only

Across all 45 modules, lifecycle hooks fall into these categories:

1. **Meaningful implementation** (5 modules): blog (sets portal_nav on enable), lfid-auth, content-discovery, environments, forms
2. **Console.log only** (36 modules): Log "Module installed/enabled/disabled" with no actual logic
3. **Missing entirely** (4 modules): ad-conversions, cvent-integration, bigquery-integration, stripe-payments

### Scenario: Lifecycle hooks should set portal_nav
- **GIVEN** a module that declares `portalNav` in its definition
- **WHEN** the module's `onEnable` hook runs
- **THEN** it SHOULD upsert the `portal_nav` field in `installed_modules`
- **AND** `onDisable` SHOULD clear the `portal_nav` field

---

## Requirement: Feature Namespace Consistency

Feature flags MUST use a consistent naming convention. All features for a module SHOULD be prefixed with the module ID using dot notation (e.g., `module-id.feature`).

### Current State: Inconsistent naming

**Correct pattern** (most modules):
- `calendars`, `calendars.discover`, `calendars.import`
- `blog`, `blog.posts`, `blog.categories`

**Inconsistent patterns:**
- `people_warehouse` uses underscores instead of hyphens (module ID uses hyphens elsewhere)
- `people_enrichment` uses underscores instead of hyphens
- `payments` (stripe-payments) — root feature doesn't match module ID
- `gradual.sync`, `gradual.webhooks` — namespace doesn't match module ID `gradual-integration`
- `cvent`, `cvent.sync` — namespace doesn't match module ID `cvent-integration`
- `bigquery`, `bigquery.proxy` — namespace doesn't match module ID `bigquery-integration`
- `customerio`, `customerio.sync` — no prefix mismatch but underscore in people_warehouse references it

---

## Requirement: Configuration Schema Completeness

Modules that require external API credentials MUST declare them in `configSchema` with appropriate types (`'secret'` for API keys/tokens). Modules that don't require configuration SHOULD still declare an empty `configSchema: {}`.

### Current State: Mixed compliance

**Properly configured (10 modules with configSchema):**
- stripe-payments: 3 fields (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY)
- people-warehouse: 6 fields (CUSTOMERIO credentials + booleans)
- people-enrichment: 4 fields (CLEARBIT/ENRICHLAYER keys)
- google-sheets: 3 fields (OAuth credentials)
- bulk-emailing: 3 fields (SENDGRID key + from address)
- slack-integration: 3 fields (Slack credentials)
- luma-integration: 2 fields (LUMA_API_KEY + webhook secret)
- gradual-integration: 2 fields (client ID + bearer token)
- redirects: 2 fields (Short.io credentials)
- lfid-auth: 9 fields (Auth0 credentials)
- content-pipeline: 3 fields (OpenAI key + model + retries)
- content-discovery: 4 fields (Helix agent keys)

**Missing configSchema entirely (3 modules):**
- ad-conversions (likely needs Meta/Reddit API keys)
- cvent-integration (likely needs Cvent API credentials)
- bigquery-integration (likely needs GCP credentials)

---

## Requirement: Dependency Declaration Accuracy

Module `dependencies` MUST reference valid module IDs that exist in the module ecosystem. Dependencies on external services MUST NOT be declared as module dependencies.

### Current State: 1 invalid dependency

| Module | Declared Dependency | Issue |
|--------|-------------------|-------|
| people-warehouse | `customerio` | References `customerio` module which exists in premium-gatewaze-modules, NOT in gatewaze-modules. Cross-repo dependency. |

**Valid dependency chains:**
- calendars → scrapers ✓
- event-agenda → event-speakers ✓
- event-invites → calendars ✓
- event-media → event-sponsors ✓
- event-speakers → event-sponsors ✓
- competitions → event-sponsors, discounts ✓
- content-discovery → content-pipeline ✓

### Scenario: Cross-repo dependencies
- **GIVEN** a module in repo A declares a dependency on a module in repo B
- **WHEN** both repos are configured as module sources
- **THEN** the dependency SHALL be satisfiable at runtime
- **AND** the dependency resolution SHALL work across source boundaries

---

## Requirement: Migration Naming Convention

Migration filenames MUST follow the pattern `NNN_descriptive_name.sql` where NNN is a zero-padded sequence number. Modules with multiple migrations MUST use sequential numbering starting from `000` or `001`.

### Current State: Mostly compliant

**Total migrations: 32 files across all repos**

**Correct pattern:**
- `001_event_interest_tables.sql`
- `000_badge_scanning_tables.sql`, `001_badge_scanning_event_columns.sql`, etc.
- `001_content_pipeline_tables.sql`, `002_seed_taxonomy.sql`, etc.

**Minor inconsistency:**
- badge-scanning starts at `000_` while most others start at `001_`
- discounts and event-budget use `000_` prefix for "core" tables
- No module uses `down` migrations for rollback

---

## Requirement: Admin Slot Registration Standards

Modules that extend the event detail page MUST register admin slots at `event-detail:tab` with a unique `tabId` in metadata, an appropriate `order` value, and `requiredFeature` set.

### Current State: 13 modules register event-detail:tab slots

| Module | Order | Tab ID | Repo |
|--------|-------|--------|------|
| event-agenda | 10 | (not set) | gatewaze-modules |
| event-speakers | 20 | (not set) | gatewaze-modules |
| event-sponsors | 30 | (not set) | gatewaze-modules |
| competitions | 40 | competitions | premium |
| discounts | 50 | discounts | premium |
| event-interest | 60 | (not set) | gatewaze-modules |
| luma-integration | 10 | (not set) | gatewaze-modules |
| competitions (matching) | 100 | matching | premium |
| event-reports | 110 | reports | premium |
| event-budget | 120 | budget | premium |
| bulk-emailing | 130 | (not set) | gatewaze-modules |
| event-media | 140 | (not set) | gatewaze-modules |
| event-tracking | 150 | tracking | premium |

**Issues:**
- Order value collision: luma-integration (10) and event-agenda (10) both use order 10
- Premium modules set `tabId` in meta; gatewaze-modules modules do NOT — inconsistent metadata
- No standard for slot order value ranges per repo

---

## Requirement: Portal Integration

Modules that provide public-facing features SHOULD declare `portalRoutes` and/or `portalNav` for portal integration. Portal pages MUST follow the `portal/pages/*.tsx` convention.

### Current State: Very limited portal usage

**Modules with portal pages (3):**
- blog: `/blog`, `/blog/:slug` + portalNav ✓
- forms: `/forms/:slug` (no portalNav)
- podcasts: `/podcasts/:slug/apply` (no portalNav)

**Modules with portal slots (1):**
- lfid-auth: `sign-in:providers` slot for both admin and portal ✓

**Modules that could benefit from portal integration but don't have it:**
- surveys (public survey submission)
- newsletters (public subscription)
- cohorts (enrollment pages)
- competitions (entry submission)

---

## Requirement: Edge Function Naming Convention

Edge function names MUST follow the pattern `<domain>-<action>` where domain groups related functions. Shared utilities MUST be placed in `_shared/` directories.

### Current State: 40+ edge functions, mostly consistent

**Naming patterns used:**
- `events-*` (7 functions): competition-entry, speaker-*, interest
- `integrations-*` (18 functions): stripe-*, luma-*, google-sheets-*, slack-*, customerio-*, cvent-*, bigquery-*, gradual-*
- `calendars-*` (3 functions): api, discover, process-csv
- `media-*` (6 functions): combine-chunks, process-image, upload-youtube, etc.
- `email-batch-send` (1 function)
- `people-enrichment` (1 function)
- `cohorts-*` (3 functions)

**Consistent ✓** — naming conventions are well-followed

---

## Requirement: API Route Registration Pattern

Modules that declare `apiRoutes` MUST use the Express route registration pattern via the `registerRoutes(app, context)` callback. Routes SHOULD be namespaced to avoid collisions.

### Current State: 4 modules use apiRoutes

| Module | Pattern | Namespacing |
|--------|---------|------------|
| forms | `registerRoutes(app, ctx)` | `/api/modules/forms/*` |
| environments | `registerRoutes(app, ctx)` | `/api/modules/environments/*` |
| scrapers | `registerRoutes(app, ctx)` | `/api/modules/scrapers/*` |
| podcasts | `registerRoutes(app, ctx)` | `/api/modules/podcasts/*` |

**Observation:** These modules use `/api/modules/<name>/` namespacing rather than the spec's proposed `/api/m/<id>/`. The existing pattern is more readable but longer.

---

## Requirement: Security Hardening

Module implementations MUST NOT contain hardcoded URLs, API keys, or credentials. CORS configuration MUST be explicit and restrictive.

### Current State: 2 issues found

1. **redirects module** (premium): `NeedsReviewTab.tsx` contains hardcoded fallback: `const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001'`
2. **podcasts module** (lf): API routes configure CORS with `origin: '*'` for guest application endpoint — overly permissive

---

## Inventory Summary

### By Repository

| Repo | Modules | Feature | Integration | Theme |
|------|---------|---------|-------------|-------|
| gatewaze-modules | 26 | 16 | 10 | 0 |
| premium-gatewaze-modules | 14 | 11 | 3 | 0 |
| lf-gatewaze-modules | 5 | 2 | 1 | 1 (+1 auth) |
| **Total** | **45** | **29** | **14** | **1** |

### Extension Points Used

| Extension Type | Count | Example |
|---------------|-------|---------|
| Admin Routes | 35 modules | `/admin/modules/*` |
| Admin Nav Items | 28 modules | Sidebar entries |
| Admin Slots (event-detail:tab) | 13 modules | Tab panels |
| Admin Slots (other) | 3 modules | sign-in:providers, registrations |
| Portal Pages | 3 modules | blog, forms, podcasts |
| Portal Nav | 1 module | blog |
| Portal Slots | 1 module | lfid-auth |
| API Routes | 4 modules | Express callbacks |
| Edge Functions | 18 modules | 40+ functions |
| Migrations | 30 modules | 32 SQL files |
| Config Schema | 12 modules | API credentials |

### Dependency Graph

```
scrapers ← calendars ← event-invites
event-sponsors ← event-speakers ← event-agenda
event-sponsors ← event-media
event-sponsors ← competitions → discounts
content-pipeline ← content-discovery
customerio (premium) ← people-warehouse (core)
```

---

## Requirement: Supabase Cloud Deployment Compatibility

All module migrations and edge functions MUST work identically whether targeting a local Supabase instance or a Supabase Cloud project. The system MUST support deploying to a blank Supabase Cloud instance as the initial setup target.

### Current State: Partial support

**Migrations:**
- Migrations execute via `exec_sql` RPC function which works in both local and cloud Supabase ✓
- However, `exec_sql` must be manually created on cloud instances (it's a custom RPC, not built-in)
- Some migrations use `pg_vector` extension (`content-pipeline`) which must be enabled in the cloud dashboard first
- No migration runner differentiates between local and cloud — this is correct behavior

**Edge Functions:**
- `deploy-edge-functions.ts` supports two deployment modes:
  1. **Local**: Copy files to `supabase/functions/` and restart Docker container
  2. **Cloud**: Run `supabase functions deploy` via CLI
- Cloud deployment requires `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` environment variables
- The `EDGE_FUNCTIONS_CONTAINER` env var determines local mode; its absence should trigger cloud mode
- `_shared/` directories are correctly copied alongside function code

**Issues to address:**

1. **exec_sql bootstrap**: A blank Supabase Cloud instance won't have the `exec_sql` RPC. The platform setup MUST include a bootstrap step that creates this function before any module migrations can run.
2. **Extension prerequisites**: Modules using `pg_vector` or other extensions MUST declare required extensions in their module definition so the platform can verify/enable them before running migrations.
3. **Edge function deployment authentication**: Cloud deployment requires Supabase CLI auth. The system SHOULD validate that credentials are configured before attempting cloud deployment and return a clear error if missing.
4. **Initial schema**: The core platform migrations (00001-00017) MUST be applied to the cloud instance before module migrations. The setup flow SHOULD handle this automatically.
5. **Environment detection**: The system SHOULD auto-detect whether it's targeting local or cloud Supabase based on the connection string or environment variables, rather than relying solely on `EDGE_FUNCTIONS_CONTAINER`.

### Scenario: Deploy to blank Supabase Cloud instance
- **GIVEN** a fresh Supabase Cloud project with no tables or functions
- **WHEN** the Gatewaze setup process runs targeting this instance
- **THEN** it SHALL apply core platform migrations (00001-00017) in order
- **AND** it SHALL create the `exec_sql` RPC function
- **AND** it SHALL enable required extensions (e.g., `pg_vector` if content-pipeline is selected)
- **AND** module migrations SHALL execute via the same `exec_sql` path as local
- **AND** edge functions SHALL deploy via `supabase functions deploy` (not Docker copy)

### Scenario: Module enable on Supabase Cloud
- **GIVEN** a running Gatewaze instance connected to Supabase Cloud
- **WHEN** an admin enables a module with migrations and edge functions
- **THEN** migrations SHALL execute via `exec_sql` RPC (same as local)
- **AND** edge functions SHALL deploy via Supabase CLI to the cloud project
- **AND** if CLI credentials are missing, the system SHALL return a descriptive error
- **AND** the function SHALL be immediately available at the cloud project's function URL

### Scenario: Extension prerequisite check
- **GIVEN** a module declares a migration that requires `pg_vector` extension
- **WHEN** the module is enabled
- **THEN** the system SHOULD check if the extension is available
- **AND** if not available, it SHALL return an error instructing the admin to enable the extension in the Supabase dashboard

---

## Open Questions

1. **Cross-repo dependencies**: people-warehouse depends on customerio which is in a different repo. Should cross-repo dependencies be formally supported or discouraged?
2. **Slot order standardization**: Should there be reserved order ranges per repo (e.g., core: 0-99, premium: 100-199)?
3. **Portal underutilization**: Many modules could benefit from portal pages but don't have them. Is this intentional?
4. **Config UI**: The configSchema is defined but no auto-generated UI exists. Is this a priority?
5. **Empty lifecycle hooks**: 36 modules have console.log-only hooks. Should hooks be optional rather than required-but-empty?
