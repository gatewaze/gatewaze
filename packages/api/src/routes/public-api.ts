import { Router, Request, Response } from 'express';
import type { LoadedModule, OpenApiContribution, ModuleRuntimeContext } from '@gatewaze/shared/types/modules';
import { apiKeyAuth } from '../lib/api-key-auth.js';
import { createPublicApiContext } from '../lib/public-api-context.js';
import { sendPublicApiError, publicApiErrorHandler } from '../lib/public-api-response.js';
import { logger } from '../lib/logger.js';

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

  // Core platform tags
  tags.push(
    { name: 'Discovery', description: 'Categories and unified content across all modules' },
    { name: 'Platform', description: 'Health and meta endpoints' },
  );

  // Core endpoints — health, categories, unified content
  paths['/health'] = {
    get: {
      tags: ['Platform'],
      summary: 'Health check',
      operationId: 'getHealth',
      security: [],
      responses: {
        200: {
          description: 'Service is healthy',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'ok' },
                  modules: { type: 'integer', description: 'Number of enabled modules' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        503: { description: 'Database unreachable' },
      },
    },
  };

  paths['/categories'] = {
    get: {
      tags: ['Discovery'],
      summary: 'List content categories',
      description:
        'Returns the platform\'s configured content categories. Categories are platform-wide ' +
        'taxonomy values (e.g. "foundation", "member", "community") used to filter content ' +
        'across all modules. Configure them via the Platform Settings admin page.',
      operationId: 'listCategories',
      responses: {
        200: {
          description: 'Configured content categories',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['value', 'label'],
                      properties: {
                        value: { type: 'string', example: 'foundation' },
                        label: { type: 'string', example: 'Foundation' },
                      },
                    },
                  },
                  _links: { $ref: '#/components/schemas/Links' },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  };

  paths['/content'] = {
    get: {
      tags: ['Discovery'],
      summary: 'Unified content across all modules',
      description:
        'Returns content records from every enabled module that exposes a content source ' +
        '(events, newsletter editions, etc.). Each row is normalized to a common shape. ' +
        'Use this for cross-content discovery, recent activity feeds, or category-filtered ' +
        'lookups without needing to query each module endpoint individually.\n\n' +
        'Sources are filtered by your API key\'s scopes — only types you can read appear. ' +
        'The total count and rows are merged across sources and sorted by date desc.',
      operationId: 'listContent',
      parameters: [
        {
          name: 'type',
          in: 'query',
          schema: { type: 'string' },
          description: 'Comma-separated content types (e.g. "event,newsletter_edition"). Omit for all.',
        },
        {
          name: 'content_category',
          in: 'query',
          schema: { type: 'string' },
          description: 'Comma-separated category slugs (from /categories).',
        },
        {
          name: 'from',
          in: 'query',
          schema: { type: 'string', format: 'date-time' },
          description: 'Records dated on or after this ISO timestamp.',
        },
        {
          name: 'to',
          in: 'query',
          schema: { type: 'string', format: 'date-time' },
          description: 'Records dated on or before this ISO timestamp.',
        },
        {
          name: 'expand',
          in: 'query',
          schema: { type: 'string', enum: ['full'] },
          description:
            'Set to "full" to inline the complete type-native record in each row under the ' +
            '`full` property — avoids a follow-up request to the resource\'s self link. The ' +
            'normalized fields (type, id, title, date, summary, content_category, _links) are ' +
            'always present alongside.',
        },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 25, minimum: 1, maximum: 100 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0, minimum: 0 } },
      ],
      responses: {
        200: {
          description: 'Unified content list',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/ContentRow' },
                  },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                  _links: { $ref: '#/components/schemas/Links' },
                  warnings: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Non-fatal errors from individual sources (response is still useful).',
                  },
                },
              },
            },
          },
        },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  };

  // Common content row schema referenced from /content
  schemas.ContentRow = {
    type: 'object',
    required: ['type', 'id', 'title', 'date', 'content_category', '_links'],
    properties: {
      type: { type: 'string', description: 'Content type identifier (e.g. "event", "newsletter_edition")' },
      id: { type: 'string', description: 'Resource identifier (slug or UUID, type-dependent)' },
      title: { type: ['string', 'null'] },
      date: { type: ['string', 'null'], format: 'date-time' },
      summary: { type: ['string', 'null'] },
      content_category: { type: ['string', 'null'] },
      _links: {
        type: 'object',
        properties: { self: { type: 'string', description: 'Path to the full resource' } },
      },
      full: {
        type: 'object',
        description:
          'Present only when ?expand=full is set. Contains all public columns of the source ' +
          'record (shape varies by type — for events these are the same fields as GET /events/{id}).',
        additionalProperties: true,
      },
    },
  };

  // Merge module contributions
  for (const { moduleId, basePath, contribution } of modules) {
    // Add tag
    tags.push(contribution.tag);

    // Prefix paths with basePath and auto-tag operations with the module's tag
    if (contribution.paths) {
      for (const [pathKey, pathValue] of Object.entries(contribution.paths)) {
        const fullPath = `${basePath}${pathKey}`;
        const tagName = contribution.tag.name;
        // Inject the module's tag into each operation so docs UIs (Scalar/Swagger)
        // group sub-resources under the parent tag instead of in a flat list.
        const taggedPath = pathValue && typeof pathValue === 'object'
          ? Object.fromEntries(
              Object.entries(pathValue as Record<string, unknown>).map(([method, op]) => {
                if (op && typeof op === 'object' && !Array.isArray(op)) {
                  const operation = op as Record<string, unknown>;
                  const existingTags = Array.isArray(operation.tags) ? operation.tags : [];
                  return [method, { ...operation, tags: existingTags.length ? existingTags : [tagName] }];
                }
                return [method, op];
              }),
            )
          : pathValue;
        paths[fullPath] = taggedPath;
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
      description:
        'Public REST API for the Gatewaze platform. Endpoints are grouped by content type ' +
        '(see the sidebar) — Discovery for cross-cutting endpoints (categories, unified content), ' +
        'Platform for health checks, and one section per enabled content module (Events, Newsletters, etc.).',
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
      const expandFull = req.query.expand === 'full';

      // Collect content sources from enabled modules, gated by scope
      type Source = {
        moduleId: string;
        type: string;
        table: string;
        scope: string;
        fields: { id: string; title: string; date: string; summary?: string };
        visibilityFilter?: Array<{ column: string; eq: string | boolean | number }>;
        resourcePath: (row: Record<string, unknown>) => string;
        fullFields?: readonly string[];
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
        full?: Record<string, unknown>;
      };

      const settled = await Promise.allSettled(
        sources.map(async (src): Promise<{ rows: Row[]; total: number }> => {
          // When ?expand=full and the source declares fullFields, SELECT them all up front
          // so we don't need a second query. Always include the summary fields and the
          // resource-path key (e.g. event_id) needed for _links.self.
          const summaryCols = [
            src.fields.id,
            src.fields.title,
            src.fields.date,
            src.fields.summary,
            'content_category',
          ].filter(Boolean) as string[];

          const cols = expandFull && src.fullFields
            ? Array.from(new Set([...summaryCols, ...src.fullFields]))
            : summaryCols;

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

          const rows: Row[] = (data ?? []).map((row: any) => {
            const base: Row = {
              type: src.type,
              id: String(row[src.fields.id]),
              title: row[src.fields.title] ?? null,
              date: row[src.fields.date] ?? null,
              summary: src.fields.summary ? row[src.fields.summary] ?? null : null,
              content_category: row.content_category ?? null,
              _links: { self: `/api/v1${src.resourcePath(row)}` },
            };
            if (expandFull && src.fullFields) {
              const full: Record<string, unknown> = {};
              for (const col of src.fullFields) full[col] = row[col] ?? null;
              base.full = full;
            }
            return base;
          });
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
    logger.info('[public-api] no modules have publicApiRoutes');
  }

  for (const mod of enabledModules) {
    if (!mod.config.publicApiRoutes) continue;

    // Resolve base path
    const basePath = mod.config.publicApiBasePath ?? `/${mod.config.id}`;

    // Validate base path format
    if (!BASE_PATH_PATTERN.test(basePath)) {
      logger.error(
        { module: mod.config.id, basePath },
        '[public-api] invalid base path (must match /[a-z0-9-/]+); skipping module',
      );
      continue;
    }

    // Check for path conflicts
    if (registeredPaths.has(basePath)) {
      logger.error(
        { module: mod.config.id, basePath },
        '[public-api] duplicate base path; skipping module',
      );
      continue;
    }
    registeredPaths.add(basePath);

    // Build runtime context for this module — use a child logger so
    // module logs carry { module: <id> } automatically.
    const moduleLogger = logger.child({ module: mod.config.id });
    const runtimeCtx: ModuleRuntimeContext = {
      moduleId: mod.config.id,
      moduleDir: mod.resolvedDir ?? '',
      projectRoot: '', // populated by caller if needed
      logger: {
        info: (msg, meta) => moduleLogger.info(meta ?? {}, msg),
        warn: (msg, meta) => moduleLogger.warn(meta ?? {}, msg),
        error: (msg, meta) => moduleLogger.error(meta ?? {}, msg),
        debug: (msg, meta) => moduleLogger.debug(meta ?? {}, msg),
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
      logger.error({ err, module: mod.config.id }, '[public-api] failed to register routes');
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

    logger.info({ module: mod.config.id, basePath }, '[public-api] registered');
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
