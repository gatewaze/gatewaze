/**
 * Hook for the admin <DataListingTable> + any other consumer of the
 * shared listing API. Owns URL state, fetches a page on every state
 * change, surfaces loading + error, plus selection state for bulk
 * operations (page-mode + matching-filter mode per spec §23.3).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  listingQueryFromSearchParams,
  listingQueryToSearchParams,
  type ListingQuery,
  type ListingResult,
  type ListingSchema,
} from '@gatewaze/shared/listing';
import { supabase } from '@/lib/supabase';

export interface UseListingQueryOptions {
  schema: ListingSchema;
  /** Path of the listing endpoint (e.g. '/api/admin/events/list'). */
  endpoint: string;
}

/**
 * Selection state per spec-platform-listing-pattern.md §23.3.
 *
 * `mode === 'page'`: ids holds the explicitly-checked rows on the
 * current page. Bulk actions iterate ids.
 *
 * `mode === 'matchingFilter'`: the user opted into "select all matching
 * filter" — bulk actions should send the current ListingQuery as the
 * server-side filter spec (without page/pageSize) and let the API
 * resolve the affected rows.
 */
export interface ListingSelection {
  mode: 'none' | 'page' | 'matchingFilter';
  ids: ReadonlySet<string>;
  /** Total selected; for matchingFilter mode equals totalCount. */
  count: number;
}

export interface UseListingQueryResult<Row = Record<string, unknown>> {
  query: ListingQuery;
  setQuery: (next: Partial<ListingQuery> | ((prev: ListingQuery) => Partial<ListingQuery>)) => void;
  rows: Row[];
  totalCount: number | null;
  totalCountEstimate?: number;
  countStrategy: 'exact' | 'estimated' | 'planned' | undefined;
  page: number;
  pageSize: number;
  isLoading: boolean;
  error: { code: string; message: string } | null;
  refresh: () => void;

  // Selection
  selection: ListingSelection;
  isRowSelected: (id: string) => boolean;
  toggleRow: (id: string) => void;
  selectAllOnPage: () => void;
  clearSelection: () => void;
  /** Promote page-mode selection to "all matching the current filter". */
  selectAllMatching: () => void;
  /** True when every row on the current page has its id in the selection. */
  isPageFullySelected: boolean;
}

/**
 * True when `url` resolves to the same origin as the configured API base.
 *
 * The bearer token must never leave our own API origin. `Authorization` is not
 * a forbidden header, so if `opts.endpoint` ever resolved somewhere else — an
 * absolute URL, a protocol-relative `//host`, or a caller building the path
 * from route input — the browser would happily send the session token there,
 * and a server answering the CORS preflight with a matching
 * `Access-Control-Allow-Headers: Authorization` would capture it. Every current
 * caller passes a literal `/api/admin/...` path, so this only ever fires on a
 * future mistake; that is exactly when it needs to hold.
 */
function isOwnApiOrigin(url: string, apiBaseUrl: string): boolean {
  try {
    const pageOrigin = window.location.origin;
    // An empty VITE_API_URL means "same origin as the admin app".
    const expected = new URL(apiBaseUrl || pageOrigin, pageOrigin).origin;
    return new URL(url, pageOrigin).origin === expected;
  } catch {
    return false;
  }
}

/**
 * GET a listing endpoint with the caller's Supabase access token attached.
 * `getSession()` reads the cached session and only hits the network when the
 * token is due for refresh, so this stays cheap on every query change.
 */
async function listingFetch(url: string, apiBaseUrl: string): Promise<Response> {
  const headers = new Headers();
  if (isOwnApiOrigin(url, apiBaseUrl)) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.set('Authorization', `Bearer ${token}`);
    } catch {
      // No session, or the auth client is unhealthy. Let the request go out
      // unauthenticated so the caller sees the server's 401 rather than a
      // NETWORK_ERROR that hides which half actually failed.
    }
  }
  return fetch(url, { headers });
}

export function useListingQuery<Row = Record<string, unknown>>(
  opts: UseListingQueryOptions
): UseListingQueryResult<Row> {
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useMemo(
    () => listingQueryFromSearchParams(searchParams, opts.schema),
    [searchParams, opts.schema]
  );

  const [rows, setRows] = useState<Row[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [totalCountEstimate, setTotalCountEstimate] = useState<number | undefined>(undefined);
  const [countStrategy, setCountStrategy] = useState<'exact' | 'estimated' | 'planned' | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Selection state lives outside the URL — it's per-tab transient state.
  const [selectionMode, setSelectionMode] = useState<ListingSelection['mode']>('none');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const apiBaseUrl = import.meta.env.VITE_API_URL ?? '';
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    const seq = ++fetchSeqRef.current;
    setIsLoading(true);
    setError(null);

    const url = `${apiBaseUrl}${opts.endpoint}?${searchParams.toString()}`;

    // Listing endpoints live under /api/admin/* and are JWT-gated, so the
    // caller's Supabase session token has to travel with the request — the
    // same pattern every other admin service uses (see navLayoutService).
    // Without it the API answers 401 and the table renders empty.
    listingFetch(url, apiBaseUrl)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (seq !== fetchSeqRef.current) return; // stale
        if (!res.ok) {
          setError({
            code: (body?.error?.code as string) ?? `HTTP_${res.status}`,
            message: (body?.error?.message as string) ?? `Request failed (${res.status})`,
          });
          setRows([]);
          setTotalCount(null);
          setCountStrategy(undefined);
          return;
        }
        const result = body as ListingResult<Row>;
        setRows(result.rows ?? []);
        setTotalCount(result.totalCount);
        setTotalCountEstimate(result.totalCountEstimate);
        setCountStrategy(result.countStrategy);
      })
      .catch((e: unknown) => {
        if (seq !== fetchSeqRef.current) return;
        setError({
          code: 'NETWORK_ERROR',
          message: e instanceof Error ? e.message : String(e),
        });
      })
      .finally(() => {
        if (seq === fetchSeqRef.current) setIsLoading(false);
      });
  }, [apiBaseUrl, opts.endpoint, searchParams, refreshTick]);

  const setQuery: UseListingQueryResult['setQuery'] = useCallback(
    (next) => {
      const computed = typeof next === 'function' ? next(query) : next;
      const merged: ListingQuery = { ...query, ...computed };
      // Filter changes invalidate matching-filter mode (the count of
      // matching rows just changed). Page-mode selection persists.
      if (selectionMode === 'matchingFilter' && computed.filters !== undefined) {
        setSelectionMode('none');
        setSelectedIds(new Set());
      }
      setSearchParams(listingQueryToSearchParams(merged, opts.schema, searchParams));
    },
    [opts.schema, query, searchParams, selectionMode, setSearchParams]
  );

  // ── Selection helpers ──────────────────────────────────────────────────

  const isRowSelected = useCallback(
    (id: string) => selectionMode === 'matchingFilter' || selectedIds.has(id),
    [selectionMode, selectedIds]
  );

  const toggleRow = useCallback((id: string) => {
    setSelectionMode((prev) => (prev === 'matchingFilter' ? 'page' : prev === 'none' ? 'page' : prev));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllOnPage = useCallback(() => {
    const ids = rows.map((r) => String((r as Record<string, unknown>).id));
    const next = new Set(selectedIds);
    const allOnPage = ids.every((id) => next.has(id));
    if (allOnPage) {
      // Already all selected → deselect them.
      for (const id of ids) next.delete(id);
      setSelectedIds(next);
      if (next.size === 0) setSelectionMode('none');
    } else {
      for (const id of ids) next.add(id);
      setSelectedIds(next);
      setSelectionMode('page');
    }
  }, [rows, selectedIds]);

  const clearSelection = useCallback(() => {
    setSelectionMode('none');
    setSelectedIds(new Set());
  }, []);

  const selectAllMatching = useCallback(() => {
    setSelectionMode('matchingFilter');
    setSelectedIds(new Set()); // ids set is irrelevant in this mode
  }, []);

  const isPageFullySelected = useMemo(() => {
    if (rows.length === 0) return false;
    if (selectionMode === 'matchingFilter') return true;
    return rows.every((r) => selectedIds.has(String((r as Record<string, unknown>).id)));
  }, [rows, selectionMode, selectedIds]);

  const selection: ListingSelection = useMemo(() => {
    if (selectionMode === 'matchingFilter') {
      return { mode: 'matchingFilter', ids: selectedIds, count: totalCount ?? totalCountEstimate ?? 0 };
    }
    return { mode: selectionMode, ids: selectedIds, count: selectedIds.size };
  }, [selectionMode, selectedIds, totalCount, totalCountEstimate]);

  return {
    query,
    setQuery,
    rows,
    totalCount,
    totalCountEstimate,
    countStrategy,
    page: query.page,
    pageSize: query.pageSize,
    isLoading,
    error,
    refresh: () => setRefreshTick((t) => t + 1),
    selection,
    isRowSelected,
    toggleRow,
    selectAllOnPage,
    clearSelection,
    selectAllMatching,
    isPageFullySelected,
  };
}
