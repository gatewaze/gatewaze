'use client';

/**
 * Client hook backing the portal infinite-scroll listing.
 *
 * Behaviour per spec-portal-listing-infinite-scroll.md §6:
 * - Initialises from SSR `initialPage` (no fetch on mount).
 * - Resets accumulated rows when `initialPage` identity changes (URL nav).
 * - IntersectionObserver on the sentinel triggers `loadMore()`.
 * - Concurrent loads are aborted via AbortController + epoch guard.
 * - Echoes `ts` and `pageSize` from SSR on every subsequent fetch.
 * - Hard memory cap at MAX_ACCUMULATED_ROWS.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ListingQuery, ListingSchema } from '@gatewaze/shared/listing';
import {
  MAX_ACCUMULATED_ROWS,
  SENTINEL_ROOT_MARGIN,
} from './constants';

export interface PortalInitialPage<Row> {
  rows: Row[];
  page: number;
  pageSize: number;
  totalCount: number | null;
  totalCountEstimate?: number;
  countStrategy: 'exact' | 'estimated' | 'planned';
  ts: string;
}

export interface UsePortalInfiniteListingOpts<Row> {
  /** Module id; matches the `[module]` segment in the API route. */
  module: string;
  /** Full schema — needed for primaryKey + URL serialisation. */
  schema: ListingSchema;
  /** SSR'd first page. */
  initialPage: PortalInitialPage<Row>;
  /**
   * The ListingQuery the SSR page used. Echoed back to the API on
   * subsequent pages so filters/sort/search compose correctly. The
   * hook does NOT mutate query state — filter changes are URL changes,
   * which trigger fresh SSR + a new `initialPage`.
   */
  query: ListingQuery;
}

export interface UsePortalInfiniteListingResult<Row> {
  rows: Row[];
  totalCount: number | null;
  countStrategy: 'exact' | 'estimated' | 'planned';
  hasMore: boolean;
  isLoading: boolean;
  error: Error | null;
  capReached: boolean;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  loadMore: () => void;
  reset: () => void;
}

interface FetchResponse<Row> {
  rows: Row[];
  page: number;
  pageSize: number;
  totalCount: number | null;
  totalCountEstimate?: number;
  countStrategy: 'exact' | 'estimated' | 'planned';
  ts: string;
}

export function usePortalInfiniteListing<Row>(
  opts: UsePortalInfiniteListingOpts<Row>,
): UsePortalInfiniteListingResult<Row> {
  const { module: moduleId, schema, initialPage, query } = opts;
  const { primaryKey } = schema;

  const initialRowKey = useMemo(
    () =>
      initialPage.rows
        .map((r) => String((r as Record<string, unknown>)[primaryKey] ?? ''))
        .join(','),
    [initialPage.rows, primaryKey],
  );

  const [rows, setRows] = useState<Row[]>(initialPage.rows);
  const [nextPage, setNextPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(
    computeHasMore(initialPage.rows.length, initialPage.pageSize, initialPage.totalCount),
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [capReached, setCapReached] = useState<boolean>(false);
  const [totalCount, setTotalCount] = useState<number | null>(initialPage.totalCount);
  const [countStrategy, setCountStrategy] = useState<'exact' | 'estimated' | 'planned'>(
    initialPage.countStrategy,
  );

  const epochRef = useRef<number>(0);
  const inflightRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset on filter/SSR change. Use a stable identity (ts + page + pageSize + row ids)
  // rather than referential identity on `initialPage`, which Next.js may reissue per render.
  useEffect(() => {
    epochRef.current += 1;
    if (inflightRef.current) {
      inflightRef.current.abort();
      inflightRef.current = null;
    }
    setRows(initialPage.rows);
    setNextPage(1);
    setHasMore(computeHasMore(initialPage.rows.length, initialPage.pageSize, initialPage.totalCount));
    setIsLoading(false);
    setError(null);
    setCapReached(false);
    setTotalCount(initialPage.totalCount);
    setCountStrategy(initialPage.countStrategy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPage.ts, initialPage.page, initialPage.pageSize, initialRowKey]);

  const loadMore = useCallback(() => {
    if (isLoading || !hasMore || capReached) return;
    if (rows.length >= MAX_ACCUMULATED_ROWS) {
      setCapReached(true);
      setHasMore(false);
      return;
    }

    const epoch = epochRef.current;
    const controller = new AbortController();
    inflightRef.current?.abort();
    inflightRef.current = controller;

    const url = buildFetchUrl(moduleId, query, {
      page: nextPage,
      pageSize: initialPage.pageSize,
      ts: initialPage.ts,
    });

    setIsLoading(true);
    setError(null);

    fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) {
          const body = await safeReadJson(res);
          const message = body?.error?.message ?? `Request failed: ${res.status}`;
          throw new Error(message);
        }
        return (await res.json()) as FetchResponse<Row>;
      })
      .then((body) => {
        if (epoch !== epochRef.current) return;
        const incoming = body.rows ?? [];
        const merged = [...rows, ...incoming];
        const trimmed = merged.length > MAX_ACCUMULATED_ROWS
          ? merged.slice(0, MAX_ACCUMULATED_ROWS)
          : merged;
        const reachedCap = trimmed.length >= MAX_ACCUMULATED_ROWS;
        const more = !reachedCap && computeHasMore(incoming.length, body.pageSize, body.totalCount, trimmed.length);
        setRows(trimmed);
        setNextPage((p) => p + 1);
        setHasMore(more);
        setCapReached(reachedCap);
        setTotalCount(body.totalCount ?? totalCount);
        setCountStrategy(body.countStrategy ?? countStrategy);
        setIsLoading(false);
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        if (epoch !== epochRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, hasMore, capReached, rows, nextPage, initialPage.pageSize, initialPage.ts, moduleId, query, totalCount, countStrategy]);

  const reset = useCallback(() => {
    epochRef.current += 1;
    inflightRef.current?.abort();
    inflightRef.current = null;
    setRows(initialPage.rows);
    setNextPage(1);
    setHasMore(computeHasMore(initialPage.rows.length, initialPage.pageSize, initialPage.totalCount));
    setIsLoading(false);
    setError(null);
    setCapReached(false);
    setTotalCount(initialPage.totalCount);
    setCountStrategy(initialPage.countStrategy);
  }, [initialPage]);

  // Sentinel observer.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasMore || capReached) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loadMore();
            break;
          }
        }
      },
      { rootMargin: SENTINEL_ROOT_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, hasMore, capReached]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      inflightRef.current?.abort();
    };
  }, []);

  return {
    rows,
    totalCount,
    countStrategy,
    hasMore,
    isLoading,
    error,
    capReached,
    sentinelRef,
    loadMore,
    reset,
  };
}

function computeHasMore(
  pageRows: number,
  pageSize: number,
  totalCount: number | null,
  accumulated?: number,
): boolean {
  if (pageRows < pageSize) return false;
  if (totalCount === null) return pageRows >= pageSize;
  const have = accumulated ?? pageRows;
  return have < totalCount;
}

function buildFetchUrl(
  moduleId: string,
  query: ListingQuery,
  pageOpts: { page: number; pageSize: number; ts: string },
): string {
  const params = new URLSearchParams();
  params.set('page', String(pageOpts.page));
  params.set('pageSize', String(pageOpts.pageSize));
  params.set('ts', pageOpts.ts);
  if (query.sort) {
    params.set('sort', query.sort.column);
    params.set('dir', query.sort.direction);
  }
  if (query.search) params.set('q', query.search);
  if (query.filters) {
    for (const [key, value] of Object.entries(query.filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const v of value) params.append(key, String(v));
      } else if (typeof value === 'object') {
        if ('from' in value && 'to' in value) {
          const r = value as { from: string; to: string };
          params.set(`${key}.from`, r.from);
          params.set(`${key}.to`, r.to);
        }
      } else {
        params.set(key, String(value));
      }
    }
  }
  return `/api/portal/listing/${encodeURIComponent(moduleId)}?${params.toString()}`;
}

async function safeReadJson(res: Response): Promise<{ error?: { code?: string; message?: string } } | null> {
  try {
    return (await res.json()) as { error?: { code?: string; message?: string } };
  } catch {
    return null;
  }
}
