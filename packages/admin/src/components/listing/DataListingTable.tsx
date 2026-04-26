/**
 * Shared admin listing table per spec-platform-listing-pattern.md §15.1.
 *
 * Wraps the platform's existing styled <DataTable> + <Pagination> stack
 * so every consumer of the listing pattern matches the rest of the
 * admin app's look-and-feel (Radix Table + brand colour tokens). Each
 * schema can override table density / card wrap via adminTableStyle.
 */

import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';

import {
  type AdminDisplayColumn,
  type ListingSchema,
} from '@gatewaze/shared/listing';
import {
  Card,
  Pagination,
  PaginationFirst,
  PaginationItems,
  PaginationLast,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui';
import { DataTable } from '@/components/shared/table/DataTable';
import { RowActions, type RowAction } from '@/components/shared/table/RowActions';
import { useListingQuery } from './useListingQuery';

type Row = Record<string, unknown>;

export interface DataListingTableProps {
  schema: ListingSchema;
  /** Path of the listing endpoint (e.g. '/api/admin/events/list'). */
  endpoint: string;
  /** Optional row-action menu rendered in a right-edge column. */
  rowActions?: (row: Row) => RowAction[];
  /** Optional double-click handler — receives the row. */
  onRowDoubleClick?: (row: Row) => void;
  /** Optional empty-state node. */
  emptyState?: ReactNode;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export function DataListingTable({
  schema,
  endpoint,
  rowActions,
  onRowDoubleClick,
  emptyState,
}: DataListingTableProps) {
  const cols = schema.displayColumns?.admin ?? [];
  const style = schema.adminTableStyle ?? {};

  const {
    query,
    setQuery,
    rows,
    totalCount,
    totalCountEstimate,
    countStrategy,
    page,
    pageSize,
    isLoading,
    error,
  } = useListingQuery<Row>({ schema, endpoint });

  // Local mirror of the search input so typing doesn't fire an HTTP
  // request on every keystroke.
  const [searchDraft, setSearchDraft] = useState(query.search ?? '');
  useEffect(() => {
    setSearchDraft(query.search ?? '');
  }, [query.search]);

  const flushSearch = () => {
    const trimmed = searchDraft.trim();
    setQuery({ search: trimmed === '' ? undefined : trimmed, page: 0 });
  };

  // ── Build tanstack columns from the schema's displayColumns ─────────────
  const tanstackColumns = useMemo(() => {
    const helper = createColumnHelper<Row>();
    const built = cols.map((col) =>
      helper.display({
        id: col.key,
        header: col.header,
        enableSorting: !!schema.sortable[col.key],
        cell: ({ row }) => renderCell(row.original, col),
      })
    );
    if (rowActions) {
      built.push(
        helper.display({
          id: '__row_actions__',
          header: '',
          enableSorting: false,
          cell: ({ row }) => (
            <div className="flex justify-end">
              <RowActions actions={rowActions(row.original)} />
            </div>
          ),
        })
      );
    }
    return built;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, rowActions]);

  // ── tanstack sorting state mirrored from the URL ────────────────────────
  const sorting: SortingState = useMemo(
    () =>
      query.sort
        ? [{ id: query.sort.column, desc: query.sort.direction === 'desc' }]
        : [],
    [query.sort]
  );

  const pageCount =
    totalCount !== null ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;

  const table = useReactTable<Row>({
    data: rows,
    columns: tanstackColumns,
    state: {
      sorting,
      pagination: { pageIndex: page, pageSize },
    },
    pageCount,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      if (next.length === 0) {
        setQuery({ sort: undefined, page: 0 });
        return;
      }
      const first = next[0];
      setQuery({
        sort: { column: first.id, direction: first.desc ? 'desc' : 'asc' },
        page: 0,
      });
    },
    onPaginationChange: (updater) => {
      const prev = { pageIndex: page, pageSize };
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const patch: { page?: number; pageSize?: number } = {};
      if (next.pageIndex !== prev.pageIndex) patch.page = next.pageIndex;
      if (next.pageSize !== prev.pageSize) {
        patch.pageSize = next.pageSize;
        patch.page = 0;
      }
      if (Object.keys(patch).length > 0) setQuery(patch);
    },
    getCoreRowModel: getCoreRowModel(),
  });

  const totalDisplay = formatTotalCount(totalCount, totalCountEstimate, countStrategy);
  const fromRow = page * pageSize + 1;
  const toRow = page * pageSize + rows.length;

  const useCardWrap = style.card !== false;
  const Wrapper: React.FC<{ children: ReactNode }> = useCardWrap
    ? ({ children }) => <Card className="p-0 overflow-hidden">{children}</Card>
    : ({ children }) => <div className="overflow-hidden">{children}</div>;

  return (
    <div className="space-y-3" data-density={style.density ?? 'comfortable'}>
      {/* ── Top bar: search + reset + total ──────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        {schema.searchable.length > 0 && (
          <input
            type="text"
            value={searchDraft}
            placeholder={`Search ${schema.searchable.join(', ')}…`}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && flushSearch()}
            onBlur={flushSearch}
            className="px-3 py-1.5 text-sm rounded-md border border-[var(--gray-a6)] bg-[var(--gray-a2)] text-[var(--gray-12)] placeholder-[var(--gray-a8)] min-w-[280px]"
          />
        )}

        {(query.search || query.sort) && (
          <button
            onClick={() => {
              setSearchDraft('');
              setQuery({ search: undefined, sort: undefined, page: 0 });
            }}
            className="px-2 py-1 text-xs rounded-md text-[var(--gray-a9)] hover:text-[var(--gray-12)] hover:bg-[var(--gray-a3)]"
          >
            Reset
          </button>
        )}

        <div className="ml-auto text-xs text-[var(--gray-a9)]">{totalDisplay} total</div>
      </div>

      {/* ── Error surface ────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          <strong>{error.code}</strong>: {error.message}
        </div>
      )}

      <Wrapper>
        <DataTable
          table={table}
          loading={isLoading}
          emptyState={emptyState ?? 'No results'}
          onRowDoubleClick={onRowDoubleClick}
        />

        {/* Pagination footer — matches legacy events page layout. */}
        {rows.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--gray-a5)]">
            <div className="flex items-center gap-4">
              <span className="text-sm text-[var(--gray-11)]">
                <span className="font-semibold text-[var(--gray-12)]">
                  {fromRow.toLocaleString()}
                </span>
                <span className="mx-1">-</span>
                <span className="font-semibold text-[var(--gray-12)]">
                  {toRow.toLocaleString()}
                </span>
                <span className="mx-1">of</span>
                <span className="font-semibold text-[var(--gray-12)]">{totalDisplay}</span>
              </span>
              <select
                value={String(pageSize)}
                onChange={(e) => setQuery({ pageSize: Number(e.target.value), page: 0 })}
                className="px-3 py-1.5 text-sm bg-[var(--gray-a2)] border border-[var(--gray-a5)] rounded-lg focus:ring-2 focus:ring-[var(--accent-8)] cursor-pointer"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
            </div>

            <Pagination
              total={pageCount}
              value={page + 1}
              onChange={(nextPage) => setQuery({ page: nextPage - 1 })}
              className="flex items-center gap-1"
            >
              <PaginationFirst
                onClick={() => setQuery({ page: 0 })}
                disabled={page === 0 || isLoading}
              />
              <PaginationPrevious
                onClick={() => setQuery({ page: Math.max(0, page - 1) })}
                disabled={page === 0 || isLoading}
              />
              <PaginationItems />
              <PaginationNext
                onClick={() => setQuery({ page: page + 1 })}
                disabled={page >= pageCount - 1 || isLoading}
              />
              <PaginationLast
                onClick={() => setQuery({ page: pageCount - 1 })}
                disabled={page >= pageCount - 1 || isLoading}
              />
            </Pagination>
          </div>
        )}
      </Wrapper>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Cell renderer — dispatches on AdminDisplayColumn.kind.
// ----------------------------------------------------------------------------

function renderCell(row: Row, col: AdminDisplayColumn): ReactNode {
  const value = row[col.key];

  // Image kind always renders even on null (shows a placeholder).
  if (col.kind === 'image') {
    return renderImage(row, value, col);
  }

  if (value === undefined || value === null || value === '') {
    return <span className="text-[var(--gray-a8)]">—</span>;
  }

  switch (col.kind) {
    case 'text':
      return <span className="text-[var(--gray-12)]">{String(value)}</span>;

    case 'date': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return <span>{String(value)}</span>;
      const formatted =
        col.format === 'date'
          ? d.toLocaleDateString()
          : col.format === 'relative'
          ? formatRelative(d)
          : d.toLocaleString();
      return (
        <span className="text-[var(--gray-12)] whitespace-nowrap" title={d.toISOString()}>
          {formatted}
        </span>
      );
    }

    case 'link': {
      const to = col.to(row);
      const label = col.label ? col.label(row) : String(value);
      return (
        <Link
          to={to}
          className="text-[var(--accent-11)] hover:text-[var(--accent-12)] hover:underline font-medium"
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </Link>
      );
    }

    case 'boolean':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
            value
              ? 'bg-green-500/15 text-green-300 border-green-500/30'
              : 'bg-[var(--gray-a4)] text-[var(--gray-a11)] border-[var(--gray-a5)]'
          }`}
        >
          {value ? col.trueLabel ?? 'Yes' : col.falseLabel ?? 'No'}
        </span>
      );

    case 'number': {
      const n = Number(value);
      if (Number.isNaN(n)) return <span>{String(value)}</span>;
      const fmt = col.format ?? 'integer';
      const formatted =
        fmt === 'currency'
          ? n.toLocaleString(col.locale ?? 'en-US', { style: 'currency', currency: 'USD' })
          : fmt === 'percent'
          ? `${(n * 100).toFixed(1)}%`
          : fmt === 'decimal'
          ? n.toLocaleString(col.locale, { maximumFractionDigits: 2 })
          : n.toLocaleString(col.locale);
      return <span className="text-[var(--gray-12)] tabular-nums">{formatted}</span>;
    }

    case 'enum-badge': {
      const colour = col.colors[String(value)] ?? 'gray';
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${enumBadgeColours[colour]}`}
        >
          {String(value)}
        </span>
      );
    }

    case 'json': {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return col.preview === 'inline' ? (
        <code className="text-xs text-[var(--gray-11)]">{text.slice(0, 80)}</code>
      ) : (
        <details>
          <summary className="cursor-pointer text-xs text-[var(--gray-a9)]">view</summary>
          <pre className="mt-1 text-xs">{text}</pre>
        </details>
      );
    }

    case 'custom':
      return col.render(row);
  }
}

function renderImage(
  row: Row,
  value: unknown,
  col: AdminDisplayColumn & { kind: 'image' }
): ReactNode {
  const size = col.size ?? 40;
  const rounded = col.shape === 'circle' ? 'rounded-full' : 'rounded-md';
  const src = typeof value === 'string' && value.length > 0 ? value : null;
  const alt = col.alt ? col.alt(row) : '';

  if (!src) {
    return (
      <div
        className={`bg-[var(--gray-a4)] ${rounded} flex items-center justify-center text-[var(--gray-a8)] text-[10px]`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        —
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      className={`object-cover ${rounded} bg-[var(--gray-a3)]`}
      style={{ width: size, height: size }}
      onError={(e) => {
        // Hide broken images cleanly so the placeholder doesn't fill the cell.
        (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
      }}
    />
  );
}

const enumBadgeColours: Record<string, string> = {
  green: 'bg-green-500/15 text-green-300 border-green-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
  blue: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  gray: 'bg-[var(--gray-a4)] text-[var(--gray-a11)] border-[var(--gray-a5)]',
  purple: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
};

function formatTotalCount(
  totalCount: number | null,
  estimate: number | undefined,
  strategy: 'exact' | 'estimated' | 'planned' | undefined
): string {
  const n = totalCount ?? estimate;
  if (n === undefined || n === null) return '—';
  const formatted = n.toLocaleString();
  if (strategy === 'estimated' || strategy === 'planned') return `~${formatted}`;
  return formatted;
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (abs < min) return 'just now';
  if (abs < hr) return `${Math.round(abs / min)}m ${diff > 0 ? 'ago' : ''}`.trim();
  if (abs < day) return `${Math.round(abs / hr)}h ${diff > 0 ? 'ago' : ''}`.trim();
  return d.toLocaleDateString();
}
