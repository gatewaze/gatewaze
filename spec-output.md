# Technical Specification: Events Module Restructure & Edge Function Migration

## Overview / Context

Gatewaze is a modular community platform where features are delivered as optional modules. The Events feature was recently extracted from the core platform into optional modules, but the extraction is incomplete:

1. **Naming**: The base events module is currently called `core-events`, implying it's essential to Gatewaze. It should be renamed to `events` since it's entirely optional.
2. **Edge Functions**: 15 event-related Deno edge functions still live in the core `supabase/functions/` directory instead of being owned by their respective modules.
3. **Submodule ownership**: The submodule definitions (`event-speakers`, `luma-integration`, etc.) already declare their `edgeFunctions` arrays and have `functions/` directories — but the actual source code is duplicated in the core repo.

### Current State

- **Base module**: `core-events` — needs rename to `events`
- **Existing submodules** (already defined in `gatewaze-modules`):
  - `event-speakers` — declares 6 edge functions, has `functions/` directory with source code
  - `event-sponsors` — no edge functions
  - `event-agenda` — no edge functions, depends on `event-speakers`
  - `event-topics` — no edge functions
  - `event-interest` — no edge functions
  - `event-invites` — no edge functions
  - `event-media` — no edge functions
  - `luma-integration` — declares 4 edge functions, has `functions/` directory with source code
- **Problem**: All 15 event edge functions are hardcoded in `supabase/functions/` and statically imported in `platform-main/index.ts`, regardless of which modules are installed
- **Deploy infrastructure**: `deployEdgeFunctions()` and `regeneratePlatformMain()` already support dynamic edge function deployment from modules

### Module Dependency Graph

All event feature modules depend on the `events` base module. This ensures the core event tables and edge functions are present before any submodule is enabled.

```
events (base)
├── event-sponsors (depends on events)
│   └── event-speakers (depends on events, event-sponsors)
│       └── event-agenda (depends on events, event-speakers)
├── event-topics (depends on events)
├── event-interest (depends on events)
├── event-invites (depends on events)
├── event-media (depends on events)
└── luma-integration (depends on events, type: integration)
```

**Modules needing dependency updates:**

| Module | Current `dependencies` | New `dependencies` |
|--------|----------------------|-------------------|
| `event-sponsors` | `[]` | `['events']` |
| `event-speakers` | `['event-sponsors']` | `['events', 'event-sponsors']` |
| `event-agenda` | `['event-speakers']` | `['events', 'event-speakers']` |
| `event-topics` | `[]` | `['events']` |
| `event-interest` | `[]` | `['events']` |
| `event-invites` | `[]` | `['events']` |
| `event-media` | `[]` | `['events']` |
| `luma-integration` | `[]` | `['events']` |

### Related Systems

- `platform-main/index.ts` — Auto-generated Deno router that dispatches to individual edge functions
- `regeneratePlatformMain()` — Merges existing core function imports with module function imports
- `deployEdgeFunctions()` — Copies module edge functions to `supabase/functions/` and regenerates the router
- Admin Vite plugin — Generates `virtual:gatewaze-modules` for admin build
- Portal `enabledModules.ts` — Server-side module state cache for Next.js

## Goals and Non-Goals

### Goals

1. **Rename `core-events` to `events`** — Update module ID, directory name, all references in code and database
2. **Distribute edge functions to their owning modules** — Each submodule owns its own edge functions, core `events` module owns the base functions
3. **Remove all event edge functions from `supabase/functions/`** — They should only appear when their respective modules are installed and enabled
4. **Remove event function imports from `platform-main/index.ts`** — They get added dynamically by `deployEdgeFunctions()` when modules are enabled
5. **Ensure each module is independently installable** — Installing `event-speakers` deploys speaker functions; installing `luma-integration` deploys luma functions; neither requires the other

### Non-Goals

- Moving non-event edge functions (people-*, email-*, admin-*, platform-*)
- Changing the edge function runtime or deployment mechanism
- Adding new features to any module
- Creating new submodules (the existing ones cover current functionality)

## System Architecture

### Edge Function Ownership Map

```
MODULE: events (base)
  Edge functions:
    events/                        ← core event CRUD
    events-registration/           ← event registration
    events-search/                 ← event search
    events-generate-matches/       ← networking/matching
    events-send-match-emails/      ← match notification emails

MODULE: event-speakers (already defined in gatewaze-modules)
  Edge functions (already declared in module config):
    events-speaker-confirm/
    events-speaker-submission/
    events-speaker-submissions/
    events-speaker-tracking-link/
    events-speaker-update/
    events-speaker-update-notify/

MODULE: luma-integration (already defined in gatewaze-modules)
  Edge functions (already declared in module config):
    integrations-luma-issue-discount/
    integrations-luma-process-csv/
    integrations-luma-process-registration/
    integrations-luma-webhook/

CORE (supabase/functions/ — always present):
    _shared/
    admin-add-first/
    admin-nl-query/
    admin-send-magic-link/
    email-generate-encoded/
    email-send/
    email-send-push/
    email-send-reminders/
    email-sendgrid-webhook/
    people-classify-job-titles/
    people-enrichment/
    people-normalize-location/
    people-profile-update/
    people-signup/
    people-track-attribute/
    people-track-subscription/
    people-validate-linkedin/
    platform-generate-download-token/
    platform-generate-embeddings/
    platform-main/
    platform-setup/
```

### Edge Function Lifecycle (Per Module)

1. Admin installs/enables a module (e.g., `event-speakers`) via admin UI
2. API server calls `deployEdgeFunctions()` which:
   a. Reads `edgeFunctions` array from the module config
   b. Copies each function directory from the module's `functions/` to `supabase/functions/`
   c. Copies module's `functions/_shared/` contents if present (additive)
   d. Calls `regeneratePlatformMain()` to add imports for the new functions
   e. Optionally deploys to Supabase cloud via CLI
   f. Restarts the edge runtime container
3. Each module's functions are deployed independently — enabling `event-speakers` only deploys speaker functions

### `platform-main/index.ts` Generation

After migration, `platform-main/index.ts` will be generated in two layers:

1. **Core functions** — Always present (admin-*, email-*, people-*, platform-*)
2. **Module functions** — Added by `regeneratePlatformMain()` as each module is enabled

The existing `regeneratePlatformMain()` implementation already handles this — it preserves existing imports and merges new ones.

**Important limitations:**
- `regeneratePlatformMain()` currently only **adds** imports — disabling a module does not remove its edge functions from the router. A future `undeployEdgeFunctions()` function is needed.
- On a **fresh clone**, `platform-main/index.ts` ships with only core function imports. Module functions are added on top when modules are enabled.

## Component Design

### 1. Module Rename: `core-events` → `events`

#### References to update

| Location | Change |
|----------|--------|
| Module `index.ts` | Change `id: 'core-events'` to `id: 'events'` |
| `packages/portal/lib/modules/enabledModules.ts` | Change `enabledIds.has('core-events')` to `enabledIds.has('events')` |
| `packages/portal/app/(main)/events/layout.tsx` | Change `modules.enabledIds.has('core-events')` to `modules.enabledIds.has('events')` |
| `packages/admin/src/app/pages/people/detail.tsx` | Change `useHasModule('core-events')` to `useHasModule('events')` |
| `supabase/migrations/00006_rls_policies.sql` | Comments referencing `core-events` module |
| `installed_modules` DB row | Update `id` from `core-events` to `events` |
| `module_migrations` DB rows | Update `module_id` from `core-events` to `events` |
| Submodule `dependencies` arrays | If any reference `core-events`, update to `events` |

### 2. Edge Function Migration — Base `events` Module

The base `events` module needs a `functions/` directory with the 5 core event functions.

#### Create `events/functions/` directory:
```
events/functions/
  events/index.ts
  events-registration/index.ts
  events-search/index.ts
  events-generate-matches/index.ts
  events-send-match-emails/index.ts
```

#### Update module config:
```typescript
const module: GatewazeModule = {
  id: 'events',
  name: 'Events',
  edgeFunctions: [
    'events',
    'events-registration',
    'events-search',
    'events-generate-matches',
    'events-send-match-emails',
  ],
  // ...
}
```

#### Source: Move from `supabase/functions/`
- Move (not copy) each function directory from `supabase/functions/` to the module's `functions/` directory
- Delete the originals from `supabase/functions/`
- These functions only exist at `supabase/functions/` after `deployEdgeFunctions()` copies them

### 3. Edge Function Migration — `event-speakers` Module

Already properly configured:
- `edgeFunctions` array lists all 6 speaker functions
- `functions/` directory exists with source code

**Action needed**: Verify the source in `event-speakers/functions/` matches the current code in `supabase/functions/`. The 4 functions fixed in this session (converted from `serve()`/`Deno.serve()` to `export default`) need those fixes applied to the module's copy too.

Functions to verify/sync:
- `events-speaker-confirm` — was fixed (removed `serve()`, added `export default`)
- `events-speaker-submissions` — was fixed (removed `Deno.serve()`, added `export default`)
- `events-speaker-tracking-link` — was fixed (removed `Deno.serve()`, added `export default`)
- `events-speaker-update-notify` — was fixed (removed `serve()`, added `export default`)
- `events-speaker-submission` — verify has `export default`
- `events-speaker-update` — verify has `export default`

### 4. Edge Function Migration — `luma-integration` Module

Already properly configured:
- `edgeFunctions` array lists all 4 luma functions
- `functions/` directory exists with source code (including `_shared/lumaRegistration.ts`)

**Action needed**: Verify the source in `luma-integration/functions/` matches the current code in `supabase/functions/`. Ensure all functions use `export default async function(req: Request)` pattern.

### 5. Remove Event Functions from Core

After confirming module copies are correct:

1. **Delete from `supabase/functions/`**:
   - `events/`
   - `events-registration/`
   - `events-search/`
   - `events-generate-matches/`
   - `events-send-match-emails/`
   - `events-speaker-confirm/`
   - `events-speaker-submission/`
   - `events-speaker-submissions/`
   - `events-speaker-tracking-link/`
   - `events-speaker-update/`
   - `events-speaker-update-notify/`
   - `integrations-luma-issue-discount/`
   - `integrations-luma-process-csv/`
   - `integrations-luma-process-registration/`
   - `integrations-luma-webhook/`

2. **Update `platform-main/index.ts`**: Remove all event/luma function imports. Only core functions remain in the seed version.

### 6. Shared Code Audit (`_shared/`)

| Module | Classification | Used By |
|--------|---------------|---------|
| `integrationEvents.ts` | **SHARED** | Core: people-signup, people-track-attribute, people-track-subscription, people-enrichment. Events: events-registration |
| `email.ts` | **CORE-ONLY** | admin-add-first, admin-send-magic-link, people-signup |
| `cors.ts` | **CORE-ONLY** | admin-add-first, admin-send-magic-link, platform-setup |
| `supabase.ts` | **CORE-ONLY** | admin-add-first, admin-send-magic-link, platform-setup |
| `lumaRegistration.ts` | **EVENTS-ONLY** | integrations-luma-* functions |
| `customerio.ts` | **UNUSED** | No current imports (deprecated) |
| `imageProcessor.ts` | **UNUSED** | No current imports |

**Actions:**
- **Keep in core `_shared/`**: `integrationEvents.ts`, `email.ts`, `cors.ts`, `supabase.ts`
- **Already in module**: `lumaRegistration.ts` is already in `luma-integration/functions/_shared/`
- **Delete from core**: `customerio.ts`, `imageProcessor.ts` — unused
- **Note**: Event functions create Supabase clients inline rather than using the shared `supabase.ts`, so no import path changes needed
- **Note**: `deployEdgeFunctions()` copies module `_shared/` additively into the platform `_shared/` — no collision risk as long as filenames don't overlap

### 7. Database Migration

```sql
-- Migration: rename core-events to events
BEGIN;

UPDATE public.module_migrations
SET module_id = 'events'
WHERE module_id = 'core-events';

UPDATE public.installed_modules
SET id = 'events'
WHERE id = 'core-events';

COMMIT;
```

**Alternative for local dev**: Delete old rows and let reconciliation recreate:
```sql
DELETE FROM public.module_migrations WHERE module_id = 'core-events';
DELETE FROM public.installed_modules WHERE id = 'core-events';
```
Then re-enable through admin UI.

## API Design

No new API endpoints. Existing module management endpoints work as-is — they're generic and operate on module IDs.

### Module enable flow (example: enabling `event-speakers`)

1. `POST /api/modules/event-speakers/enable`
2. Server loads `event-speakers` module config
3. Checks dependencies: `events` and `event-sponsors` must be enabled first
4. Runs migrations from `event-speakers/migrations/`
5. Calls `deployEdgeFunctions()` — copies 6 speaker functions to `supabase/functions/`
6. Regenerates `platform-main/index.ts` with speaker function imports
7. Updates `installed_modules` status to `enabled`

### Edge function endpoints (unchanged paths)

All edge functions maintain their existing paths under `/functions/v1/`:
- `POST /functions/v1/events-registration`
- `GET /functions/v1/events-speaker-confirm?token=...`
- etc.

## Data Models / Database Schema

No schema changes. The only data change is the module ID rename in `installed_modules` and `module_migrations`.

## Infrastructure Requirements

No new infrastructure. The existing Docker setup (Supabase + edge runtime) is unchanged.

The edge runtime container mounts `supabase/functions/` from the host. After `deployEdgeFunctions()` copies module functions into this directory, the container picks them up on restart.

## Security Considerations

- **No change to auth model** — Edge functions continue to use service role keys and user JWTs
- **Module deployment** — Only admin users can enable/disable modules
- **Edge function access** — Functions are only routable when registered in `platform-main/index.ts`
- **Post-move verification** — After moving edge functions, verify that relative import paths (e.g., `../_shared/integrationEvents.ts`) resolve correctly from `supabase/functions/` (where they're copied to at deploy time)

## Error Handling Strategy

### Module enable fails to deploy edge functions
- `deployEdgeFunctions()` already logs errors and continues
- Module status should remain `enabled` even if edge function deploy fails
- Admin UI should surface deployment errors

### Missing dependency
- If `event-speakers` is enabled without `event-sponsors`, the dependency check should prevent it
- The topological sort in lifecycle.ts already handles this

### Stale `platform-main/index.ts`
- `POST /api/modules/reconcile` regenerates it
- Container restart picks up changes

## Performance Requirements / SLAs

No change. Edge functions have the same cold-start and execution characteristics regardless of where their source files are stored.

## Observability

- `deployEdgeFunctions()` logs each function it copies
- `regeneratePlatformMain()` logs the final function list
- `platform-main` logs 404s for unknown function routes
- Each edge function has its own console logging

## Testing Strategy

### Manual testing checklist

1. **Fresh install (no event modules)**
   - [ ] `supabase/functions/` contains only core functions
   - [ ] `platform-main/index.ts` only imports core functions
   - [ ] Portal shows no events nav
   - [ ] No errors in API or edge function logs

2. **Enable base `events` module**
   - [ ] 5 core event functions copied to `supabase/functions/`
   - [ ] `platform-main/index.ts` regenerated with event function imports
   - [ ] Event pages work in portal
   - [ ] `/functions/v1/events-registration` responds

3. **Enable `event-speakers` module (requires `event-sponsors`)**
   - [ ] Enable `event-sponsors` first (no edge functions to deploy)
   - [ ] Enable `event-speakers` — 6 speaker functions deployed
   - [ ] `/functions/v1/events-speaker-confirm?token=...` responds
   - [ ] Speaker admin tab appears in event detail

4. **Enable `luma-integration` module**
   - [ ] 4 luma functions deployed independently
   - [ ] Luma admin slots appear

5. **Disable `event-speakers`**
   - [ ] Speaker admin tab hidden
   - [ ] Speaker functions may still be on disk (known limitation)

6. **Module rename verification**
   - [ ] `installed_modules` shows `id = 'events'`, not `core-events`
   - [ ] `useHasModule('events')` returns true when enabled
   - [ ] `enabledIds.has('events')` works in portal

## Deployment Strategy

Since this is a local-only installation:

1. Stop all services
2. Rename the module directory and update module ID
3. Update all code references (`core-events` → `events`)
4. Move core event edge functions to `events/functions/`
5. Sync speaker and luma function source code to match recent fixes
6. Remove all event/luma functions from `supabase/functions/`
7. Update `platform-main/index.ts` to only contain core imports
8. Clear old database rows
9. Start services
10. Run reconciliation to re-register all modules
11. Enable modules through admin UI: events → event-sponsors → event-speakers → luma-integration
12. Verify all edge functions deploy correctly

### Rollback

If something breaks:
1. Revert code changes via git
2. Re-register modules through reconciliation

## Migration Plan

### Phase 1: Rename (Low Risk)
1. Rename base events module from `core-events` to `events`
2. Update `id` in module config
3. Update all code references (`useHasModule`, `enabledIds.has`, etc.)
4. Clean up old DB rows, re-reconcile

### Phase 2: Move Core Event Edge Functions (Medium Risk)
1. Create `events/functions/` directory with 5 base functions
2. Verify all functions use `export default` pattern
3. Add `edgeFunctions` array to base `events` module config
4. Remove these functions from `supabase/functions/`

### Phase 3: Sync Submodule Edge Functions (Medium Risk)
1. Verify `event-speakers/functions/` matches fixed source code (4 functions were patched)
2. Verify `luma-integration/functions/` has correct source
3. Ensure all submodule functions use `export default` pattern
4. Remove speaker and luma functions from `supabase/functions/`

### Phase 4: Clean Up Core
1. Remove all event/luma function imports from `platform-main/index.ts`
2. Delete unused `_shared/` modules (`customerio.ts`, `imageProcessor.ts`)
3. Verify `platform-main/index.ts` only has core function imports
4. Restart edge runtime and verify no errors

## Open Questions / Future Considerations

1. **Should disabling a module remove its edge functions?**
   - Currently it doesn't — `regeneratePlatformMain()` only adds, not removes
   - Low risk: functions fail gracefully if their tables don't exist

2. **(Resolved) All event submodules now depend on `events` base module**
   - Enforces correct install order
   - Ensures core event tables exist before submodule migrations run

3. **How should `_shared/` code work across modules?**
   - `deployEdgeFunctions()` copies `_shared/` additively
   - Need to ensure no naming collisions between module shared code and core shared code
   - Consider namespacing: `_shared/events/` vs `_shared/core/`

4. **Adding new event submodules in the future**
   - New modules (e.g., `event-networking`) just need an `index.ts` with `edgeFunctions` array and a `functions/` directory
   - They declare `dependencies: ['events']` and are independently installable
   - No changes to core required — the module system handles discovery and deployment
