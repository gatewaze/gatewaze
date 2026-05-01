'use client';

/**
 * Generic infinite-scroll list wrapper for portal listing-pattern consumers.
 *
 * Hosts the `usePortalInfiniteListing` hook, the IntersectionObserver
 * sentinel, the polite ARIA live region, and the `MAX_ACCUMULATED_ROWS`
 * cap UX. Consumers supply `renderRow` (per-row JSX) and `renderEmpty`
 * (state when SSR returned 0 rows).
 *
 * Note: this v1 implementation does NOT virtualise the DOM. The platform
 * spec calls for `@tanstack/react-virtual` once the typical event card
 * height is stable; we leave the dependency available and a TODO marker
 * here so the migration is mechanical. With the 5000-row cap and event
 * cards being relatively cheap, an unvirtualised render is acceptable
 * for v1.
 */

import { useMemo } from 'react';
import {
  usePortalInfiniteListing,
  type UsePortalInfiniteListingOpts,
} from '@/lib/listing/usePortalInfiniteListing';
import { MAX_ACCUMULATED_ROWS } from '@/lib/listing/constants';

interface PortalInfiniteListProps<Row> extends UsePortalInfiniteListingOpts<Row> {
  /** Per-row renderer. */
  renderRow: (row: Row, index: number, all: Row[]) => React.ReactNode;
  /** Optional grouped renderer — when supplied, replaces the flat list output. */
  renderRows?: (rows: Row[]) => React.ReactNode;
  /** UI when the SSR'd page is empty. */
  renderEmpty: (opts: { hasFilters: boolean }) => React.ReactNode;
  /** Active filter chips / extra controls rendered above the list. */
  header?: React.ReactNode;
  /** Whether any filters are currently active (for the empty-state copy). */
  hasFilters?: boolean;
  /** Extra classNames for the outer wrapper. */
  className?: string;
  /** Override the default sentinel copy ("Loading more events…"). */
  loadingLabel?: string;
  /** Override the end-of-list copy. */
  endOfListLabel?: string;
  /** Override the cap-reached copy. */
  capReachedLabel?: string;
}

export function PortalInfiniteList<Row>(props: PortalInfiniteListProps<Row>) {
  const {
    renderRow,
    renderRows,
    renderEmpty,
    header,
    hasFilters = false,
    className,
    loadingLabel = 'Loading more…',
    endOfListLabel = 'End of list',
    capReachedLabel,
    ...hookOpts
  } = props;

  const {
    rows,
    isLoading,
    hasMore,
    error,
    capReached,
    sentinelRef,
    loadMore,
  } = usePortalInfiniteListing(hookOpts);

  const isInitiallyEmpty = rows.length === 0 && !isLoading && !error;

  const capCopy = useMemo(() => {
    if (capReachedLabel) return capReachedLabel;
    return `Showing first ${MAX_ACCUMULATED_ROWS.toLocaleString()} results — refine your filters (try search) to see more.`;
  }, [capReachedLabel]);

  return (
    <div className={className}>
      {header}

      {isInitiallyEmpty ? (
        renderEmpty({ hasFilters })
      ) : renderRows ? (
        renderRows(rows)
      ) : (
        <div>
          {rows.map((row, index) => renderRow(row, index, rows))}
        </div>
      )}

      <div
        ref={sentinelRef}
        role="status"
        aria-live="polite"
        aria-busy={isLoading}
        className="min-h-[3rem] flex items-center justify-center py-6 text-sm text-white/60"
      >
        {error ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <span>Couldn&apos;t load more.</span>
            <button
              type="button"
              onClick={loadMore}
              className="cursor-pointer px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white bg-white/10 hover:bg-white/15 transition-colors"
              style={{ borderRadius: 'var(--radius-control)' }}
            >
              Retry
            </button>
          </div>
        ) : isLoading ? (
          <span className="flex items-center gap-2">
            <Spinner />
            <span>{loadingLabel}</span>
          </span>
        ) : capReached ? (
          <span className="text-white/50">{capCopy}</span>
        ) : !hasMore && rows.length > 0 ? (
          <span className="text-white/40">{endOfListLabel}</span>
        ) : null}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 text-white/60 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
