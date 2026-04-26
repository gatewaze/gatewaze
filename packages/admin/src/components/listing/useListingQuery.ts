/**
 * Hook for the admin <DataListingTable> + any other consumer of the
 * shared listing API. Owns URL state, fetches a page on every state
 * change, surfaces loading + error.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  listingQueryFromSearchParams,
  listingQueryToSearchParams,
  type ListingQuery,
  type ListingResult,
  type ListingSchema,
} from '@gatewaze/shared/listing';

export interface UseListingQueryOptions {
  schema: ListingSchema;
  /** Path of the listing endpoint (e.g. '/api/admin/events/list'). */
  endpoint: string;
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

  const apiBaseUrl = import.meta.env.VITE_API_URL ?? '';
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    const seq = ++fetchSeqRef.current;
    setIsLoading(true);
    setError(null);

    const url = `${apiBaseUrl}${opts.endpoint}?${searchParams.toString()}`;

    fetch(url)
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

  const setQuery: UseListingQueryResult['setQuery'] = (next) => {
    const computed = typeof next === 'function' ? next(query) : next;
    const merged: ListingQuery = { ...query, ...computed };
    setSearchParams(listingQueryToSearchParams(merged, searchParams));
  };

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
  };
}
