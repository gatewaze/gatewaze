/**
 * Generic portal listing API route handler.
 *
 * One factory wraps the platform's `buildListingQuery()` for the portal
 * consumer. The dynamic `[module]` route file looks up the registered
 * schema and delegates to this handler.
 */

import { type NextRequest, NextResponse } from 'next/server';
import {
  ListingError,
  type ListingSchema,
  type HandlerContext,
  buildListingQuery,
  buildListingCount,
  listingQueryFromSearchParams,
  roundedNowIsoBucket,
} from '@gatewaze/shared/listing';
import { createServerSupabase } from '@/lib/supabase/server';
import { getServerBrand, getBrandConfigById } from '@/config/brand';
import { resolveEventImagesList } from '@/lib/storage-resolve';

const TS_TOLERANCE_MS = 24 * 60 * 60 * 1000;

function isValidSnapshotTs(raw: string): boolean {
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  const drift = Math.abs(t - Date.now());
  return drift <= TS_TOLERANCE_MS;
}

function errorResponse(code: string, message: string, httpStatus: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: httpStatus });
}

interface CreatePortalListingApiRouteOpts {
  schema: ListingSchema;
}

export function createPortalListingApiRoute({ schema }: CreatePortalListingApiRouteOpts) {
  return async function handler(req: NextRequest): Promise<NextResponse> {
    try {
      if (!schema.projections.portal || schema.projections.portal.length === 0) {
        return errorResponse(
          'LISTING_NOT_FOUND',
          `Listing '${schema.id}' has no portal projection`,
          404,
        );
      }

      const tsParam = req.nextUrl.searchParams.get('ts');
      const pageRaw = req.nextUrl.searchParams.get('page');
      const pageNumber = pageRaw === null ? 0 : Number.parseInt(pageRaw, 10);
      if (Number.isNaN(pageNumber) || pageNumber < 0) {
        return errorResponse('INVALID_PAGE', `page must be a non-negative integer`, 400);
      }

      if (pageNumber > 0 && !tsParam) {
        return errorResponse(
          'MISSING_TS_FOR_PAGINATION',
          'ts is required for pages after the first',
          400,
        );
      }
      if (tsParam && !isValidSnapshotTs(tsParam)) {
        return errorResponse(
          'INVALID_TS',
          'ts must be a valid ISO 8601 timestamp within ±24h of now',
          400,
        );
      }
      const ts = tsParam ?? roundedNowIsoBucket(60_000);

      const brandId = await getServerBrand();
      const supabase = await createServerSupabase(brandId);

      const query = listingQueryFromSearchParams(req.nextUrl.searchParams, schema);

      const ctx: HandlerContext = {
        consumer: 'portal',
        brandId,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0',
        headers: Object.fromEntries(req.headers.entries()),
        requestId: req.headers.get('x-request-id') ?? cryptoRandomId(),
        extras: { 'listing.ts': ts },
      };

      const result = await buildListingQuery({
        schema,
        consumer: 'portal',
        query,
        ctx,
        supabase,
      });

      // Per-module row transforms. The events schema returns raw column
      // values (e.g. `event_logo: "event-logos/abc.jpg"` — bare storage
      // paths), but <next/image> on the client requires absolute URLs or
      // leading-slash paths. Resolve here before serialisation so the
      // SSR initial page (resolved at the page level) and the infinite-
      // scroll fetches (resolved here) emit the same shape.
      let rows: unknown[] = result.rows;
      if (schema.id === 'events') {
        const brandConfig = await getBrandConfigById(brandId);
        rows = resolveEventImagesList(rows, brandConfig.storageBucketUrl);
      }

      const responseBody = {
        rows,
        page: result.page,
        pageSize: result.pageSize,
        totalCount: result.totalCount,
        totalCountEstimate: result.totalCountEstimate,
        countStrategy: result.countStrategy,
        ts,
      };

      return NextResponse.json(responseBody, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          'Vary': 'Host, Accept-Encoding',
        },
      });
    } catch (err) {
      if (err instanceof ListingError) {
        return NextResponse.json(err.toEnvelope(), { status: err.httpStatus });
      }
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: { code: 'LISTING_INTERNAL_ERROR', message } },
        { status: 500 },
      );
    }
  };
}

/**
 * Optional companion factory: returns a count-only handler. Not currently
 * used (counts come from the SSR-side `loader.count()` call), but exposed
 * here so future client-side count refresh paths can mount it.
 */
export function createPortalListingCountRoute({ schema }: CreatePortalListingApiRouteOpts) {
  return async function handler(req: NextRequest): Promise<NextResponse> {
    try {
      if (!schema.projections.portal || schema.projections.portal.length === 0) {
        return errorResponse(
          'LISTING_NOT_FOUND',
          `Listing '${schema.id}' has no portal projection`,
          404,
        );
      }
      const tsParam = req.nextUrl.searchParams.get('ts');
      if (tsParam && !isValidSnapshotTs(tsParam)) {
        return errorResponse('INVALID_TS', 'ts must be a valid ISO 8601 timestamp within ±24h of now', 400);
      }
      const ts = tsParam ?? roundedNowIsoBucket(60_000);

      const brandId = await getServerBrand();
      const supabase = await createServerSupabase(brandId);
      const query = listingQueryFromSearchParams(req.nextUrl.searchParams, schema);
      const ctx: HandlerContext = {
        consumer: 'portal',
        brandId,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0',
        headers: Object.fromEntries(req.headers.entries()),
        requestId: req.headers.get('x-request-id') ?? cryptoRandomId(),
        extras: { 'listing.ts': ts },
      };

      const result = await buildListingCount({
        schema,
        consumer: 'portal',
        query,
        ctx,
        supabase,
      });

      return NextResponse.json(
        { count: result.count, countStrategy: result.countStrategy, ts },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
            'Vary': 'Host, Accept-Encoding',
          },
        },
      );
    } catch (err) {
      if (err instanceof ListingError) {
        return NextResponse.json(err.toEnvelope(), { status: err.httpStatus });
      }
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: { code: 'LISTING_INTERNAL_ERROR', message } },
        { status: 500 },
      );
    }
  };
}

function cryptoRandomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `r${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
