/**
 * Handler factories per spec-platform-listing-pattern.md §7.
 *
 * Each factory wraps the shared buildListingQuery primitive with a
 * consumer-specific shape: auth context construction, response envelope,
 * cache wrapper. The four consumers share the validation, projection
 * resolution, sort/filter logic, and error envelope.
 *
 * v1 ships createAdminListingRoute. publicApi/mcp/portal stubs are
 * declared so module manifests can adopt the import without breaking
 * when the implementation lands.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  HandlerContext,
  ListingQuery,
  ListingResult,
  ListingSchema,
} from './types';
import { ListingError } from './types';
import { buildListingQuery } from './build-query';

// ============================================================================
// Admin route factory
// ============================================================================

export interface AdminListingRouteConfig {
  schema: ListingSchema;
  /** Express-style path mounted under the API server. */
  path: string;
  /** Optional in-process cache with TTL in seconds. Default: off. */
  cache?: { ttlSeconds: number };
}

/**
 * Returns an Express-style handler the API server's apiRoutes setup
 * mounts. Caller is responsible for applying the admin role guard
 * upstream — handler does not re-check.
 */
export interface AdminListingHandler {
  path: string;
  method: 'GET';
  schema: ListingSchema;
  /** Run the listing for one request. */
  handle: (req: AdminListingRequest, supabase: SupabaseClient) => Promise<AdminListingResponse>;
}

export interface AdminListingRequest {
  query: Record<string, unknown>;
  ctx: HandlerContext;
}

export interface AdminListingResponse {
  status: number;
  body: ListingResult | { error: { code: string; message: string; details?: Record<string, unknown> } };
}

/**
 * Build an admin listing handler. Returned object includes the schema
 * so the caller can introspect it (e.g. to derive the URL base path).
 */
export function createAdminListingRoute(config: AdminListingRouteConfig): AdminListingHandler {
  return {
    path: config.path,
    method: 'GET' as const,
    schema: config.schema,
    handle: async (req, supabase) => {
      try {
        const query = parseListingQueryFromHttp(req.query);
        const result = await buildListingQuery({
          schema: config.schema,
          consumer: 'admin',
          query,
          ctx: req.ctx,
          supabase,
        });
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ListingError) {
          return { status: err.httpStatus, body: err.toEnvelope() };
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
          status: 500,
          body: { error: { code: 'LISTING_INTERNAL_ERROR', message } },
        };
      }
    },
  };
}

// ============================================================================
// Distinct-values factory — populates filter dropdowns
// ============================================================================

export interface AdminDistinctRouteConfig {
  schema: ListingSchema;
  /** Express path mounted under the API server. */
  path: string;
  /**
   * How many distinct values to return at most. Default 200. Larger
   * dropdowns are unusable; if a filter routinely exceeds this, the UI
   * should switch to a typeahead with a server-side `?prefix=` query.
   */
  limit?: number;
}

export interface AdminDistinctHandler {
  /** Path with `:column` placeholder (e.g. /api/admin/events/distinct/:column) */
  path: string;
  method: 'GET';
  schema: ListingSchema;
  handle: (req: AdminDistinctRequest, supabase: SupabaseClient) => Promise<AdminDistinctResponse>;
}

export interface AdminDistinctRequest {
  column: string;
  query: Record<string, unknown>;
  ctx: HandlerContext;
}

export interface DistinctValue {
  value: string;
  count?: number;
}

export interface AdminDistinctResponse {
  status: number;
  body:
    | { values: DistinctValue[]; column: string; truncated: boolean }
    | { error: { code: string; message: string; details?: Record<string, unknown> } };
}

/**
 * Build a distinct-values handler. Caller mounts at the configured
 * `path` with `:column` as the dynamic segment.
 *
 * Auth: same as the listing route — `/admin/*` upstream guard rejects
 * non-admin callers before the handler runs.
 */
export function createAdminDistinctRoute(config: AdminDistinctRouteConfig): AdminDistinctHandler {
  const limit = config.limit ?? 200;

  return {
    path: config.path,
    method: 'GET' as const,
    schema: config.schema,
    handle: async (req, supabase) => {
      const requestedColumn = req.column;
      const allow = config.schema.distinctableColumns ?? [];
      if (!allow.includes(requestedColumn)) {
        return {
          status: 400,
          body: {
            error: {
              code: 'INVALID_DISTINCT_COLUMN',
              message: `Column '${requestedColumn}' is not in the schema's distinctableColumns allowlist`,
              details: { allowed: allow },
            },
          },
        };
      }

      // Apply the same auth filter the listing uses — distinct values
      // for /publicApi/portal/mcp would otherwise leak hidden rows.
      const authFilterResolver = config.schema.authFilters.admin;
      const authFn = authFilterResolver ? authFilterResolver(req.ctx) : null;

      // PostgREST doesn't support DISTINCT directly. We use the existing
      // listing query path: select the column with NOT NULL filter,
      // dedupe in the response. For columns with up to ~200 distinct
      // values this is fine; for unbounded columns the schema author
      // should NOT add them to distinctableColumns.
      let qb = supabase
        .from(config.schema.table)
        .select(`${requestedColumn}`, { count: 'planned', head: false })
        .not(requestedColumn, 'is', null)
        .order(requestedColumn, { ascending: true })
        .limit(limit * 10);

      if (authFn) qb = authFn(qb);

      const { data, error } = await qb;
      if (error) {
        return {
          status: 500,
          body: { error: { code: 'LISTING_INTERNAL_ERROR', message: error.message } },
        };
      }

      // Dedup + count in JS. With ~200 expected distinct values and at most
      // limit*10 rows fetched, this is microseconds.
      const counts = new Map<string, number>();
      for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const raw = row[requestedColumn];
        if (raw === null || raw === undefined) continue;
        const key = String(raw);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const values: DistinctValue[] = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value))
        .slice(0, limit);

      return {
        status: 200,
        body: {
          column: requestedColumn,
          values,
          truncated: counts.size > limit,
        },
      };
    },
  };
}

// ============================================================================
// Public API consumer (Phase 11)
// ============================================================================

export interface PublicApiListingRouteConfig {
  schema: ListingSchema;
  path: string;
  /** Cache hint emitted as `Cache-Control` headers; no in-memory store. */
  cache?: { ttlSeconds: number; edgeCacheable?: boolean };
}

export interface PublicApiListingHandler {
  path: string;
  method: 'GET';
  schema: ListingSchema;
  cache: PublicApiListingRouteConfig['cache'];
  handle: (req: AdminListingRequest, supabase: SupabaseClient) => Promise<AdminListingResponse>;
}

/**
 * Public-API listing route — third-party consumers paginating a JSON
 * list. Auth is handled upstream by the existing public-API key
 * middleware. Schema's `authFilters.publicApi` is required when a
 * publicApi projection exists (validator enforces — see §7.2 / §4.2).
 *
 * The cache hint is reflected in `Cache-Control` headers; the actual
 * cache is whatever the operator runs in front of the API (CDN, Cloudflare).
 */
export function createPublicApiListingRoute(config: PublicApiListingRouteConfig): PublicApiListingHandler {
  return {
    path: config.path,
    method: 'GET' as const,
    schema: config.schema,
    cache: config.cache,
    handle: async (req, supabase) => {
      try {
        const query = parseListingQueryFromHttp(req.query);
        const result = await buildListingQuery({
          schema: config.schema,
          consumer: 'publicApi',
          query,
          ctx: { ...req.ctx, consumer: 'publicApi' },
          supabase,
        });
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ListingError) {
          return { status: err.httpStatus, body: err.toEnvelope() };
        }
        const message = err instanceof Error ? err.message : String(err);
        return { status: 500, body: { error: { code: 'LISTING_INTERNAL_ERROR', message } } };
      }
    },
  };
}

/**
 * Helper to build the `Cache-Control` header value from the route's
 * cache hint. Returns null when caching is opt-out.
 */
export function publicApiCacheControl(cache: PublicApiListingRouteConfig['cache']): string | null {
  if (!cache) return null;
  if (cache.edgeCacheable === false) return null;
  const ttl = Math.max(1, Math.floor(cache.ttlSeconds));
  return `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`;
}

// ============================================================================
// MCP tool consumer (Phase 11)
// ============================================================================

export interface McpListingToolConfig {
  schema: ListingSchema;
  name: string;
  description: string;
  /** Lower default than admin so the LLM context stays small. */
  defaultPageSize?: number;
}

export interface McpListingTool {
  name: string;
  description: string;
  schema: ListingSchema;
  /** JSON Schema describing the tool inputs. */
  inputSchema: Record<string, unknown>;
  handle: (input: McpListingToolInput, supabase: SupabaseClient, ctx: HandlerContext) => Promise<McpListingToolOutput>;
}

export interface McpListingToolInput {
  page?: number;
  pageSize?: number;
  sort?: { column: string; direction: 'asc' | 'desc' };
  filters?: Record<string, unknown>;
  search?: string;
}

export interface McpListingToolOutput {
  rows: Array<Record<string, unknown>>;
  totalCount: number | null;
  totalCountEstimate?: number;
  hasMore: boolean;
  nextPage: number | null;
}

/**
 * MCP tool factory. LLM-friendly response shape (`hasMore` + `nextPage`
 * over bare envelope), tighter default pageSize, projection-driven
 * field selection from `schema.projections.mcp`.
 */
export function createMcpListingTool(config: McpListingToolConfig): McpListingTool {
  const defaultPageSize = config.defaultPageSize ?? 25;
  return {
    name: config.name,
    description: config.description,
    schema: config.schema,
    inputSchema: buildMcpInputSchema(config.schema, defaultPageSize),
    handle: async (input, supabase, ctx) => {
      const query = {
        page: input.page ?? 0,
        pageSize: input.pageSize ?? defaultPageSize,
        sort: input.sort,
        filters: input.filters,
        search: input.search,
      };
      const result = await buildListingQuery({
        schema: config.schema,
        consumer: 'mcp',
        query,
        ctx: { ...ctx, consumer: 'mcp' },
        supabase,
      });
      const total = result.totalCount ?? result.totalCountEstimate ?? 0;
      const consumed = (result.page + 1) * result.pageSize;
      const hasMore = consumed < total;
      return {
        rows: result.rows,
        totalCount: result.totalCount,
        totalCountEstimate: result.totalCountEstimate,
        hasMore,
        nextPage: hasMore ? result.page + 1 : null,
      };
    },
  };
}

function buildMcpInputSchema(schema: ListingSchema, defaultPageSize: number): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 0, default: 0 },
      pageSize: { type: 'integer', minimum: 1, maximum: 200, default: defaultPageSize },
      sort: {
        type: 'object',
        properties: {
          column: { type: 'string', enum: Object.keys(schema.sortable) },
          direction: { type: 'string', enum: ['asc', 'desc'] },
        },
      },
      filters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(schema.filters).map(([k, decl]) => [k, mcpFilterSchema(decl)])
        ),
        additionalProperties: false,
      },
      search: schema.searchable.length > 0 ? { type: 'string', minLength: 3, maxLength: 100 } : undefined,
    },
  };
}

function mcpFilterSchema(decl: ListingSchema['filters'][string]): Record<string, unknown> {
  switch (decl.kind) {
    case 'enum': {
      const item = { type: 'string', enum: decl.values };
      return decl.multi ? { type: 'array', items: item } : item;
    }
    case 'string': {
      const item = { type: 'string', minLength: decl.minLength ?? 1, maxLength: decl.maxLength ?? 255 };
      return decl.multi ? { type: 'array', items: item } : item;
    }
    case 'integer': {
      const item: Record<string, unknown> = { type: 'integer' };
      if (decl.min !== undefined) item.minimum = decl.min;
      if (decl.max !== undefined) item.maximum = decl.max;
      return decl.multi ? { type: 'array', items: item } : item;
    }
    case 'date':
      return { type: 'string', format: 'date-time' };
    case 'dateRange':
      return {
        type: 'object',
        properties: {
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
        },
        required: ['from', 'to'],
      };
    case 'boolean':
      return { type: 'boolean' };
    case 'tristate':
      return { type: 'string', enum: ['has', 'none'] };
    case 'jsonbHas':
      return { type: 'string' };
  }
}

// ============================================================================
// Portal SSR loader (Phase 11)
// ============================================================================

export interface PortalListingLoaderConfig {
  schema: ListingSchema;
  cache?: { ttlSeconds: number; isr?: boolean };
}

export interface PortalListingLoader {
  schema: ListingSchema;
  cache: PortalListingLoaderConfig['cache'];
  /** Run with the visitor's anon Supabase client. */
  load: (
    query: ListingQuery,
    supabase: SupabaseClient,
    ctx: HandlerContext
  ) => Promise<PortalListingLoaderResult>;
}

export interface PortalListingLoaderResult {
  rows: Array<Record<string, unknown>>;
  totalCount: number | null;
  totalCountEstimate?: number;
  page: number;
  pageSize: number;
  /** Next.js ISR revalidate value (seconds); set when cache.ttlSeconds is. */
  revalidate?: number;
}

export function createPortalListingLoader(config: PortalListingLoaderConfig): PortalListingLoader {
  return {
    schema: config.schema,
    cache: config.cache,
    load: async (query, supabase, ctx) => {
      const result = await buildListingQuery({
        schema: config.schema,
        consumer: 'portal',
        query,
        ctx: { ...ctx, consumer: 'portal' },
        supabase,
      });
      return {
        rows: result.rows,
        totalCount: result.totalCount,
        totalCountEstimate: result.totalCountEstimate,
        page: result.page,
        pageSize: result.pageSize,
        revalidate: config.cache?.ttlSeconds,
      };
    },
  };
}

// ============================================================================
// HTTP query-string parsing per the URL encoding scheme in §12.
// ============================================================================

/**
 * Parse a flat query-string object into a ListingQuery. Repeated keys
 * (Express coerces them into arrays automatically) become list filters.
 * Filter keys not present in the schema are passed through and rejected
 * downstream by the validator.
 */
export function parseListingQueryFromHttp(httpQuery: Record<string, unknown>): ListingQuery {
  const reservedKeys = new Set(['page', 'pageSize', 'sort', 'dir', 'q']);
  const filters: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(httpQuery)) {
    if (reservedKeys.has(k)) continue;
    filters[k] = v;
  }

  const page = parseIntSafe(httpQuery.page) ?? 0;
  const pageSize = parseIntSafe(httpQuery.pageSize) ?? 50;
  const sortColumn = typeof httpQuery.sort === 'string' ? httpQuery.sort : undefined;
  const sortDirection = httpQuery.dir === 'asc' || httpQuery.dir === 'desc' ? httpQuery.dir : undefined;
  const sort = sortColumn && sortDirection ? { column: sortColumn, direction: sortDirection as 'asc' | 'desc' } : undefined;
  const search = typeof httpQuery.q === 'string' ? httpQuery.q : undefined;

  return { page, pageSize, sort, filters, search };
}

function parseIntSafe(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// ============================================================================
// HandlerContext builder helper for routes that don't have a richer one.
// ============================================================================

export interface BuildHandlerContextInput {
  consumer: HandlerContext['consumer'];
  user?: HandlerContext['user'];
  apiKey?: HandlerContext['apiKey'];
  agent?: HandlerContext['agent'];
  brandId?: string;
  ip: string;
  headers: HandlerContext['headers'];
  requestId: string;
}

export function buildHandlerContext(input: BuildHandlerContextInput): HandlerContext {
  return {
    consumer: input.consumer,
    user: input.user,
    apiKey: input.apiKey,
    agent: input.agent,
    brandId: input.brandId,
    ip: input.ip,
    headers: input.headers,
    requestId: input.requestId,
    extras: {},
  };
}
