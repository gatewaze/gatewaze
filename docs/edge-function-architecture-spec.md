# Technical Specification: Edge Function Deployment Architecture

## Overview / Context

Gatewaze is a modular platform where features are delivered as installable modules. Modules can include Supabase Edge Functions (Deno-based serverless handlers) that need to be deployed when the module is enabled.

The platform must support two fundamentally different deployment targets:

1. **Local development (Docker)** — A single `supabase/edge-runtime` container serves all functions via the `--main-service` pattern: a router function that dynamically spawns isolated Deno workers for each function directory.
2. **Supabase Cloud** — Each function is deployed as an independent Deno isolate via the Supabase Management API. Functions are live immediately after upload.

**Root cause of the current broken state:**
The official Supabase self-hosted main-service uses `Deno.serve()` and `EdgeRuntime.userWorkers.create({ servicePath })` to spawn isolated workers per request. Our `platform-main/index.ts` instead used `serve()` from `deno.land/std@0.177.0` (which binds to port 9999, not the runtime's port 9000) and tried to import all functions via `await import(...)` at module load time. This meant:
- The runtime's internal request dispatcher on port 9000 never received our handler — it returned `{"ok":true}` (its default health response).
- Functions using the legacy `serve()` pattern started competing HTTP servers when imported.
- The entire approach of "bundle all functions into one module" was architecturally wrong.

**Current problems (summary):**
- `platform-main` uses the wrong handler registration pattern — must use `Deno.serve()` + `EdgeRuntime.userWorkers.create()`.
- Module edge functions are copied into the core repo, blurring boundaries.
- No hot-deploy: adding new functions requires a container restart.

## Goals

1. **Fix local edge function routing** — Replace the broken `platform-main` with one that matches Supabase's official pattern using `Deno.serve()` and `EdgeRuntime.userWorkers.create()`.
2. **Hot-deploy module functions** — When a module is enabled, its edge functions become available without restarting the edge-runtime container.
3. **Clean separation** — Core functions live in the core repo; module functions live in module repos and are deployed dynamically at enable time.
4. **Unified handler pattern** — All functions use `export default handler` + `if (import.meta.main) Deno.serve(handler)`, compatible with both the worker model (local) and cloud deployment.
5. **No regression for cloud deployment** — The existing Supabase Cloud deployment via Management API continues to work unchanged.

## Non-Goals

- Kubernetes/shared-storage deployment (Phase 2, out of scope).
- Changing the Supabase Cloud deployment strategy (it works fine).
- Building a custom edge runtime or replacing Supabase's runtime.
- Per-function authentication/authorization beyond JWT verification in the main service.
- Implementing OpenTelemetry or advanced observability in Phase 1.

## System Architecture

### Current Architecture (Broken)

```
Browser → Traefik → Kong (/functions/v1/) → edge-runtime:9000
                                                   ↓
                                           --main-service mode
                                                   ↓
                                           platform-main/index.ts
                                           uses serve() from std → port 9999
                                           imports ALL functions at top level
                                           ↓ BROKEN: runtime answers {"ok":true} on port 9000
```

### Proposed Architecture: Dynamic Worker Spawning (Matches Official Supabase Pattern)

Keep `--main-service` but rewrite the main service to match the official Supabase self-hosted pattern. The main service is a lightweight router that:
1. Receives all requests via `Deno.serve()` (which the edge-runtime intercepts and routes to port 9000).
2. Extracts the function name from the URL path.
3. Spawns an isolated Deno worker for that function via `EdgeRuntime.userWorkers.create({ servicePath })`.
4. The worker loads the function from disk on demand — **no top-level imports needed**.

```
Browser → Traefik → Kong (/functions/v1/) → edge-runtime:9000
                                                   ↓
                                           --main-service (Deno.serve)
                                                   ↓
                                           Extract function name from URL path
                                                   ↓
                                           EdgeRuntime.userWorkers.create({
                                             servicePath: /home/deno/functions/<name>
                                           })
                                                   ↓
                                           Isolated Deno worker serves the request
```

**Key insight:** Because the main service loads functions from disk on-demand (not via imports), **new function directories are automatically available without restart**. The API server just needs to write files to the shared volume.

### Component Interaction

```
┌─────────────────────────────────────────────────────┐
│                    Admin UI                          │
│   (Enable Module → POST /api/modules/:id/enable)    │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────┴──────────────────────────────┐
│                   API Server                         │
│  1. Apply migrations                                 │
│  2. Deploy edge functions:                           │
│     Local: write files to shared Docker volume       │
│     Cloud: upload via Supabase Management API        │
│  3. No restart needed — workers load from disk       │
└──────────────────────┬──────────────────────────────┘
                       ↓ (local only)
┌──────────────────────┴──────────────────────────────┐
│           Shared Docker Volume                       │
│  /home/deno/functions/                               │
│    ├── main/              (router — the main service)│
│    ├── _shared/           (shared utilities)         │
│    ├── email-send/        (core function)            │
│    ├── events/            (module function, dynamic) │
│    ├── media-process-zip/ (module function, dynamic) │
│    └── newsletter-send/   (module function, dynamic) │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────┴──────────────────────────────┐
│         supabase/edge-runtime                        │
│  --main-service /home/deno/functions/main            │
│  - main/index.ts routes requests to workers          │
│  - Workers are created on-demand from disk           │
│  - New directories = new functions, no restart       │
└─────────────────────────────────────────────────────┘
```

## Component Design

### 1. New Main Service (`main/index.ts`)

Replace the broken `platform-main/index.ts` with a minimal router matching the official Supabase pattern:

```typescript
// /supabase/functions/main/index.ts
// Lightweight router — spawns isolated workers for each function.
// Based on the official Supabase self-hosted main service pattern.

const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true';
const JWT_SECRET = Deno.env.get('JWT_SECRET');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Optional JWT verification (disabled locally by default)
  if (VERIFY_JWT) {
    // ... JWT verification logic (same as official Supabase pattern)
  }

  // Extract and validate function name from URL path
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const serviceName = pathParts[0];

  if (!serviceName) {
    return new Response(
      JSON.stringify({ error: 'Missing function name in request' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // SECURITY: Validate serviceName to prevent path traversal attacks.
  // Only allow alphanumeric characters and hyphens.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(serviceName)) {
    return new Response(
      JSON.stringify({ error: 'Invalid function name' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Spawn an isolated worker for this function
  const servicePath = `/home/deno/functions/${serviceName}`;

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 256,
      workerTimeoutMs: 5 * 60 * 1000, // 5 minutes (for long-running tasks like zip processing)
      noModuleCache: false,
      importMapPath: null,
      envVars: Object.entries(Deno.env.toObject()),
    });
    return await worker.fetch(req);
  } catch (e) {
    console.error(`[main] Error serving ${serviceName}:`, e);
    // SECURITY: Do not leak internal error details to clients
    return new Response(
      JSON.stringify({ error: `Failed to execute function: ${serviceName}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

**Why this works:** `EdgeRuntime.userWorkers.create()` loads the function from disk each time (with module caching). New function directories are discovered automatically — no imports, no restart, no regeneration.

### 2. Docker Compose Changes

**Current:**
```yaml
supabase-edge-functions:
  image: supabase/edge-runtime:v1.70.3
  volumes:
    - ../supabase/functions:/home/deno/functions:ro
  command:
    - start
    - --main-service
    - /home/deno/functions/platform-main
```

**Proposed:**
```yaml
supabase-edge-functions:
  image: supabase/edge-runtime:v1.71.2  # Upgrade to match official Supabase
  volumes:
    - supabase-functions:/home/deno/functions
    - deno-cache:/root/.cache/deno
  command:
    - start
    - --main-service
    - /home/deno/functions/main
  environment:
    JWT_SECRET: ${JWT_SECRET}
    SUPABASE_URL: http://supabase-kong:8000
    SUPABASE_ANON_KEY: ${ANON_KEY}
    SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
    SUPABASE_DB_URL: postgres://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD}@supabase-db:5432/${POSTGRES_DB:-postgres}
    VERIFY_JWT: "${VERIFY_JWT:-false}"
    # Module-specific env vars (email, API keys, etc.)
    EMAIL_PROVIDER: ${EMAIL_PROVIDER:-none}
    SENDGRID_API_KEY: ${SENDGRID_API_KEY:-}
    # ... (other env vars as currently configured)

api:
  volumes:
    - supabase-functions:/supabase-functions

volumes:
  supabase-functions:
  deno-cache:
```

**Key changes:**
- Renamed `platform-main` → `main` (matching official convention).
- Upgrade to edge-runtime v1.71.2 (latest official).
- Named volume `supabase-functions` is shared read-write between API and edge-runtime.
- Added `deno-cache` volume for faster cold starts.
- API server mounts the same volume at `/supabase-functions` to write module functions.

### 3. Volume Initialization (Entrypoint Script)

Core functions must be seeded into the named volume on startup. An entrypoint script handles this:

```bash
#!/bin/sh
# /docker/entrypoints/edge-functions-init.sh
# Seeds core functions into the named volume from a read-only bind mount.
# IMPORTANT: Merges _shared/ to preserve module-deployed files.

CORE_SOURCE="/tmp/core-functions"  # Bind-mounted from ../supabase/functions
TARGET="/home/deno/functions"

if [ -d "$CORE_SOURCE" ]; then
  echo "[init] Syncing core functions..."
  
  # Copy core function directories (skip directories with .module-function marker)
  for dir in "$CORE_SOURCE"/*/; do
    dirname=$(basename "$dir")
    [ "$dirname" = "_shared" ] && continue  # Handle _shared separately
    if [ -f "$TARGET/$dirname/.module-function" ]; then
      echo "[init] Skipping $dirname (module function, not overwriting)"
      continue
    fi
    cp -r "$dir" "$TARGET/$dirname"
  done
  
  # Merge _shared/ — copy core files without deleting module-added files.
  # Uses cp without -r on the directory itself to avoid replacing the whole dir.
  mkdir -p "$TARGET/_shared"
  cp -r "$CORE_SOURCE/_shared/"* "$TARGET/_shared/" 2>/dev/null || true
  
  # Ensure correct permissions
  chmod -R 755 "$TARGET"
  
  echo "[init] Core functions synced."
else
  echo "[init] Warning: Core functions source not found at $CORE_SOURCE"
fi

# Execute the original command
exec "$@"
```

**Docker Compose addition:**
```yaml
supabase-edge-functions:
  volumes:
    - supabase-functions:/home/deno/functions
    - ../supabase/functions:/tmp/core-functions:ro  # Core functions source
    - deno-cache:/root/.cache/deno
  entrypoint: ["/bin/sh", "/tmp/core-functions/../docker/entrypoints/edge-functions-init.sh"]
  command: ["edge-runtime", "start", "--main-service", "/home/deno/functions/main"]
```

### 4. Function Handler Pattern (Standardized)

All edge functions MUST use this pattern:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  // ... function logic
};

export default handler;
if (import.meta.main) Deno.serve(handler);
```

**Rules:**
- NO `import { serve } from 'https://deno.land/std@.../http/server.ts'` — this starts competing servers.
- MUST `export default handler` — the edge-runtime worker model imports the default export.
- The `if (import.meta.main)` guard allows standalone testing.
- Functions are loaded by the worker in isolation — they cannot interfere with each other.

### 5. Local Deployment Strategy (Revised)

**File: `packages/shared/src/modules/deploy-strategies/local-filesystem.ts`**

When a module is enabled locally:

1. **Copy function directory** from `{moduleDir}/functions/{functionName}/` to the shared volume at `/supabase-functions/{functionName}/`.
2. **Write a `.module-function` marker file** in the function directory to distinguish it from core functions. Contains `{ "moduleId": "event-media", "deployedAt": "ISO timestamp" }`.
3. **Copy `_shared/` dependencies** — Copy module's `functions/_shared/` contents to `/supabase-functions/_shared/`, merging with existing files. If a conflict exists, log a warning but allow the overwrite (modules should use namespaced filenames like `media-imageProcessor.ts`).
4. **No restart or reload needed** — `EdgeRuntime.userWorkers.create()` loads from disk on demand. The next request to the function will pick up the new files.

**Remove function (on module disable):**
1. Delete the function directory from the shared volume.
2. Optionally clean up module-specific `_shared/` files (tracked by the marker file).

### 6. Cloud Deployment Strategy (Unchanged)

The cloud deployment via `cloud-api.ts` continues to work as-is:
- Uploads function source + `_shared/` dependencies via Supabase Management API.
- Rewrites import paths from `../_shared/` to `./_shared/`.
- No main service concept in cloud — each function is a separate deployment.

### 7. Core vs Module Function Separation

**Core functions** (remain in `supabase/functions/` in the git repo):
- `main/` (the router — new, replaces platform-main)
- `admin-add-first/`, `admin-send-magic-link/`, `admin-nl-query/`
- `email-send/`, `email-batch-send/`, `email-send-reminders/`, `email-webhook/`, `email-sendgrid-webhook/`, `email-retry-send/`, `email-generate-encoded/`, `email-inbound-parse/`, `email-send-push/`
- `people-signup/`, `people-enrichment/`, `people-classify-job-titles/`, `people-normalize-location/`, `people-profile-update/`, `people-track-attribute/`, `people-track-subscription/`, `people-validate-linkedin/`
- `platform-setup/`, `platform-generate-download-token/`, `platform-generate-embeddings/`
- `health-check/`
- `_shared/` (shared utilities)

**Module functions** (live in their respective module repos, deployed dynamically):
- `events/`, `events-registration/`, `events-search/`, `events-generate-matches/`, `events-send-match-emails/`, `events-speaker-*`
- `media-combine-chunks/`, `media-get-youtube-upload-url/`, `media-process-image/`, `media-process-youtube-uploads/`, `media-process-zip/`, `media-upload-youtube/`
- `newsletter-gdoc-import/`, `newsletter-send/`, `newsletter-unsubscribe/`
- `calendars-api/`, `calendars-discover/`, `calendars-process-csv/`
- `integrations-luma-*/`, `integrations-track-offer/`

**Migration plan:** Module functions currently in the core repo are deleted after being verified in their respective module repos.

### 8. Concurrency and Rollback

**Concurrent deployments:** The `deployEdgeFunctions()` function acquires a PostgreSQL advisory lock (`pg_advisory_xact_lock`) before writing files. This prevents race conditions when two modules are enabled simultaneously.

**Partial failure rollback:** If copying one function fails:
1. The successfully copied functions remain — they are independent and valid.
2. The failed function is logged and its status recorded in `installed_modules`.
3. The API response includes per-function deployment status so the UI can show which functions failed.
4. The user can retry by disabling and re-enabling the module.

## API Design

### POST `/api/modules/:moduleId/enable`

**Request:** `{}`

**Success Response (200):**
```json
{
  "success": true,
  "edgeFunctions": [
    { "name": "media-process-zip", "status": "deployed" },
    { "name": "media-combine-chunks", "status": "deployed" }
  ],
  "migrations": ["002_event_media_albums.sql"]
}
```

**Partial Failure Response (200 with warnings):**
```json
{
  "success": false,
  "edgeFunctions": [
    { "name": "media-process-zip", "status": "deployed" },
    { "name": "media-combine-chunks", "status": "failed", "error": "Missing _shared/imageProcessor.ts" }
  ],
  "migrations": ["002_event_media_albums.sql"],
  "warnings": ["1 of 2 edge functions failed to deploy"]
}
```

**Error Responses:**
- `400 Bad Request` — Module not found or invalid moduleId.
- `409 Conflict` — Module dependencies not met.
- `500 Internal Server Error` — Unexpected failure (with error details in JSON body).

### Internal: `deployEdgeFunctions()` Changes

```typescript
interface FunctionDeployStatus {
  name: string;
  status: 'deployed' | 'failed' | 'skipped';
  error?: string;
}

interface DeployResult {
  success: boolean;
  functions: FunctionDeployStatus[];
  warnings: string[];
}

async function deployEdgeFunctions(opts: {
  modules: LoadedModule[];
  functionsDir: string;
  supabase: SupabaseClient;
  projectRoot: string;
}): Promise<DeployResult>

// Behavior changes:
// 1. Local: writes function dirs to shared Docker volume (no platform-main regeneration)
// 2. Local: NO restart or reload needed (workers load from disk on demand)
// 3. Cloud: unchanged (uploads via Management API)
// 4. Returns per-function deployment status
// 5. Acquires advisory lock before writing (concurrency safety)
```

## Data Models / Database Schema

**One schema change:** Add `edge_function_status` JSONB column to `installed_modules`:

```sql
ALTER TABLE public.installed_modules
  ADD COLUMN IF NOT EXISTS edge_function_status JSONB DEFAULT '[]';
-- Stores: [{ "name": "media-process-zip", "status": "deployed", "deployedAt": "..." }, ...]
```

Existing columns remain:
- `edge_functions_hash` — used to detect source changes and skip redundant deployments.
- `status` — module-level status ('enabled', 'disabled', 'error').

## Infrastructure Requirements

### Local Development
- **Docker named volume** `supabase-functions` shared between API and edge-runtime containers (read-write).
- **Docker named volume** `deno-cache` for the edge-runtime's module cache (faster cold starts).
- **Bind mount** `../supabase/functions:/tmp/core-functions:ro` for seeding core functions.
- **Entrypoint script** syncs core functions from bind mount into named volume on container start.
- **Edge-runtime v1.71.2** (upgrade from v1.70.3 to match official Supabase).

### Cloud (Supabase)
- No infrastructure changes. Management API handles everything.

## Security Considerations

1. **Shared volume permissions** — Both containers need read-write access. The entrypoint script sets directory permissions to `755` (owner-writable, group/other-readable). The API server writes as its process user; the edge-runtime reads as `root` (default in the Supabase image).
2. **Function content validation** — The API server only copies files from verified module directories loaded via `loadModules()` with checksum validation. No arbitrary code path.
3. **No Docker socket dependency** — The new architecture does not require Docker socket access. Workers load from disk on demand; no container restart needed.
4. **JWT verification** — The main service can optionally verify JWTs before routing (matching official Supabase behavior). Controlled by `VERIFY_JWT` env var (default: false for local dev).
5. **Worker isolation** — Each function runs in an isolated Deno worker with memory limits (256MB) and timeouts (5 min). A compromised or buggy function cannot affect other functions.
6. **Secret isolation** — Module secrets are stored in `installed_modules.config` (database), not environment variables. Edge functions access them via Supabase client queries at runtime.

## Error Handling Strategy

| Scenario | Detection | Response | Recovery |
|----------|-----------|----------|----------|
| File copy failure | `fs.copyFile` throws | 500 with error details; function marked as `failed` in DB | Retry via module disable/re-enable |
| Missing `_shared/` dependency | Static import scan during deploy (resolve-sources.ts) | 500 with missing file list | Add missing dependency to module's `_shared/` |
| Worker creation failure | `EdgeRuntime.userWorkers.create()` throws | 500 to the HTTP caller with error message | Check function's `index.ts` for syntax/import errors |
| Worker timeout (>5 min) | Edge-runtime enforces `workerTimeoutMs` | 504 Gateway Timeout | Optimize function or increase timeout |
| Worker memory exceeded (>256MB) | Edge-runtime enforces `memoryLimitMb` | 500 with OOM error | Optimize function or increase limit |
| Concurrent deployment race | Advisory lock contention | Second request waits (up to 30s), then proceeds | Automatic — lock is released after first deployment completes |

## Performance Requirements

| Metric | Target | Measurement |
|--------|--------|-------------|
| Function cold start | < 500ms | Time from first request to response for a function importing `@supabase/supabase-js` |
| Hot function response | < 100ms overhead | Overhead added by main service routing (worker reuse) |
| Hot-deploy latency | < 2 seconds | Time from file write completion to function being callable |
| No downtime during deploy | 0 dropped requests | Existing functions unaffected during new function deployment |
| Cloud deployment | < 30 seconds/function | Supabase Management API upload + activation time |

## Observability

### Logging
- **Main service**: Logs every request routing decision (`serving the request with /home/deno/functions/{name}`), worker creation errors, and JWT validation failures.
- **API server**: Logs function deployment events (module ID, function names, success/failure, duration).
- **Edge-runtime**: Captures stdout/stderr from each worker, forwarded to Docker's logging driver.
- **Format**: Structured text logs (edge-runtime does not support structured JSON natively). Parseable by standard log aggregators.

### Metrics (Phase 2)
- Function invocation count per function name.
- Function error rate (5xx responses) per function.
- Worker creation latency (cold start proxy).
- Deployment success/failure counts.
- Collection via edge-runtime's `--enable-otel` flag (OpenTelemetry support built in).

### Alerting (Phase 2)
- Alert on repeated worker creation failures for a specific function.
- Alert on deployment failures during module enablement.

## Testing Strategy

1. **Unit tests** — Test `deployEdgeFunctions()` with mock strategies for both local and cloud paths. Verify file copy, `_shared/` resolution, advisory lock acquisition.
2. **Integration tests** — Docker Compose test: enable a test module, verify its edge function responds at `/functions/v1/{name}`.
3. **Handler pattern lint** — CI check: `grep -r "^serve(" supabase/functions/*/index.ts` should find zero matches (only `Deno.serve` in `main/index.ts`).
4. **Regression test** — Verify existing core functions still respond after migration.
5. **Hot-deploy test** — Write a new function directory to the volume while the runtime is running; verify it becomes callable within 2 seconds.
6. **Cloud deployment test** — Staging environment test for Supabase Management API upload flow.

## Deployment / Migration Strategy

### Phase 1: Fix Local Routing (Immediate — can be done in a single PR)
1. Create `supabase/functions/main/index.ts` with the official Supabase router pattern using `Deno.serve()` + `EdgeRuntime.userWorkers.create()`.
2. Update `docker-compose.yml`: change `--main-service` to point to `/home/deno/functions/main`, upgrade to edge-runtime v1.71.2.
3. Convert remaining legacy `serve()` functions (5 files) to `export default handler` pattern.
4. Delete `platform-main/` directory.
5. **Verify**: All existing functions respond correctly via `/functions/v1/{name}`.

### Phase 2: Shared Volume + Hot Deploy
1. Switch from bind mount to named Docker volume `supabase-functions`.
2. Create entrypoint script to seed core functions from bind mount into volume.
3. Mount the named volume in the API container at `/supabase-functions`.
4. Update `local-filesystem.ts` strategy: write to `/supabase-functions/` instead of the git-tracked directory. Remove `regeneratePlatformMain()` call. Remove Docker socket restart logic.
5. Add `edge_function_status` JSONB column to `installed_modules`.
6. **Verify**: Enable a module via API, verify its function is callable without container restart.

### Phase 3: Module Function Migration
1. For each module: verify its `functions/` directory in the module repo contains all required functions.
2. Delete module functions from `supabase/functions/` in the core repo.
3. Update module `index.ts` configs to list all their edge functions.
4. Update CI to not expect module functions in core repo.
5. **Verify**: Fresh `docker compose up` → enable modules → all functions work.

### Phase 4: Cleanup
1. Remove `regeneratePlatformMain()` from `deploy-edge-functions.ts`.
2. Remove Docker socket mount from docker-compose.yml.
3. Remove `EDGE_FUNCTIONS_CONTAINER` env var handling.
4. Update developer documentation.
5. Add handler pattern lint to CI.

### Rollback Plan
Each phase is independently deployable and reversible:
- **Phase 1 rollback**: Revert `main/index.ts` and docker-compose changes; restore `platform-main/`.
- **Phase 2 rollback**: Switch back to bind mount; the core functions still exist in the repo.
- **Phase 3 rollback**: Re-add module functions to core repo from git history.

## Open Questions

1. **Worker caching behavior** — Does `EdgeRuntime.userWorkers.create()` cache compiled modules between requests? The `noModuleCache: false` parameter suggests yes, but need to verify cold start behavior after deploying new files.
2. **Edge-runtime v1.71.2 compatibility** — Verify the upgrade from v1.70.3 doesn't introduce breaking changes to existing function code.
3. **`_shared/` conflict resolution** — Should we implement namespaced shared files (e.g., `_shared/media/imageProcessor.ts`) to prevent inter-module conflicts, or is the current flat structure sufficient?
4. **Core-as-module** — Should core functions eventually become a "core module" for full architectural consistency? Deferred to post-Phase 4.
