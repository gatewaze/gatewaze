// @ts-nocheck
import { useState, useEffect, Fragment, useRef, useMemo } from 'react';
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SignalIcon,
  MegaphoneIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getExpandedRowModel,
  createColumnHelper,
  flexRender,
  SortingState,
  Row,
} from '@tanstack/react-table';
import clsx from 'clsx';

import { Card, Badge, Table, THead, TBody, Tr, Th, Td, Button, Collapse } from '@/components/ui-legacy';
import { CollapsibleSearch } from '@/components/shared/CollapsibleSearch';
import { TableSortIcon } from '@/components/shared/table/TableSortIcon';
import { PaginationSection } from '@/components/shared/table/PaginationSection';
import { CopyableCell } from '@/components/shared/table/CopyableCell';
import { Tooltip } from '@/components/shared/Tooltip';
import { fuzzyFilter } from '@/utils/react-table/fuzzyFilter';
import { useBoxSize } from '@/hooks';
import { supabase } from '@/lib/supabase';

interface ConversionLogProps {
  eventId: string;
}

interface ConversionEvent {
  id: string;
  tracking_session_id: string | null;
  registration_id: string | null;
  event_id: string | null;
  platform: string;
  event_name: string;
  dedup_event_id: string | null;
  request_payload: Record<string, unknown> | null;
  request_url: string | null;
  response_payload: Record<string, unknown> | null;
  http_status: number | null;
  status: string | null;
  error_message: string | null;
  sent_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  // Joined from tracking session
  session_click_ids?: Record<string, string> | null;
  session_utm_source?: string | null;
}

interface TrackingSession {
  id: string;
  session_id: string;
  click_ids: Record<string, string> | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  status: string | null;
  matched_registration_id: string | null;
  matched_via: string | null;
  conversions_sent: Record<string, unknown> | null;
  created_at: string | null;
}

type ColorType = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error' | 'neutral';

const PLATFORM_COLORS: Record<string, ColorType> = {
  meta: 'primary',
  google: 'info',
  reddit: 'warning',
  linkedin: 'secondary',
};

const PLATFORM_CLICK_ID_KEYS: Record<string, string> = {
  meta: 'fbclid',
  google: 'gclid',
  reddit: 'rdt_cid',
  linkedin: 'li_fat_id',
  bing: 'msclkid',
  tiktok: 'ttclid',
};

const STATUS_COLORS: Record<string, ColorType> = {
  success: 'success',
  sent: 'success',
  pending: 'warning',
  failed: 'error',
  error: 'error',
};

const SESSION_STATUS_COLORS: Record<string, ColorType> = {
  converted: 'success',
  pending: 'warning',
  expired: 'neutral',
};

function truncateId(id: string | null): string {
  if (!id) return '—';
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Check if a conversion has the correct click ID for its platform
 */
function hasAttributionData(conv: ConversionEvent): boolean {
  const clickIds = conv.session_click_ids;
  if (!clickIds || Object.keys(clickIds).length === 0) return false;

  const expectedKey = PLATFORM_CLICK_ID_KEYS[conv.platform];
  if (!expectedKey) return Object.keys(clickIds).length > 0;

  return !!clickIds[expectedKey];
}

/**
 * Get attribution status for display
 */
function getAttributionStatus(conv: ConversionEvent): {
  hasAttribution: boolean;
  reason: string;
  clickIdKey?: string;
} {
  const clickIds = conv.session_click_ids;
  const expectedKey = PLATFORM_CLICK_ID_KEYS[conv.platform];

  if (!conv.tracking_session_id) {
    return { hasAttribution: false, reason: 'No tracking session linked' };
  }

  if (!clickIds || Object.keys(clickIds).length === 0) {
    return { hasAttribution: false, reason: 'Session has no click IDs' };
  }

  if (expectedKey && clickIds[expectedKey]) {
    return { hasAttribution: true, reason: `Has ${expectedKey}`, clickIdKey: expectedKey };
  }

  // Has click IDs but not for this platform
  const availableKeys = Object.keys(clickIds).join(', ');
  return {
    hasAttribution: false,
    reason: `Has ${availableKeys} but needs ${expectedKey || 'platform click ID'}`,
  };
}

// Column definitions for Conversion Events table
const conversionColumnHelper = createColumnHelper<ConversionEvent>();

const getConversionColumns = () => [
  conversionColumnHelper.display({
    id: 'expand',
    header: '',
    cell: ({ row }) => (
      <button
        onClick={() => row.toggleExpanded()}
        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
      >
        {row.getIsExpanded() ? (
          <ChevronDownIcon className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRightIcon className="w-4 h-4 text-gray-400" />
        )}
      </button>
    ),
  }),
  conversionColumnHelper.accessor('platform', {
    header: 'Platform',
    cell: ({ getValue }) => (
      <Badge variant="soft" color={PLATFORM_COLORS[getValue()] || 'neutral'}>
        {getValue()}
      </Badge>
    ),
  }),
  conversionColumnHelper.accessor('event_name', {
    header: 'Event',
    cell: ({ getValue }) => (
      <span className="text-sm text-gray-900 dark:text-white">{getValue()}</span>
    ),
  }),
  conversionColumnHelper.display({
    id: 'attribution',
    header: 'Attribution',
    cell: ({ row }) => {
      const conv = row.original;
      const status = getAttributionStatus(conv);

      if (status.hasAttribution) {
        return (
          <Tooltip content={status.reason}>
            <div className="flex items-center gap-1.5">
              <CheckCircleIcon className="w-4 h-4 text-green-500" />
              <span className="text-xs text-green-600 dark:text-green-400">Has click ID</span>
            </div>
          </Tooltip>
        );
      }

      return (
        <Tooltip content={status.reason}>
          <div className="flex items-center gap-1.5">
            <ExclamationTriangleIcon className="w-4 h-4 text-amber-500" />
            <span className="text-xs text-amber-600 dark:text-amber-400">No attribution</span>
          </div>
        </Tooltip>
      );
    },
  }),
  conversionColumnHelper.accessor('status', {
    header: 'Status',
    cell: ({ getValue }) => {
      const status = getValue() || 'pending';
      return (
        <Badge variant="soft" color={STATUS_COLORS[status] || 'neutral'}>
          {status}
        </Badge>
      );
    },
  }),
  conversionColumnHelper.accessor('http_status', {
    header: 'HTTP',
    cell: ({ getValue }) => {
      const status = getValue();
      return (
        <span
          className={clsx(
            'text-sm font-mono',
            status && status >= 200 && status < 300
              ? 'text-green-600 dark:text-green-400'
              : status
                ? 'text-red-600 dark:text-red-400'
                : 'text-gray-400'
          )}
        >
          {status || '—'}
        </span>
      );
    },
  }),
  conversionColumnHelper.accessor('session_utm_source', {
    header: 'Source',
    cell: ({ getValue }) => {
      const source = getValue();
      return source ? (
        <span className="text-sm text-gray-600 dark:text-gray-400">{source}</span>
      ) : (
        <span className="text-sm text-gray-400">—</span>
      );
    },
  }),
  conversionColumnHelper.accessor((row) => row.sent_at || row.created_at, {
    id: 'sent_at',
    header: 'Sent',
    cell: ({ getValue }) => (
      <span className="text-sm text-gray-500">{formatTimestamp(getValue() as string | null)}</span>
    ),
  }),
];

// Column definitions for Tracking Sessions table
const sessionColumnHelper = createColumnHelper<TrackingSession>();

const getSessionColumns = () => [
  sessionColumnHelper.accessor('session_id', {
    header: 'Session',
    cell: (props) => <CopyableCell {...props} />,
  }),
  sessionColumnHelper.accessor('utm_source', {
    header: 'UTM Source',
    cell: ({ getValue }) => (
      <span className="text-sm text-gray-900 dark:text-white">{getValue() || '—'}</span>
    ),
  }),
  sessionColumnHelper.accessor('utm_campaign', {
    header: 'Campaign',
    cell: ({ getValue }) => {
      const campaign = getValue();
      // Check for unsubstituted macros
      if (campaign?.includes('{{')) {
        return (
          <Tooltip content="URL macros not substituted - check ad platform URL configuration">
            <span className="text-sm text-amber-600 dark:text-amber-400">{campaign}</span>
          </Tooltip>
        );
      }
      return <span className="text-sm text-gray-500">{campaign || '—'}</span>;
    },
  }),
  sessionColumnHelper.accessor('click_ids', {
    header: 'Click IDs',
    enableSorting: false,
    cell: ({ getValue }) => {
      const clickIds = getValue();
      if (!clickIds || Object.keys(clickIds).length === 0) {
        return (
          <Tooltip content="No click IDs captured - conversions won't be attributed to ads">
            <span className="text-sm text-amber-500">None</span>
          </Tooltip>
        );
      }
      return (
        <div className="flex flex-wrap gap-1">
          {Object.entries(clickIds).map(([key, value]) => (
            <Tooltip key={key} content={`${key}: ${value}`}>
              <Badge variant="soft" color="success" className="text-xs">
                {key}
              </Badge>
            </Tooltip>
          ))}
        </div>
      );
    },
  }),
  sessionColumnHelper.accessor('status', {
    header: 'Status',
    cell: ({ getValue }) => {
      const status = getValue() || 'pending';
      return (
        <Badge variant="soft" color={SESSION_STATUS_COLORS[status] || 'neutral'}>
          {status}
        </Badge>
      );
    },
  }),
  sessionColumnHelper.accessor('matched_via', {
    header: 'Matched via',
    cell: ({ getValue }) => <span className="text-sm text-gray-500">{getValue() || '—'}</span>,
  }),
  sessionColumnHelper.accessor('matched_registration_id', {
    header: 'Registration',
    cell: (props) => <CopyableCell {...props} />,
  }),
  sessionColumnHelper.accessor('created_at', {
    header: 'Created',
    cell: ({ getValue }) => (
      <span className="text-sm text-gray-500">{formatTimestamp(getValue())}</span>
    ),
  }),
];

// Expanded row component for conversion events
function ConversionExpandedRow({
  row,
  cardWidth,
}: {
  row: Row<ConversionEvent>;
  cardWidth?: number;
}) {
  const conv = row.original;
  const attrStatus = getAttributionStatus(conv);

  return (
    <div
      className="dark:border-b-dark-500 dark:bg-dark-750 sticky border-b border-b-gray-200 bg-gray-50 pt-3 pb-4 ltr:left-0 rtl:right-0"
      style={{ maxWidth: cardWidth }}
    >
      <div className="px-4 sm:px-5 space-y-4">
        {/* Attribution warning */}
        {!attrStatus.hasAttribution && (
          <div className="p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <strong>No attribution data:</strong> {attrStatus.reason}.
              <br />
              <span className="text-xs opacity-80">
                This conversion was sent to {conv.platform} but likely won't appear in your ad
                reports because the platform can't match it to an ad click.
              </span>
            </div>
          </div>
        )}

        {conv.error_message && (
          <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">
            {conv.error_message}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">
              Request payload
            </p>
            <pre className="text-xs font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-3 overflow-x-auto max-h-48">
              {conv.request_payload ? JSON.stringify(conv.request_payload, null, 2) : '—'}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">
              Response payload
            </p>
            <pre className="text-xs font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-3 overflow-x-auto max-h-48">
              {conv.response_payload ? JSON.stringify(conv.response_payload, null, 2) : '—'}
            </pre>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-gray-500">
          <span>
            Registration: <code>{truncateId(conv.registration_id)}</code>
          </span>
          <span>
            Session: <code>{truncateId(conv.tracking_session_id)}</code>
          </span>
          <span>
            Dedup ID: <code>{conv.dedup_event_id || '—'}</code>
          </span>
        </div>
      </div>
    </div>
  );
}

const CLICK_ID_TO_PLATFORM: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_CLICK_ID_KEYS).map(([platform, key]) => [key, platform])
);

function getPlatformFromClickIds(clickIds: Record<string, string> | null): string | null {
  if (!clickIds) return null;
  for (const key of Object.keys(clickIds)) {
    if (CLICK_ID_TO_PLATFORM[key]) return CLICK_ID_TO_PLATFORM[key];
  }
  return null;
}

// Breakdown stats component
function BreakdownStats({
  sessions,
}: {
  sessions: TrackingSession[];
}) {
  const { platformStats, utmSourceStats } = useMemo(() => {
    type StatRow = { sessions: number; registered: number };
    const buildStats = (
      sessionKey: (s: TrackingSession) => string,
    ) => {
      const map = new Map<string, StatRow>();
      for (const session of sessions) {
        const key = sessionKey(session);
        const entry = map.get(key) || { sessions: 0, registered: 0 };
        entry.sessions++;
        if (session.status === 'converted') entry.registered++;
        map.set(key, entry);
      }
      return Array.from(map.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.registered - a.registered);
    };

    return {
      platformStats: buildStats(
        (s) => getPlatformFromClickIds(s.click_ids) || '(no click ID)',
      ),
      utmSourceStats: buildStats(
        (s) => s.utm_source || '(none)',
      ),
    };
  }, [sessions]);

  if (platformStats.length === 0 && utmSourceStats.length === 0) return null;

  const StatsTable = ({ rows }: { rows: { name: string; sessions: number; registered: number }[] }) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          <th className="text-left py-1.5 pr-3 font-medium">Source</th>
          <th className="text-right py-1.5 px-3 font-medium">Sessions</th>
          <th className="text-right py-1.5 pl-3 font-medium">Registered</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name} className="border-t border-gray-100 dark:border-gray-700">
            <td className="py-1.5 pr-3">
              <Badge variant="soft" color={PLATFORM_COLORS[row.name] || 'neutral'} className="capitalize text-xs">
                {row.name}
              </Badge>
            </td>
            <td className="text-right py-1.5 px-3 font-medium text-gray-900 dark:text-white tabular-nums">
              {row.sessions.toLocaleString()}
            </td>
            <td className="text-right py-1.5 pl-3 font-medium text-green-600 dark:text-green-400 tabular-nums">
              {row.registered.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
      <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
          By Ad Platform (click ID)
        </p>
        <StatsTable rows={platformStats} />
      </div>
      <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
          By UTM Source
        </p>
        <StatsTable rows={utmSourceStats} />
      </div>
    </div>
  );
}

export function ConversionLog({ eventId }: ConversionLogProps) {
  const [conversions, setConversions] = useState<ConversionEvent[]>([]);
  const [sessions, setSessions] = useState<TrackingSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [conversionGlobalFilter, setConversionGlobalFilter] = useState('');
  const [conversionSorting, setConversionSorting] = useState<SortingState>([]);

  const [sessionGlobalFilter, setSessionGlobalFilter] = useState('');
  const [sessionSorting, setSessionSorting] = useState<SortingState>([]);

  const conversionCardRef = useRef<HTMLDivElement>(null);
  const sessionTheadRef = useRef<HTMLTableSectionElement>(null);

  const { width: conversionCardWidth } = useBoxSize({ ref: conversionCardRef });

  const conversionColumns = useMemo(() => getConversionColumns(), []);
  const sessionColumns = useMemo(() => getSessionColumns(), []);

  const fetchAllRows = async <T,>(
    query: PromiseLike<{ data: T[] | null; error: unknown }>
  ): Promise<T[]> => {
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  };

  const fetchPaginated = async <T,>(
    buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
    pageSize = 1000
  ): Promise<T[]> => {
    const allRows: T[] = [];
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await buildQuery(from, from + pageSize - 1);
      if (error) throw error;
      const rows = data || [];
      allRows.push(...rows);
      hasMore = rows.length === pageSize;
      from += pageSize;
    }
    return allRows;
  };

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [conversionsData, sessionsData, registrationsData] = await Promise.all([
        fetchAllRows(
          supabase
            .from('conversion_events_log')
            .select('*')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false })
        ),
        fetchPaginated((from, to) =>
          supabase
            .from('ad_tracking_sessions')
            .select(
              'id, session_id, click_ids, utm_source, utm_medium, utm_campaign, status, matched_registration_id, matched_via, conversions_sent, created_at'
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: false })
            .range(from, to)
        ),
        fetchAllRows(
          supabase
            .from('event_registrations')
            .select('id')
            .eq('event_id', eventId)
        ),
      ]);

      // Build a set of valid registration IDs
      const validRegistrationIds = new Set<string>();
      for (const reg of registrationsData) {
        validRegistrationIds.add(reg.id);
      }

      // Build a map of session ID -> session data for enriching conversions
      const sessionMap = new Map<string, TrackingSession>();
      // Filter sessions to only those with valid registrations (or no matched registration yet)
      const validSessions = sessionsData.filter(
        (session) => !session.matched_registration_id || validRegistrationIds.has(session.matched_registration_id)
      );
      for (const session of validSessions) {
        sessionMap.set(session.id, session as TrackingSession);
      }
      setSessions(validSessions as TrackingSession[]);

      // Enrich conversions with session data, filtering out deleted/test registrations
      // Only show conversions that have a valid registration_id still in the database
      const enrichedConversions = conversionsData
        .filter((conv: any) => conv.registration_id && validRegistrationIds.has(conv.registration_id))
        .map((conv: any) => {
          const session = conv.tracking_session_id ? sessionMap.get(conv.tracking_session_id) : null;
          return {
            ...conv,
            session_click_ids: session?.click_ids || null,
            session_utm_source: session?.utm_source || null,
          };
        });
      setConversions(enrichedConversions);
    } catch (err) {
      console.error('Error fetching conversion data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [eventId]);

  // Conversion events table
  const conversionTable = useReactTable({
    data: conversions,
    columns: conversionColumns,
    state: {
      globalFilter: conversionGlobalFilter,
      sorting: conversionSorting,
    },
    filterFns: {
      fuzzy: fuzzyFilter,
    },
    getCoreRowModel: getCoreRowModel(),
    onGlobalFilterChange: setConversionGlobalFilter,
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: fuzzyFilter,
    onSortingChange: setConversionSorting,
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Sessions table
  const sessionTable = useReactTable({
    data: sessions,
    columns: sessionColumns,
    state: {
      globalFilter: sessionGlobalFilter,
      sorting: sessionSorting,
    },
    filterFns: {
      fuzzy: fuzzyFilter,
    },
    getCoreRowModel: getCoreRowModel(),
    onGlobalFilterChange: setSessionGlobalFilter,
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: fuzzyFilter,
    onSortingChange: setSessionSorting,
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Stats
  const totalSessions = sessions.length;
  const totalConversions = conversions.length;
  const convertedSessions = sessions.filter((s) => s.status === 'converted').length;

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto" />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Card */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SignalIcon className="w-5 h-5 text-gray-500" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Conversion tracking
            </h3>
          </div>
          <Button
            variant="flat"
            isIcon
            onClick={fetchData}
            className="size-8 rounded-full"
            aria-label="Refresh"
            title="Refresh"
          >
            <ArrowPathIcon className="w-4 h-4" />
          </Button>
        </div>

        {/* Summary stats bar */}
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Tracked Sessions
            </p>
            <p className="text-xl font-semibold text-gray-900 dark:text-white">{totalSessions.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Registered
            </p>
            <p className="text-xl font-semibold text-green-600 dark:text-green-400">
              {convertedSessions.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Conversions Sent
            </p>
            <p className="text-xl font-semibold text-gray-900 dark:text-white">
              {totalConversions.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Breakdowns */}
        <div className="px-4 pb-4">
          <BreakdownStats sessions={sessions} />
        </div>
      </Card>

      {/* Conversion Events Table */}
      <div>
        <div className="table-toolbar flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MegaphoneIcon className="w-5 h-5 text-gray-500" />
            <h2 className="dark:text-dark-100 truncate text-base font-medium tracking-wide text-gray-800">
              Conversion events
            </h2>
            <Badge variant="soft" color="neutral">
              {totalConversions}
            </Badge>
          </div>
          <CollapsibleSearch
            placeholder="Search events..."
            value={conversionGlobalFilter ?? ''}
            onChange={(e) => setConversionGlobalFilter(e.target.value)}
          />
        </div>

        <Card className="relative" ref={conversionCardRef}>
          {conversions.length === 0 ? (
            <div className="py-8 text-center text-gray-500 dark:text-gray-400">
              <MegaphoneIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No conversion events yet</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Events appear here when registrations trigger ad platform conversions
              </p>
            </div>
          ) : (
            <>
              <div className="table-wrapper min-w-full overflow-x-auto">
                <Table hoverable className="w-full text-left rtl:text-right">
                  <THead>
                    {conversionTable.getHeaderGroups().map((headerGroup) => (
                      <Tr key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <Th
                            key={header.id}
                            className="dark:bg-dark-800 dark:text-dark-100 bg-gray-200 font-semibold text-gray-800 uppercase first:ltr:rounded-tl-lg last:ltr:rounded-tr-lg first:rtl:rounded-tr-lg last:rtl:rounded-tl-lg"
                          >
                            {header.column.getCanSort() ? (
                              <div
                                className="flex cursor-pointer items-center space-x-3 select-none"
                                onClick={header.column.getToggleSortingHandler()}
                              >
                                <span className="flex-1">
                                  {header.isPlaceholder
                                    ? null
                                    : flexRender(
                                        header.column.columnDef.header,
                                        header.getContext()
                                      )}
                                </span>
                                <TableSortIcon sorted={header.column.getIsSorted()} />
                              </div>
                            ) : header.isPlaceholder ? null : (
                              flexRender(header.column.columnDef.header, header.getContext())
                            )}
                          </Th>
                        ))}
                      </Tr>
                    ))}
                  </THead>
                  <TBody>
                    {conversionTable.getRowModel().rows.map((row) => (
                      <Fragment key={row.id}>
                        <Tr
                          className={clsx(
                            'dark:border-b-dark-500 relative border-y border-transparent border-b-gray-200',
                            row.getIsExpanded() && 'border-dashed'
                          )}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <Td key={cell.id}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </Td>
                          ))}
                        </Tr>
                        <tr>
                          <td colSpan={row.getVisibleCells().length} className="p-0">
                            <Collapse in={row.getIsExpanded()}>
                              <ConversionExpandedRow row={row} cardWidth={conversionCardWidth} />
                            </Collapse>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </TBody>
                </Table>
              </div>
              {conversionTable.getCoreRowModel().rows.length > 0 && (
                <div className="p-4 sm:px-5">
                  <PaginationSection table={conversionTable} />
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Tracking Sessions Table */}
      <div>
        <div className="table-toolbar flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <SignalIcon className="w-5 h-5 text-gray-500" />
            <h2 className="dark:text-dark-100 truncate text-base font-medium tracking-wide text-gray-800">
              Tracking sessions
            </h2>
            <Badge variant="soft" color="neutral">
              {totalSessions}
            </Badge>
          </div>
          <CollapsibleSearch
            placeholder="Search sessions..."
            value={sessionGlobalFilter ?? ''}
            onChange={(e) => setSessionGlobalFilter(e.target.value)}
          />
        </div>

        <Card className="relative">
          {sessions.length === 0 ? (
            <div className="py-8 text-center text-gray-500 dark:text-gray-400">
              <SignalIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No tracking sessions yet</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Sessions are created when users click ad tracking links
              </p>
            </div>
          ) : (
            <>
              <div className="table-wrapper min-w-full overflow-x-auto">
                <Table hoverable className="w-full text-left rtl:text-right">
                  <THead ref={sessionTheadRef}>
                    {sessionTable.getHeaderGroups().map((headerGroup) => (
                      <Tr key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <Th
                            key={header.id}
                            className="dark:bg-dark-800 dark:text-dark-100 bg-gray-200 font-semibold text-gray-800 uppercase first:ltr:rounded-tl-lg last:ltr:rounded-tr-lg first:rtl:rounded-tr-lg last:rtl:rounded-tl-lg"
                          >
                            {header.column.getCanSort() ? (
                              <div
                                className="flex cursor-pointer items-center space-x-3 select-none"
                                onClick={header.column.getToggleSortingHandler()}
                              >
                                <span className="flex-1">
                                  {header.isPlaceholder
                                    ? null
                                    : flexRender(
                                        header.column.columnDef.header,
                                        header.getContext()
                                      )}
                                </span>
                                <TableSortIcon sorted={header.column.getIsSorted()} />
                              </div>
                            ) : header.isPlaceholder ? null : (
                              flexRender(header.column.columnDef.header, header.getContext())
                            )}
                          </Th>
                        ))}
                      </Tr>
                    ))}
                  </THead>
                  <TBody>
                    {sessionTable.getRowModel().rows.map((row) => (
                      <Tr
                        key={row.id}
                        className="dark:border-b-dark-500 relative border-y border-transparent border-b-gray-200"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <Td key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </Td>
                        ))}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
              {sessionTable.getCoreRowModel().rows.length > 0 && (
                <div className="p-4 sm:px-5">
                  <PaginationSection table={sessionTable} />
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
