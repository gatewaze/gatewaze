import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  ChartBarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  QuestionMarkCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  createColumnHelper,
  type Row,
} from '@tanstack/react-table';
import { Badge, Button, Card } from '@/components/ui';
import { DataTable } from '@/components/shared/table/DataTable';
import { Input } from '@/components/ui/Form/Input';
import { Select } from '@/components/ui/Form/Select';
import { McpAccessService, type McpActivityEntry } from '@/utils/mcpAccessService';

const columnHelper = createColumnHelper<McpActivityEntry>();
const PAGE_SIZE = 50;

const OUTCOME_OPTIONS = [
  { label: 'All outcomes', value: '' },
  { label: 'ok', value: 'ok' },
  { label: 'error', value: 'error' },
  { label: 'unknown_tool', value: 'unknown_tool' },
  { label: 'insufficient_scope', value: 'insufficient_scope' },
];

function OutcomeBadge({ outcome }: { outcome: string }) {
  // ok green, error red, unknown_tool amber, insufficient_scope gray.
  const color =
    outcome === 'ok'
      ? 'green'
      : outcome === 'error'
        ? 'red'
        : outcome === 'unknown_tool'
          ? 'amber'
          : 'gray';
  return (
    <Badge variant="soft" color={color}>
      {outcome}
    </Badge>
  );
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function prettyArgs(args: unknown): string {
  if (args === null || args === undefined) return '(no args)';
  if (typeof args === 'string') {
    try {
      return JSON.stringify(JSON.parse(args), null, 2);
    } catch {
      return args;
    }
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export function McpActivityTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Server-side person filter — set when arriving via "View activity" links
  // from the People tab or the person-detail page.
  const personId = searchParams.get('person_id') ?? undefined;

  const [entries, setEntries] = useState<McpActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Server-side filters
  const [tool, setTool] = useState('');
  const [outcome, setOutcome] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // Client-side filter over the fetched page
  const [personText, setPersonText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await McpAccessService.listActivity({
        person_id: personId,
        tool: tool || undefined,
        outcome: outcome || undefined,
        from: fromDate ? `${fromDate}T00:00:00.000Z` : undefined,
        to: toDate ? `${toDate}T23:59:59.999Z` : undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setEntries(result.data);
      setTotal(result.pagination.total);
      setHasMore(result.pagination.has_more);
    } catch (e) {
      toast.error(`Failed to load activity: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [personId, tool, outcome, fromDate, toDate, offset]);

  useEffect(() => {
    load();
  }, [load]);

  // Distinct tool names seen on the current page keep the dropdown honest
  // without a dedicated tools endpoint; the selected value stays listed even
  // when the current page no longer includes it.
  const toolOptions = useMemo(() => {
    const names = new Set<string>(entries.map((e) => e.tool).filter(Boolean));
    if (tool) names.add(tool);
    return [
      { label: 'All tools', value: '' },
      ...Array.from(names)
        .sort()
        .map((name) => ({ label: name, value: name })),
    ];
  }, [entries, tool]);

  const filteredEntries = useMemo(() => {
    const needle = personText.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (e) =>
        (e.email ?? '').toLowerCase().includes(needle) ||
        (e.person_id ?? '').toLowerCase().includes(needle),
    );
  }, [entries, personText]);

  // Client-side summaries over the currently loaded page.
  const topTools = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      counts.set(entry.tool, (counts.get(entry.tool) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [entries]);

  const unknownTools = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.outcome === 'unknown_tool' && entry.tool && !seen.has(entry.tool)) {
        seen.add(entry.tool);
        names.push(entry.tool);
      }
    }
    return names.slice(0, 8);
  }, [entries]);

  const clearPersonId = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('person_id');
    setSearchParams(next, { replace: true });
    setOffset(0);
  };

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'expand',
        header: '',
        size: 36,
        cell: (info) => (
          <button
            type="button"
            onClick={info.row.getToggleExpandedHandler()}
            className="inline-flex items-center justify-center size-6 rounded text-[var(--gray-a9)] hover:text-[var(--gray-12)] hover:bg-[var(--gray-a3)] cursor-pointer"
            aria-label={info.row.getIsExpanded() ? 'Collapse row' : 'Expand row'}
          >
            {info.row.getIsExpanded() ? (
              <ChevronDownIcon className="size-4" />
            ) : (
              <ChevronRightIcon className="size-4" />
            )}
          </button>
        ),
      }),
      columnHelper.accessor('ts', {
        header: 'Time',
        cell: (info) => (
          <span className="text-sm text-[var(--gray-11)] whitespace-nowrap">
            {formatTs(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('email', {
        header: 'Identity',
        cell: (info) => {
          const entry = info.row.original;
          return (
            <div className="max-w-[14rem]">
              <p className="text-sm text-[var(--gray-12)] truncate">
                {entry.email || entry.identity_kind}
              </p>
              <p className="text-xs text-[var(--gray-11)]">
                {entry.identity_kind}
                {entry.tier ? ` · ${entry.tier}` : ''}
              </p>
            </div>
          );
        },
      }),
      columnHelper.accessor('tool', {
        header: 'Tool',
        cell: (info) => <code className="text-xs font-medium">{info.getValue()}</code>,
      }),
      columnHelper.accessor('outcome', {
        header: 'Outcome',
        cell: (info) => <OutcomeBadge outcome={info.getValue()} />,
      }),
      columnHelper.accessor('client_name', {
        header: 'Client',
        cell: (info) => (
          <span className="text-sm text-[var(--gray-11)] max-w-[10rem] truncate inline-block align-middle">
            {info.getValue() || '—'}
          </span>
        ),
      }),
      columnHelper.accessor('era', {
        header: 'Era',
        cell: (info) => (
          <span className="text-xs text-[var(--gray-11)]">{info.getValue() || '—'}</span>
        ),
      }),
      columnHelper.accessor('ms', {
        header: 'ms',
        cell: (info) => (
          <span className="text-sm text-[var(--gray-11)] tabular-nums">
            {typeof info.getValue() === 'number' ? info.getValue().toLocaleString() : '—'}
          </span>
        ),
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: filteredEntries,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
  });

  const renderSubComponent = (row: Row<McpActivityEntry>) => {
    const entry = row.original;
    return (
      <div className="px-4 py-3 bg-[var(--gray-a2)] space-y-2">
        <div>
          <p className="text-xs font-medium text-[var(--gray-11)] mb-1">Arguments</p>
          <pre className="text-xs bg-[var(--gray-a3)] rounded p-2 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
            {prettyArgs(entry.args)}
          </pre>
        </div>
        {entry.error && (
          <div>
            <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Error</p>
            <pre className="text-xs bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {entry.error}
            </pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--gray-11)] max-w-2xl">
        Every MCP request — who called which tool, with what arguments, and how it went. Retained
        for 90 days.
      </p>

      {/* Summary panels — computed client-side from the current page of results */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-[var(--gray-12)] flex items-center gap-2 mb-2">
            <ChartBarIcon className="size-4" />
            Top tools{' '}
            <span className="text-xs font-normal text-[var(--gray-10)]">(this page)</span>
          </h3>
          {topTools.length === 0 ? (
            <p className="text-xs text-[var(--gray-11)]">No activity loaded.</p>
          ) : (
            <ul className="space-y-1">
              {topTools.map(([name, count]) => (
                <li key={name} className="flex items-center justify-between text-sm">
                  <code className="text-xs">{name}</code>
                  <span className="text-xs text-[var(--gray-11)] tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-[var(--gray-12)] flex items-center gap-2 mb-2">
            <QuestionMarkCircleIcon className="size-4" />
            Recent unknown tools{' '}
            <span className="text-xs font-normal text-[var(--gray-10)]">(this page)</span>
          </h3>
          {unknownTools.length === 0 ? (
            <p className="text-xs text-[var(--gray-11)]">No unknown-tool calls on this page.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {unknownTools.map((name) => (
                <Badge key={name} variant="soft" color="amber">
                  {name}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Input
            label="Person / email"
            value={personText}
            onChange={(e) => setPersonText(e.target.value)}
            placeholder="Filter this page…"
          />
          <Select
            label="Tool"
            data={toolOptions}
            value={tool}
            onChange={(e) => {
              setTool(e.target.value);
              setOffset(0);
            }}
          />
          <Select
            label="Outcome"
            data={OUTCOME_OPTIONS}
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              setOffset(0);
            }}
          />
          <Input
            label="From"
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setOffset(0);
            }}
          />
          <Input
            label="To"
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setOffset(0);
            }}
          />
        </div>
        {personId && (
          <div className="mt-3">
            <Badge variant="soft" color="blue" className="gap-1">
              Person: <code className="text-xs">{personId.slice(0, 8)}…</code>
              <button
                type="button"
                onClick={clearPersonId}
                className="cursor-pointer hover:opacity-70"
                aria-label="Clear person filter"
              >
                <XMarkIcon className="size-3.5" />
              </button>
            </Badge>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <DataTable
          table={table}
          loading={loading}
          renderSubComponent={renderSubComponent}
          emptyState={
            <div className="py-4">
              <ChartBarIcon className="mx-auto size-10 text-[var(--gray-a8)]" />
              <p className="mt-3 text-[var(--gray-11)]">No activity matches the current filters.</p>
            </div>
          }
        />
      </Card>

      {(offset > 0 || hasMore) && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--gray-11)]">
            Showing {total === 0 ? 0 : offset + 1}–{offset + entries.length} of {total}
            {personText.trim() && ` (${filteredEntries.length} after text filter)`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="1"
              disabled={loading || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="1"
              disabled={loading || !hasMore}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
