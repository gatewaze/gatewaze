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

/** Set Cache-Control with public + max-age + s-maxage. */
function ctxSetCache(res: Response, maxAge: number, sMaxAge: number): void {
  res.setHeader('Cache-Control', `public, max-age=${maxAge}, s-maxage=${sMaxAge}`);
}

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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(cachedOpenApiSpec);
  });

  // Interactive docs (Scalar)
  router.get('/docs', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(DOCS_HTML);
  });

  // MCP tool registry — public, derived from module contributions
  router.get('/mcp/tools', (_req: Request, res: Response) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');

    const coreTools = [
      { name: 'events_search', description: 'Search events by city, type, date range, topics, or calendar.' },
      { name: 'events_get', description: 'Get a single event by UUID or short event_id.' },
      { name: 'events_speakers', description: 'Get speakers for a specific event.' },
      { name: 'events_sponsors', description: 'Get sponsors for a specific event.' },
      { name: 'platform_health', description: 'Check Gatewaze platform health and module count.' },
    ];

    const moduleTools: Array<{
      moduleId: string;
      moduleName: string;
      tools: Array<{ name: string; description: string }>;
      resources: Array<{ uriTemplate: string; name: string; description: string }>;
      prompts: Array<{ name: string; description: string }>;
    }> = [];

    for (const mod of enabledModules) {
      const raw = mod.config.mcpContributions;
      if (!raw) continue;
      let contributions: any;
      try {
        contributions = typeof raw === 'function' ? raw({} as any) : raw;
      } catch {
        continue;
      }
      const moduleId = mod.config.id;
      moduleTools.push({
        moduleId,
        moduleName: mod.config.name,
        tools: (contributions.tools ?? []).map((t: any) => ({
          name: `${moduleId}_${t.name}`,
          description: t.description,
        })),
        resources: (contributions.resources ?? []).map((r: any) => ({
          uriTemplate: r.uriTemplate,
          name: r.name,
          description: r.description,
        })),
        prompts: (contributions.prompts ?? []).map((p: any) => ({
          name: `${moduleId}_${p.name}`,
          description: p.description,
        })),
      });
    }

    res.json({
      transport: { stdio: true, http: false },
      core: { tools: coreTools },
      modules: moduleTools,
    });
  });

  // ------------------------------------------------------------------
  // API key authentication (all routes below require a valid key)
  // ------------------------------------------------------------------

  router.use(apiKeyAuth());

  // ------------------------------------------------------------------
  // Core endpoints — content categories and unified content discovery
  // ------------------------------------------------------------------

  // GET /api/v1/categories — list configured content categories
  router.get('/categories', async (_req: Request, res: Response) => {
    try {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'content_categories')
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: { code: 'QUERY_ERROR', message: error.message } });
      }

      let categories: Array<{ value: string; label: string }> = [];
      if (data?.value) {
        try {
          const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
          if (Array.isArray(parsed)) categories = parsed;
        } catch {
          categories = [];
        }
      }

      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
      res.json({ data: categories, _links: { self: '/api/v1/categories' } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: { code: 'INTERNAL', message } });
    }
  });

  // GET /api/v1/content — unified content across all enabled modules
  router.get('/content', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      if (limit < 1 || offset < 0) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'limit must be 1..100, offset must be >= 0' } });
      }

      const apiKey = req.apiKey!;
      const requestedTypes = req.query.type
        ? String(req.query.type).split(',').map((s) => s.trim()).filter(Boolean)
        : null;
      const requestedCategories = req.query.content_category
        ? String(req.query.content_category).split(',').map((s) => s.trim()).filter(Boolean)
        : null;

      // Collect content sources from enabled modules, gated by scope
      type Source = {
        moduleId: string;
        type: string;
        table: string;
        scope: string;
        fields: { id: string; title: string; date: string; summary?: string };
        visibilityFilter?: Array<{ column: string; eq: string | boolean | number }>;
        resourcePath: (row: Record<string, unknown>) => string;
      };

      const sources: Source[] = [];
      for (const mod of enabledModules) {
        const declared = mod.config.publicContentSources;
        if (!declared) continue;
        for (const source of declared) {
          if (!apiKey.scopes.includes(source.scope)) continue;
          if (requestedTypes && !requestedTypes.includes(source.type)) continue;
          sources.push({ moduleId: mod.config.id, ...source });
        }
      }

      if (sources.length === 0) {
        ctxSetCache(res, 60, 300);
        return res.json({
          data: [],
          pagination: { total: 0, limit, offset, has_more: false },
          _links: { self: req.originalUrl },
        });
      }

      // Query each source — fetch (offset + limit) rows then merge-sort by date
      const fetchLimit = offset + limit;
      type Row = {
        type: string;
        id: string;
        title: string | null;
        date: string | null;
        summary: string | null;
        content_category: string | null;
        _links: { self: string };
      };

      const settled = await Promise.allSettled(
        sources.map(async (src): Promise<{ rows: Row[]; total: number }> => {
          const cols = [
            src.fields.id,
            src.fields.title,
            src.fields.date,
            src.fields.summary,
            'content_category',
          ].filter(Boolean) as string[];

          let q = supabase
            .from(src.table)
            .select(cols.join(','), { count: 'exact' })
            .order(src.fields.date, { ascending: false })
            .limit(fetchLimit);

          for (const v of src.visibilityFilter ?? []) {
            q = q.eq(v.column, v.eq);
          }
          if (requestedCategories) {
            q = requestedCategories.length > 1
              ? q.in('content_category', requestedCategories)
              : q.eq('content_category', requestedCategories[0]);
          }
          if (req.query.from) q = q.gte(src.fields.date, req.query.from as string);
          if (req.query.to) q = q.lte(src.fields.date, req.query.to as string);

          const { data, count, error } = await q;
          if (error) throw new Error(`${src.type}: ${error.message}`);

          const rows: Row[] = (data ?? []).map((row: any) => ({
            type: src.type,
            id: String(row[src.fields.id]),
            title: row[src.fields.title] ?? null,
            date: row[src.fields.date] ?? null,
            summary: src.fields.summary ? row[src.fields.summary] ?? null : null,
            content_category: row.content_category ?? null,
            _links: { self: `/api/v1${src.resourcePath(row)}` },
          }));
          return { rows, total: count ?? 0 };
        }),
      );

      const errors: string[] = [];
      let total = 0;
      const combined: Row[] = [];
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          combined.push(...r.value.rows);
          total += r.value.total;
        } else {
          errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        }
      }

      // Sort combined rows by date desc, then slice the requested window
      combined.sort((a, b) => {
        const ad = a.date ?? '';
        const bd = b.date ?? '';
        return ad < bd ? 1 : ad > bd ? -1 : 0;
      });
      const window = combined.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      ctxSetCache(res, 60, 300);
      res.json({
        data: window,
        pagination: { total, limit, offset, has_more: hasMore },
        _links: {
          self: req.originalUrl,
          ...(hasMore ? { next: `/api/v1/content?offset=${offset + limit}&limit=${limit}` } : {}),
        },
        ...(errors.length > 0 ? { warnings: errors } : {}),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: { code: 'INTERNAL', message } });
    }
  });

  // ------------------------------------------------------------------
  // Module route registration
  // ------------------------------------------------------------------

  const registeredPaths = new Set<string>();

  const modulesWithPublicApi = enabledModules.filter(m => m.config.publicApiRoutes);
  if (modulesWithPublicApi.length === 0) {
    console.log('[public-api] No modules have publicApiRoutes');
  }

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
