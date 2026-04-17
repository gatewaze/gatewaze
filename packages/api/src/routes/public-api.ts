import { Router, Request, Response } from 'express';
import type { LoadedModule, OpenApiContribution, ModuleRuntimeContext } from '@gatewaze/shared/types/modules';
import { apiKeyAuth } from '../lib/api-key-auth.js';
import { createPublicApiContext } from '../lib/public-api-context.js';
import { sendPublicApiError, publicApiErrorHandler } from '../lib/public-api-response.js';

// ---------------------------------------------------------------------------
// OpenAPI spec assembly
// ---------------------------------------------------------------------------

function assembleOpenApiSpec(
  modules: Array<{ moduleId: string; basePath: string; contribution: OpenApiContribution }>,
): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {
    // Common schemas
    Pagination: {
      type: 'object',
      properties: {
        total: { type: ['integer', 'null'], description: 'Total number of items (null if unknown)' },
        limit: { type: 'integer', description: 'Maximum items per page' },
        offset: { type: 'integer', description: 'Number of items skipped' },
        has_more: { type: 'boolean', description: 'Whether more items exist beyond this page' },
      },
      required: ['total', 'limit', 'offset', 'has_more'],
    },
    Links: {
      type: 'object',
      properties: {
        self: { type: 'string', format: 'uri', description: 'URL of the current page' },
        next: { type: 'string', format: 'uri', description: 'URL of the next page (absent if no more)' },
      },
      required: ['self'],
    },
    Error: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Machine-readable error code' },
        message: { type: 'string', description: 'Human-readable error message' },
        details: { type: 'object', description: 'Additional error context', additionalProperties: true },
      },
      required: ['code', 'message'],
    },
  };

  const tags: Array<{ name: string; description: string }> = [];

  // Common responses referenced across the spec
  const commonResponses: Record<string, unknown> = {
    Unauthorized: {
      description: 'Missing or invalid API key',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { error: { $ref: '#/components/schemas/Error' } },
          },
        },
      },
    },
    Forbidden: {
      description: 'API key lacks the required scope',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { error: { $ref: '#/components/schemas/Error' } },
          },
        },
      },
    },
    NotFound: {
      description: 'Resource not found',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { error: { $ref: '#/components/schemas/Error' } },
          },
        },
      },
    },
    RateLimited: {
      description: 'Rate limit exceeded',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { error: { $ref: '#/components/schemas/Error' } },
          },
        },
      },
    },
    ValidationError: {
      description: 'Request validation failed',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { error: { $ref: '#/components/schemas/Error' } },
          },
        },
      },
    },
  };

  // Merge module contributions
  for (const { moduleId, basePath, contribution } of modules) {
    // Add tag
    tags.push(contribution.tag);

    // Prefix paths with basePath
    if (contribution.paths) {
      for (const [pathKey, pathValue] of Object.entries(contribution.paths)) {
        const fullPath = `${basePath}${pathKey}`;
        paths[fullPath] = pathValue;
      }
    }

    // Prefix schema names with moduleId_
    if (contribution.schemas) {
      for (const [schemaName, schemaDef] of Object.entries(contribution.schemas)) {
        schemas[`${moduleId}_${schemaName}`] = schemaDef;
      }
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Gatewaze Public API',
      description: 'Public API for the Gatewaze event management platform.',
      version: '1.0.0',
    },
    servers: [{ url: '/api/v1', description: 'Public API v1' }],
    tags,
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for authentication. Obtain one from the Gatewaze admin dashboard.',
        },
      },
      schemas,
      responses: commonResponses,
    },
    security: [{ apiKey: [] }],
  };
}

// ---------------------------------------------------------------------------
// Scalar docs HTML
// ---------------------------------------------------------------------------

const DOCS_HTML = `<!DOCTYPE html>
<html>
<head><title>Gatewaze Public API</title><meta charset="utf-8" /></head>
<body>
<script id="api-reference" data-url="/api/v1/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Base path validation
// ---------------------------------------------------------------------------

const BASE_PATH_PATTERN = /^\/[a-z0-9\-/]+$/;

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Creates the master public API router mounted at `/api/v1`.
 *
 * Registers health, OpenAPI, and docs endpoints (unauthenticated),
 * then applies API key auth and mounts each enabled module's public
 * API routes at its declared base path.
 */
export async function createPublicApiRouter(
  enabledModules: LoadedModule[],
  supabase: any,
): Promise<Router> {
  const router = Router();

  // Track module OpenAPI contributions for lazy assembly
  const openApiContributions: Array<{
    moduleId: string;
    basePath: string;
    contribution: OpenApiContribution;
  }> = [];

  // Cached spec (assembled on first request)
  let cachedOpenApiSpec: Record<string, unknown> | null = null;

  // ------------------------------------------------------------------
  // Unauthenticated routes
  // ------------------------------------------------------------------

  // Health check
  router.get('/health', async (_req: Request, res: Response) => {
    try {
      // Verify Supabase is reachable with a lightweight query
      const { error } = await supabase
        .from('platform_settings')
        .select('key')
        .limit(1);

      if (error) {
        return res.status(503).json({
          status: 'degraded',
          error: 'Database unreachable',
          modules: enabledModules.length,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        status: 'ok',
        modules: enabledModules.length,
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: 'error',
        error: 'Database unreachable',
        modules: enabledModules.length,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // OpenAPI spec
  router.get('/openapi.json', (_req: Request, res: Response) => {
    if (!cachedOpenApiSpec) {
      cachedOpenApiSpec = assembleOpenApiSpec(openApiContributions);
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(cachedOpenApiSpec);
  });

  // Interactive docs (Scalar)
  router.get('/docs', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(DOCS_HTML);
  });

  // ------------------------------------------------------------------
  // API key authentication (all routes below require a valid key)
  // ------------------------------------------------------------------

  router.use(apiKeyAuth());

  // ------------------------------------------------------------------
  // Module route registration
  // ------------------------------------------------------------------

  const registeredPaths = new Set<string>();

  for (const mod of enabledModules) {
    if (!mod.config.publicApiRoutes) continue;

    // Resolve base path
    const basePath = mod.config.publicApiBasePath ?? `/${mod.config.id}`;

    // Validate base path format
    if (!BASE_PATH_PATTERN.test(basePath)) {
      console.error(
        `[public-api] Invalid base path "${basePath}" for module "${mod.config.id}" ` +
        `(must match /[a-z0-9-/]+). Skipping.`,
      );
      continue;
    }

    // Check for path conflicts
    if (registeredPaths.has(basePath)) {
      console.error(
        `[public-api] Duplicate base path "${basePath}" — module "${mod.config.id}" ` +
        `conflicts with an already-registered module. Skipping.`,
      );
      continue;
    }
    registeredPaths.add(basePath);

    // Build runtime context for this module
    const runtimeCtx: ModuleRuntimeContext = {
      moduleId: mod.config.id,
      moduleDir: mod.resolvedDir ?? '',
      projectRoot: '', // populated by caller if needed
      logger: {
        info: (msg, meta) => console.log(`[${mod.config.id}]`, msg, meta ?? ''),
        warn: (msg, meta) => console.warn(`[${mod.config.id}]`, msg, meta ?? ''),
        error: (msg, meta) => console.error(`[${mod.config.id}]`, msg, meta ?? ''),
        debug: (msg, meta) => console.debug(`[${mod.config.id}]`, msg, meta ?? ''),
      },
      supabase,
      config: {} as any,
      moduleConfig: mod.moduleConfig ?? {},
    };

    // Create scoped context with public API helpers
    const ctx = createPublicApiContext(mod.config.id, runtimeCtx);

    // Create a scoped router and let the module register its routes
    const scopedRouter = Router();
    try {
      await mod.config.publicApiRoutes(scopedRouter, ctx);
    } catch (err) {
      console.error(`[public-api] Failed to register routes for "${mod.config.id}":`, err);
      continue;
    }
    router.use(basePath, scopedRouter);

    // Collect OpenAPI contribution
    if (mod.config.publicApiSchema) {
      openApiContributions.push({
        moduleId: mod.config.id,
        basePath,
        contribution: mod.config.publicApiSchema,
      });
    }

    console.log(`[public-api] Registered: ${mod.config.name} at /api/v1${basePath}`);
  }

  // ------------------------------------------------------------------
  // Catch-all 404 for unmatched public API routes
  // ------------------------------------------------------------------

  router.use((_req: Request, res: Response) => {
    sendPublicApiError(res, 404, 'NOT_FOUND', 'The requested endpoint does not exist.');
  });

  // ------------------------------------------------------------------
  // Error handler (must be last)
  // ------------------------------------------------------------------

  router.use(publicApiErrorHandler);

  return router;
}
