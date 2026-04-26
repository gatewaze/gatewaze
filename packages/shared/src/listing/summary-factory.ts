/**
 * Admin summary endpoint factory per spec-platform-listing-pattern.md §7.5.
 *
 * Modules declare a `summary: SummaryDeclaration` on their listing
 * schema. This factory wraps the declared RPC, validates the `range`
 * query param against the declared range list, and serves the result
 * with the in-process cache (per §14).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListingSchema, HandlerContext } from './types';
import { ListingError } from './types';
import { listingCache } from './cache';

export interface AdminSummaryRouteConfig {
  schema: ListingSchema;
  /** Express path mounted under the API server. */
  path: string;
}

export interface AdminSummaryHandler {
  path: string;
  method: 'GET';
  schema: ListingSchema;
  handle: (req: AdminSummaryRequest, supabase: SupabaseClient) => Promise<AdminSummaryResponse>;
}

export interface AdminSummaryRequest {
  query: Record<string, unknown>;
  ctx: HandlerContext;
}

export interface AdminSummaryResponse {
  status: number;
  body:
    | { computedAt: string; cacheHit: boolean; data: Record<string, unknown> }
    | { error: { code: string; message: string; details?: Record<string, unknown> } };
}

export function createAdminSummaryRoute(config: AdminSummaryRouteConfig): AdminSummaryHandler {
  const summary = config.schema.summary;
  if (!summary) {
    throw new Error(
      `createAdminSummaryRoute: schema '${config.schema.id}' has no summary declaration`
    );
  }
  const ttl = summary.cacheTtlSeconds ?? 60;

  return {
    path: config.path,
    method: 'GET' as const,
    schema: config.schema,
    handle: async (req, supabase) => {
      try {
        const range = String(req.query.range ?? 'all');
        if (!summary.ranges.includes(range as never)) {
          throw new ListingError('INVALID_FILTER', `Range '${range}' is not allowed`, {
            details: { allowed: summary.ranges },
          });
        }
        const fromTs = req.query.from ? String(req.query.from) : null;
        const toTs = req.query.to ? String(req.query.to) : null;
        if (range === 'custom') {
          if (!fromTs || !toTs) {
            throw new ListingError('INVALID_RANGE', `range=custom requires from + to`, {
              details: { from: fromTs, to: toTs },
            });
          }
          if (new Date(fromTs).getTime() > new Date(toTs).getTime()) {
            throw new ListingError('INVALID_RANGE', `from must be <= to`);
          }
        }

        const cacheKey = {
          module: config.schema.id,
          consumer: 'admin' as const,
          signature: `summary::${range}::${fromTs ?? ''}::${toTs ?? ''}`,
        };

        let cacheHit = true;
        const data = await listingCache.getOrCompute(cacheKey, ttl, async () => {
          cacheHit = false;
          const { data: rpcData, error } = await supabase.rpc(summary.rpc, {
            p_range: range,
            p_from: fromTs,
            p_to: toTs,
          });
          if (error) {
            throw new ListingError('LISTING_INTERNAL_ERROR', `Summary RPC failed: ${error.message}`);
          }
          return rpcData as Record<string, unknown>;
        });

        return {
          status: 200,
          body: { computedAt: new Date().toISOString(), cacheHit, data },
        };
      } catch (err) {
        if (err instanceof ListingError) {
          return { status: err.httpStatus, body: err.toEnvelope() };
        }
        return {
          status: 500,
          body: {
            error: {
              code: 'LISTING_INTERNAL_ERROR',
              message: err instanceof Error ? err.message : String(err),
            },
          },
        };
      }
    },
  };
}
