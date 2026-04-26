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
// Other consumers — stubs for v1, full implementation in Phase 11.
// ============================================================================

export interface PublicApiListingRouteConfig {
  schema: ListingSchema;
  path: string;
  cache?: { ttlSeconds: number; edgeCacheable?: boolean };
}

export function createPublicApiListingRoute(_config: PublicApiListingRouteConfig): never {
  throw new Error('createPublicApiListingRoute not yet implemented (Phase 11)');
}

export interface McpListingToolConfig {
  schema: ListingSchema;
  name: string;
  description: string;
}

export function createMcpListingTool(_config: McpListingToolConfig): never {
  throw new Error('createMcpListingTool not yet implemented (Phase 11)');
}

export interface PortalListingLoaderConfig {
  schema: ListingSchema;
  cache?: { ttlSeconds: number; isr?: boolean };
}

export function createPortalListingLoader(_config: PortalListingLoaderConfig): never {
  throw new Error('createPortalListingLoader not yet implemented (Phase 11)');
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
