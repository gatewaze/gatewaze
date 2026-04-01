# Technical Specification: Module Edge Function Deployment

## Overview / Context

Gatewaze is a modular event management platform. Users enable modules (e.g., luma-integration, events, event-speakers) from an admin UI, and each module can declare Supabase edge functions that need to be deployed. The platform must support deploying these functions across all target environments without requiring CLI tools, Docker socket access, or host filesystem operations in production deployments.

### Current State

Today, module edge function deployment works as follows:

1. Module config declares `edgeFunctions: ['function-name-1', 'function-name-2']`
2. Module source directories contain `functions/<name>/index.ts` and `functions/_shared/` files
3. When a module is enabled, `deployEdgeFunctions()`:
   - Copies function directories from module source to `supabase/functions/`
   - Copies `_shared/` files into the platform `_shared/` directory
   - Regenerates `platform-main/index.ts` (a router that imports all functions for the self-hosted edge runtime)
   - Optionally shells out to `npx supabase functions deploy` (fails in containers without the CLI)
4. Self-hosted mode: A single Deno edge runtime container serves all functions via `platform-main`
5. Cloud mode: Each function is deployed individually to Supabase Cloud and runs standalone

### Problem

The current approach has several failure modes:
- **Cloud deployment fails silently**: The API container lacks the Supabase CLI, so `supabase functions deploy` fails. Functions are copied to disk but never reach Supabase Cloud.
- **Self-hosted Kubernetes**: No volume mount from host to edge runtime pod. Functions copied to disk inside the API pod are invisible to the edge runtime pod.
- **No portable deployment mechanism**: The system depends on filesystem operations and CLI tools that are environment-specific for production deployments.

## Goals

1. When a user enables a module from the admin UI, its edge functions become operational without manual CLI commands — in any environment
2. When a user disables a module, its associated edge functions are removed from the deployment target
3. Support all environment combinations:
   - Local Docker dev + self-hosted Supabase (current primary dev environment)
   - Local Docker dev + Supabase Cloud
   - Kubernetes + Supabase Cloud
   - Kubernetes + self-hosted Supabase (edge runtime in same cluster)
4. No dependency on Supabase CLI binary, Docker socket, or host filesystem in production deployment environments (Kubernetes, Supabase Cloud). These dependencies are acceptable for local development environments.
5. Shared files (`_shared/*.ts`) are deployed alongside the functions that import them
6. Graceful degradation: if deployment fails, the module is still enabled (DB migrations applied) but the user is informed via the admin UI and structured error responses
7. Module-specific secrets are synced to the deployment target when a module is enabled or its configuration is updated

## Non-Goals

- Building a custom edge function runtime (we use Supabase's edge runtime)
- Supporting non-Supabase function providers (AWS Lambda, Cloudflare Workers)
- Hot-reload of edge functions in production (dev-only concern)
- Automatic rollback of function deployments on failure (operators can redeploy the latest successful version)
- Multi-tenant function isolation (each Gatewaze instance is single-tenant)

## System Architecture

### Deployment Strategies

The system uses a **strategy pattern** to handle different deployment targets. The correct strategy is selected at runtime based on environment detection.

```
┌─────────────────────────────────────────────┐
│           Module Enable/Disable Flow        │
│                                             │
│  1. Apply/revert migrations                 │
│  2. Detect deployment environment           │
│  3. Execute deployment strategy             │
│     (deploy or remove functions + secrets)  │
│  4. Report result to admin UI               │
└─────────────────────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │  Local   │ │  Cloud   │ │   K8s    │
  │ Filesystem│ │   API    │ │  Shared  │
  │ Strategy │ │ Strategy │ │ Storage  │
  │ (DEV ONLY)│ │          │ │ Strategy │
  └──────────┘ └──────────┘ └──────────┘
       │             │             │
       ▼             ▼             ▼
  Write to disk  POST/DELETE   Write to PVC
  + restart      to Supabase   + K8s rollout
  edge runtime   Management    restart of
  container      API           edge runtime pod
```

**Environment Detection Precedence** (evaluated top-to-bottom, first match wins):
1. **Cloud API** — `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` are set
2. **K8s Shared Storage** — `EDGE_FUNCTIONS_SHARED_DIR` is set and `SUPABASE_PROJECT_REF` is not
3. **Local Filesystem** — fallback (uses `EDGE_FUNCTIONS_CONTAINER` for restart)

### Strategy 1: Local Filesystem (Self-hosted Docker Dev) — DEVELOPMENT ONLY

**When**: Neither cloud nor K8s env vars are set. `EDGE_FUNCTIONS_CONTAINER` identifies the Docker container to restart.

**How it works**:
1. Copy function files from module source to `supabase/functions/` (volume-mounted from host)
2. Copy `_shared/` files
3. Regenerate `platform-main/index.ts`
4. Restart the edge runtime container via Docker socket
5. On module disable: remove function directory and regenerate `platform-main`

**Detection**: `!process.env.SUPABASE_PROJECT_REF && !process.env.EDGE_FUNCTIONS_SHARED_DIR`

**Note**: This strategy depends on Docker socket access and host volume mounts. It is not suitable for production.

### Strategy 2: Cloud API (Supabase Cloud)

**When**: `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` are set. Takes precedence over all other strategies.

**How it works — Deployment**:
1. For each edge function in the module, concurrently:
   a. Read the function's `index.ts` from the module source directory
   b. Collect all `_shared/*.ts` files that the function imports (transitive)
   c. POST to `https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug={name}` with multipart form data containing all source files
2. Sync module-specific secrets via `POST /v1/projects/{ref}/secrets`
3. No CLI binary needed — pure HTTP from Node.js

**How it works — Removal** (module disable):
1. For each edge function in the module:
   a. DELETE `https://api.supabase.com/v1/projects/{ref}/functions/{slug}`
2. Note: Secrets are NOT removed on disable (they may be shared with other modules or platform functions)

**Detection**: `process.env.SUPABASE_PROJECT_REF && process.env.SUPABASE_ACCESS_TOKEN`

**API Request Format (Deployment)**:
```
POST /v1/projects/{project-ref}/functions/deploy?slug={function-name}
Authorization: Bearer {SUPABASE_ACCESS_TOKEN}
Content-Type: multipart/form-data

Parts:
- metadata: {"entrypoint_path": "index.ts", "name": "{function-name}", "verify_jwt": false}
  // verify_jwt defaults to false (API proxy handles auth via service role key).
  // Modules can override this per-function via edgeFunctionConfig in their module definition.
- file (filename="index.ts") — the function entry point
- file (filename="_shared/lumaRegistration.ts") — shared dependency
- file (filename="_shared/integrationEvents.ts") — shared dependency
```

**Key Assumption**: The Supabase Management API accepts multiple `file` parts with relative paths in `filename` and handles bundling server-side. This must be verified during Phase 1 implementation.

**Fallback if assumption is false**: If the API requires a single pre-bundled file, the deployer must add an `esbuild` bundling step before upload:
1. Add `esbuild` as a dependency to `@gatewaze/shared`
2. Bundle the function's `index.ts` and all `_shared/` imports into a single output file targeting Deno
3. Upload the single bundled file instead of multiple source files
4. The `DeployFunctionRequest.sourceFiles` field would be replaced by `bundledSource: string`

**API Response Format**:
```json
// Success (200)
{ "id": "uuid", "slug": "function-name", "version": 7, "status": "ACTIVE" }

// Error (4xx/5xx)
{ "message": "error description" }
```

**API Request Format (Deletion)**:
```
DELETE /v1/projects/{project-ref}/functions/{slug}
Authorization: Bearer {SUPABASE_ACCESS_TOKEN}
```

**Dependency Resolution**:
The deployer scans each function's source for import statements referencing `_shared/` files. It handles two import patterns:
- `from '../_shared/filename.ts'` — function importing shared file
- `from './filename.ts'` — shared file importing another shared file in the same directory

Resolution is transitive: if `_shared/lumaRegistration.ts` imports `_shared/integrationEvents.ts`, both are included.

### Strategy 3: Shared Storage (Kubernetes Self-hosted)

**When**: `EDGE_FUNCTIONS_SHARED_DIR` is set and `SUPABASE_PROJECT_REF` is not set.

**How it works**:
1. The API pod and edge runtime pod share a PersistentVolumeClaim (PVC) mounted at a known path
2. When a module is enabled, the API pod writes function files to the shared volume
3. Regenerates `platform-main/index.ts` on the shared volume
4. Triggers a rollout restart of the edge runtime deployment via the Kubernetes API
5. On module disable: removes function files and triggers another rollout restart

**Edge Runtime Restart Mechanism**: The API pod uses the Kubernetes API (`PATCH /apis/apps/v1/namespaces/{ns}/deployments/{name}` with a `kubectl.kubernetes.io/restartedAt` annotation) to trigger a rolling restart of the edge runtime deployment. This requires the API pod's ServiceAccount to have `patch` permission on the edge runtime Deployment resource.

**Detection**: `process.env.EDGE_FUNCTIONS_SHARED_DIR && !process.env.SUPABASE_PROJECT_REF`

**Required RBAC**:
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: gatewaze-api-edge-restart
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    resourceNames: ["gatewaze-edge-runtime"]
    verbs: ["get", "patch"]
```

**Kubernetes Manifest (example)**:
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: gatewaze-edge-functions
spec:
  accessModes: [ReadWriteMany]
  resources:
    requests:
      storage: 1Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gatewaze-api
spec:
  template:
    spec:
      serviceAccountName: gatewaze-api
      containers:
        - name: api
          env:
            - name: EDGE_FUNCTIONS_SHARED_DIR
              value: /shared/functions
            - name: EDGE_RUNTIME_DEPLOYMENT
              value: gatewaze-edge-runtime
            - name: EDGE_RUNTIME_NAMESPACE
              value: default
          volumeMounts:
            - name: edge-functions
              mountPath: /shared/functions
      volumes:
        - name: edge-functions
          persistentVolumeClaim:
            claimName: gatewaze-edge-functions
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gatewaze-edge-runtime
spec:
  template:
    spec:
      containers:
        - name: edge-runtime
          image: supabase/edge-runtime:v1.70.3
          command: ["start", "--main-service", "/shared/functions/platform-main"]
          volumeMounts:
            - name: edge-functions
              mountPath: /shared/functions
              readOnly: true
      volumes:
        - name: edge-functions
          persistentVolumeClaim:
            claimName: gatewaze-edge-functions
```

## Component Design

### DeploymentStrategy Interface

```typescript
// packages/shared/src/modules/deploy-strategies/types.ts

export interface DeployFunctionRequest {
  functionName: string;
  entrypointPath: string;   // e.g., 'index.ts'
  sourceFiles: Map<string, string>;  // relativePath → file content
}

export interface DeployFunctionResult {
  functionName: string;
  success: boolean;
  error?: string;
  errorCode?: 'NETWORK_ERROR' | 'AUTH_ERROR' | 'DEPLOY_ERROR' | 'NOT_FOUND' | 'INVALID_SOURCE';
}

export interface DeploymentStrategy {
  /** Deploy a single edge function */
  deploy(request: DeployFunctionRequest): Promise<DeployFunctionResult>;

  /** Remove a previously deployed edge function */
  remove(functionName: string): Promise<DeployFunctionResult>;

  /** Signal the edge runtime to reload (if applicable) */
  reload(): Promise<void>;

  /** Sync secrets required by edge functions */
  syncSecrets(secrets: Array<{ name: string; value: string }>): Promise<void>;

  /** Check if this strategy can operate in the current environment */
  isAvailable(): boolean;
}
```

### DeploymentStrategyFactory

```typescript
// packages/shared/src/modules/deploy-strategies/factory.ts

export type DeploymentEnvironment = 'local-filesystem' | 'cloud-api' | 'k8s-shared-storage';

export function detectEnvironment(): DeploymentEnvironment {
  if (process.env.SUPABASE_PROJECT_REF) {
    if (!process.env.SUPABASE_ACCESS_TOKEN) {
      console.error(
        '[modules] SUPABASE_PROJECT_REF is set but SUPABASE_ACCESS_TOKEN is missing. ' +
        'Cloud deployment will not work. Set SUPABASE_ACCESS_TOKEN in your environment.'
      );
      // Do NOT silently fall through to local-filesystem — that would mask a misconfiguration
      throw new Error('SUPABASE_PROJECT_REF requires SUPABASE_ACCESS_TOKEN for cloud deployment');
    }
    return 'cloud-api';
  }
  if (process.env.EDGE_FUNCTIONS_SHARED_DIR) {
    return 'k8s-shared-storage';
  }
  return 'local-filesystem';
}

export function createStrategy(env: DeploymentEnvironment): DeploymentStrategy {
  switch (env) {
    case 'cloud-api': return new CloudApiStrategy();
    case 'k8s-shared-storage': return new SharedStorageStrategy();
    default: return new LocalFilesystemStrategy();
  }
}
```

### Source File Resolution

```typescript
// packages/shared/src/modules/deploy-strategies/resolve-sources.ts

import { join } from 'path';
import { readFileSync, existsSync } from 'fs';

/**
 * Given a function's entry point, resolve all source files needed for deployment.
 * Scans imports to find _shared/ dependencies transitively.
 */
export function resolveSourceFiles(
  functionDir: string,
  sharedDir: string,
): Map<string, string> {
  const files = new Map<string, string>();
  const visited = new Set<string>();

  const entryContent = readFileSync(join(functionDir, 'index.ts'), 'utf-8');
  files.set('index.ts', entryContent);

  // Resolve _shared/ imports from the entry point
  resolveSharedImports(entryContent, sharedDir, files, visited);

  return files;
}

function resolveSharedImports(
  content: string,
  sharedDir: string,
  files: Map<string, string>,
  visited: Set<string>,
): void {
  // Match imports from ../_shared/ (function → shared) or ./ (shared → shared)
  const sharedImportRegex = /from\s+['"](?:\.\.?\/_shared\/|\.\/)([\w.-]+\.ts)['"]/g;
  let match;

  while ((match = sharedImportRegex.exec(content)) !== null) {
    const fileName = match[1];
    if (visited.has(fileName)) continue;
    visited.add(fileName);

    const filePath = join(sharedDir, fileName);
    if (existsSync(filePath)) {
      const sharedContent = readFileSync(filePath, 'utf-8');
      files.set(`_shared/${fileName}`, sharedContent);
      // Recurse: shared files may import other shared files via ./
      resolveSharedImports(sharedContent, sharedDir, files, visited);
    }
  }
}
```

### Updated deployEdgeFunctions

The existing function is refactored to use strategies. Functions within a module are deployed concurrently for performance.

```typescript
export async function deployEdgeFunctions(opts: DeployEdgeFunctionsOptions): Promise<DeployResult> {
  const functionsDir = resolve(opts.projectRoot, 'supabase/functions');
  const result: DeployResult = { copied: [], deployed: [], errors: [] };

  const env = detectEnvironment();
  const strategy = createStrategy(env);

  for (const mod of opts.modules) {
    const edgeFunctions = mod.config.edgeFunctions;
    if (!edgeFunctions?.length) continue;

    const moduleDir = mod.resolvedDir;
    if (!moduleDir) {
      for (const fnName of edgeFunctions) {
        result.errors.push({
          module: mod.config.id,
          functionName: fnName,
          error: `Cannot resolve module directory for "${mod.config.id}"`,
        });
      }
      continue;
    }

    const moduleFunctionsDir = join(moduleDir, 'functions');
    const moduleSharedDir = join(moduleFunctionsDir, '_shared');

    // For local/k8s: copy _shared files to platform _shared
    if (env !== 'cloud-api') {
      const targetSharedDir = env === 'k8s-shared-storage'
        ? join(process.env.EDGE_FUNCTIONS_SHARED_DIR!, '_shared')
        : join(functionsDir, '_shared');

      if (existsSync(moduleSharedDir)) {
        mkdirSync(targetSharedDir, { recursive: true });
        cpSync(moduleSharedDir, targetSharedDir, { recursive: true });
      }
    }

    // Deploy functions concurrently
    const deployPromises = edgeFunctions.map(async (fnName) => {
      const srcDir = join(moduleFunctionsDir, fnName);
      if (!existsSync(srcDir)) {
        result.errors.push({
          module: mod.config.id,
          functionName: fnName,
          error: `Source directory not found: ${srcDir}`,
        });
        return;
      }

      // For local/k8s: copy to disk
      if (env !== 'cloud-api') {
        const destDir = env === 'k8s-shared-storage'
          ? join(process.env.EDGE_FUNCTIONS_SHARED_DIR!, fnName)
          : join(functionsDir, fnName);
        mkdirSync(destDir, { recursive: true });
        cpSync(srcDir, destDir, { recursive: true });
        result.copied.push({ module: mod.config.id, functionName: fnName });
      }

      // Deploy via strategy (cloud API or no-op for local/k8s since files are on disk)
      if (env === 'cloud-api' && strategy.isAvailable()) {
        const sourceFiles = resolveSourceFiles(srcDir, moduleSharedDir);
        const deployResult = await strategy.deploy({
          functionName: fnName,
          entrypointPath: 'index.ts',
          sourceFiles,
        });

        if (deployResult.success) {
          result.deployed.push({ module: mod.config.id, functionName: fnName });
        } else {
          result.errors.push({
            module: mod.config.id,
            functionName: fnName,
            error: deployResult.error!,
          });
        }
      }
    });

    await Promise.all(deployPromises);

    // Sync module-specific secrets
    if (mod.config.configSchema) {
      const secrets = resolveModuleSecrets(mod);
      if (secrets.length > 0) {
        await strategy.syncSecrets(secrets);
      }
    }
  }

  // Regenerate platform-main for local/k8s
  if (env !== 'cloud-api' && result.copied.length > 0) {
    const targetDir = env === 'k8s-shared-storage'
      ? process.env.EDGE_FUNCTIONS_SHARED_DIR!
      : functionsDir;
    regeneratePlatformMain(targetDir, result.copied.map(r => r.functionName));
  }

  // Reload edge runtime
  await strategy.reload();

  return result;
}
```

## Edge Function Entry Point Convention

All edge functions must support both standalone execution (Supabase Cloud) and import by `platform-main` (self-hosted):

```typescript
async function handler(req: Request) {
  // ... function logic ...
}

export default handler
if (import.meta.main) Deno.serve(handler)
```

- `export default handler` — allows `platform-main` to import and route to it
- `if (import.meta.main) Deno.serve(handler)` — starts the server only when run standalone on Supabase Cloud

## Environment Variables

| Variable | Required For | Description |
|---|---|---|
| `SUPABASE_PROJECT_REF` | Cloud API strategy | Supabase project reference (e.g., `zlzfpgczmvhvxfscqnwi`) |
| `SUPABASE_ACCESS_TOKEN` | Cloud API strategy | Supabase Management API token (e.g., `sbp_...`) |
| `EDGE_FUNCTIONS_CONTAINER` | Local filesystem strategy | Docker container name for edge runtime restart |
| `EDGE_FUNCTIONS_SHARED_DIR` | K8s shared storage strategy | Path to shared PVC mount for edge functions |
| `EDGE_RUNTIME_DEPLOYMENT` | K8s shared storage strategy | Name of the edge runtime K8s Deployment (for rollout restart) |
| `EDGE_RUNTIME_NAMESPACE` | K8s shared storage strategy | Namespace of the edge runtime Deployment (defaults to `default`) |

## Edge Function Secrets Management

Edge functions require environment-specific secrets (API keys, credentials) that are not bundled with the source code.

### Secret Sources

Modules declare required secrets in their `configSchema`:

```typescript
configSchema: {
  LUMA_API_KEY: { key: 'LUMA_API_KEY', type: 'secret', required: true },
  LUMA_WEBHOOK_SECRET: { key: 'LUMA_WEBHOOK_SECRET', type: 'secret', required: false },
}
```

Platform-level secrets (shared across all functions) are defined in the environment:

```
SENDGRID_API_KEY, CUSTOMERIO_SITE_ID, CUSTOMERIO_API_KEY, OPENAI_API_KEY, etc.
```

### Secret Resolution

```typescript
function resolveModuleSecrets(mod: LoadedModule): Array<{ name: string; value: string }> {
  const secrets: Array<{ name: string; value: string }> = [];
  const configSchema = mod.config.configSchema;
  if (!configSchema) return secrets;

  for (const [, schema] of Object.entries(configSchema)) {
    if (schema.type !== 'secret') continue;
    // Module-specific secrets from DB config take priority over env vars
    const moduleConfigValue = mod.moduleConfig?.[schema.key] as string | undefined;
    const envValue = process.env[schema.key];
    const value = moduleConfigValue || envValue;
    if (value) {
      secrets.push({ name: schema.key, value });
    }
  }

  return secrets;
}
```

### Per-Strategy Secret Handling

**Local Filesystem**: Secrets are environment variables on the edge runtime container (set in `docker-compose.yml`). No sync action needed. Module-specific secrets configured via admin UI are stored in `installed_modules.config` and must be added to the compose environment manually or via `make deploy-functions`.

**Cloud API**: Synced via `POST https://api.supabase.com/v1/projects/{ref}/secrets` with `Authorization: Bearer {SUPABASE_ACCESS_TOKEN}`. The API accepts an array of `{ name, value }` objects and is idempotent (creates or updates).

**K8s Shared Storage**: Secrets are managed via Kubernetes Secrets mounted on the edge runtime pod. The API pod updates the Secret via the Kubernetes API (`PATCH /api/v1/namespaces/{ns}/secrets/{name}`). Requires RBAC permission:

```yaml
- apiGroups: [""]
  resources: ["secrets"]
  resourceNames: ["gatewaze-edge-function-secrets"]
  verbs: ["get", "patch"]
```

### Secret Lifecycle

- **On module enable**: Module-specific secrets are synced to the deployment target
- **On module config update**: Changed secrets are re-synced
- **On module disable**: Secrets are NOT removed (they may be referenced by other modules or shared platform functions). Orphaned secrets are low-risk since they are just unused env vars.

## Error Handling Strategy

### Error Codes

| Code | Meaning |
|---|---|
| `NETWORK_ERROR` | Could not reach the deployment target (DNS, timeout, connection refused) |
| `AUTH_ERROR` | Invalid or expired `SUPABASE_ACCESS_TOKEN` (HTTP 401/403) |
| `DEPLOY_ERROR` | Function deployment failed (invalid source, bundling error, quota exceeded) |
| `NOT_FOUND` | Function or project not found (HTTP 404) |
| `INVALID_SOURCE` | Source file resolution failed (missing entry point or shared dependency) |
| `RELOAD_ERROR` | Edge runtime restart/rollout failed |

### Scenarios

1. **Migration succeeds, deployment fails**: Module status is set to `enabled`. The API response includes `edgeFunctionErrors: [{ functionName, error, errorCode }]`. The admin UI shows a warning banner: "Module enabled but some edge functions could not be deployed."

2. **Partial deployment failure**: Successfully deployed functions are live. Failed functions are reported in `edgeFunctionErrors`. The module is still marked `enabled`.

3. **Network timeout**: Cloud API calls have a 30-second timeout per function. On timeout, the error is reported with `errorCode: 'NETWORK_ERROR'`.

4. **Missing credentials**: If `SUPABASE_PROJECT_REF` is set but `SUPABASE_ACCESS_TOKEN` is not, `detectEnvironment()` throws an error rather than silently falling back to local-filesystem. This prevents misconfigured cloud deployments from appearing to succeed.

5. **Reload failure**: If `strategy.reload()` fails (e.g., Docker socket unavailable, K8s API unreachable), the error is logged but does not prevent the module from being enabled. Functions will become available on next edge runtime restart.

## Observability

### Logging

All deployment operations are logged with structured context:

```
[modules] Deploying 4 edge function(s) for "luma-integration" via cloud-api strategy
[modules] Deployed integrations-luma-process-csv (1.2s)
[modules] Deployed integrations-luma-webhook (0.9s)
[modules] Failed integrations-luma-issue-discount: AUTH_ERROR — HTTP 401
[modules] Synced 2 secret(s) for "luma-integration"
[modules] Deployment complete: 3 succeeded, 1 failed
```

### Metrics

Track via application metrics (e.g., Prometheus counters/histograms):

| Metric | Type | Labels |
|---|---|---|
| `gatewaze_edge_function_deploy_total` | Counter | `strategy`, `module`, `status` (success/error) |
| `gatewaze_edge_function_deploy_duration_seconds` | Histogram | `strategy`, `module` |
| `gatewaze_edge_function_remove_total` | Counter | `strategy`, `module`, `status` |
| `gatewaze_module_secrets_sync_total` | Counter | `strategy`, `module`, `status` |

### Alerting

- Alert if `gatewaze_edge_function_deploy_total{status="error"}` exceeds threshold
- Alert if deployment duration exceeds 2 minutes for any single function

## Security Considerations

- `SUPABASE_ACCESS_TOKEN` grants full project management access. It must be stored as a Kubernetes Secret, Docker secret, or env file — never in source control or client-side code.
- The Management API token is only used server-side in the API container. It is never exposed to the admin frontend.
- Edge functions deployed via the Management API inherit the project's JWT verification settings. The spec sets `verify_jwt: false` because the API proxy route uses the service role key. If direct browser access is needed, `verify_jwt` should be set per-function.
- `_shared/` files may contain business logic but should never contain secrets or credentials. Secrets are passed via environment variables, not source code.
- In K8s, the API pod's ServiceAccount has minimal RBAC: only `patch` on the specific edge runtime Deployment and Secret resources.

## Performance Requirements

- Deploying a single edge function to Supabase Cloud: < 30 seconds
- Deploying all functions for a module concurrently (typically 2-5): < 60 seconds
- Local filesystem deployment (copy + restart): < 5 seconds
- Source file resolution (import scanning): < 100ms per function

Functions within a module are deployed concurrently via `Promise.all` to minimize total deployment time.

## Testing Strategy

1. **Unit tests**: `resolveSourceFiles()` correctly finds transitive `_shared/` imports, including shared-to-shared imports via `./`
2. **Unit tests**: `detectEnvironment()` returns correct strategy for each env var combination, including edge cases (conflicting vars, missing vars)
3. **Unit tests**: `resolveModuleSecrets()` correctly prioritizes module config over env vars
4. **Integration tests**: `CloudApiStrategy.deploy()` against a test Supabase project — verify function is callable after deploy
5. **Integration tests**: `CloudApiStrategy.remove()` — verify function returns 404 after removal
6. **Integration tests**: `LocalFilesystemStrategy` copies files and regenerates `platform-main` correctly
7. **E2E tests**: Enable a module via the admin UI and verify the edge function responds in both cloud and self-hosted modes
8. **Performance tests**: Verify concurrent deployment of 5 functions completes within the 60-second SLA
9. **Misconfiguration tests**: Verify `detectEnvironment()` throws when `SUPABASE_PROJECT_REF` is set without `SUPABASE_ACCESS_TOKEN`
10. **Security tests**: Verify `SUPABASE_ACCESS_TOKEN` is never logged, included in error messages, or exposed in API responses

## Migration Plan

1. **Phase 1**: Refactor `deployEdgeFunctions` to use the strategy pattern. Implement `LocalFilesystemStrategy` (existing code) and `CloudApiStrategy` (replaces CLI shell-out). Remove Supabase CLI from API Dockerfile.dev.
2. **Phase 2**: Implement `SharedStorageStrategy` for Kubernetes self-hosted. Add K8s manifests and RBAC configuration.
3. **Phase 3**: Add function removal on module disable. Implement `remove()` for all strategies.
4. **Phase 4**: Add observability (structured logging, metrics).

## Open Questions / Risks

1. **Supabase Management API bundling**: The biggest implementation risk. The Cloud API strategy assumes the Management API accepts multiple source files and bundles them server-side. If it requires a pre-bundled file, Phase 1 must include an `esbuild` step. This will be validated as the first task of Phase 1.
2. **K8s edge runtime image command**: The `supabase/edge-runtime` Docker image may use a custom entrypoint (`start --main-service`) rather than raw `deno run`. The exact command must be verified against the image version used.
3. **Platform-level secrets in K8s**: When a module requires a platform-level secret (e.g., `SENDGRID_API_KEY`) that isn't already in the K8s Secret, the admin UI should surface which secrets are missing rather than failing silently at function invocation time.
