import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { NoSymbolIcon, SignalIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
} from '@tanstack/react-table';
import { Badge, Button, Card, ConfirmModal } from '@/components/ui';
import { DataTable } from '@/components/shared/table/DataTable';
import { RowActions } from '@/components/shared/table/RowActions';
import { PersonSearchInput, type PersonSearchResult } from '@/components/mcp/PersonSearchInput';
import { McpAccessService, type McpSession } from '@/utils/mcpAccessService';

const columnHelper = createColumnHelper<McpSession>();
const PAGE_SIZE = 50;

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export function McpSessionsTab() {
  const [sessions, setSessions] = useState<McpSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [personFilter, setPersonFilter] = useState<PersonSearchResult | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<McpSession | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await McpAccessService.listSessions({
        person_id: personFilter?.id,
        limit: PAGE_SIZE,
        offset,
      });
      setSessions(result.data);
      setTotal(result.pagination.total);
      setHasMore(result.pagination.has_more);
    } catch (e) {
      toast.error(`Failed to load sessions: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [personFilter, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await McpAccessService.revokeSession(revokeTarget.id);
      toast.success('Session revoked');
      setRevokeTarget(null);
      load();
    } catch (e) {
      toast.error(`Failed to revoke: ${(e as Error).message}`);
    }
  };

  const columns = useMemo(
    () => [
      columnHelper.accessor('person_name', {
        header: 'Person',
        cell: (info) => {
          const session = info.row.original;
          return (
            <div className="max-w-xs">
              <p className="text-sm font-medium text-[var(--gray-12)] truncate">
                {session.person_name || session.email || '—'}
              </p>
              {session.person_name && session.email && (
                <p className="text-xs text-[var(--gray-11)] truncate">{session.email}</p>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor('auth_mode', {
        header: 'Auth',
        cell: (info) => (
          <Badge variant="soft" color="gray">
            {info.getValue() || '—'}
          </Badge>
        ),
      }),
      columnHelper.accessor('client_name', {
        header: 'Client',
        cell: (info) => (
          <span className="text-sm text-[var(--gray-11)] max-w-[12rem] truncate inline-block align-middle">
            {info.getValue() || '—'}
          </span>
        ),
      }),
      columnHelper.accessor((s) => s.scopes.length, {
        id: 'scopes',
        header: 'Scopes',
        cell: (info) => (
          <span className="text-sm text-[var(--gray-11)]" title={info.row.original.scopes.join(', ')}>
            {info.row.original.scopes.length}
          </span>
        ),
      }),
      columnHelper.accessor('issued_at', {
        header: 'Issued',
        cell: (info) => (
          <span className="text-sm text-[var(--gray-11)] whitespace-nowrap">
            {formatDateTime(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('last_seen_at', {
        header: 'Last seen',
        cell: (info) => (
          <span className="text-sm text-[var(--gray-11)] whitespace-nowrap">
            {formatDateTime(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('revoked_at', {
        header: 'Status',
        cell: (info) => (
          <Badge variant="soft" color={info.getValue() ? 'red' : 'green'}>
            {info.getValue() ? 'Revoked' : 'Active'}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const session = info.row.original;
          return (
            <RowActions
              actions={[
                {
                  label: 'Revoke',
                  icon: <NoSymbolIcon className="size-4" />,
                  onClick: () => setRevokeTarget(session),
                  color: 'red',
                  hidden: !!session.revoked_at,
                },
              ]}
            />
          );
        },
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: sessions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-[var(--gray-11)] max-w-2xl">
          Active and revoked MCP OAuth sessions. Revoking a session kills its refresh token —
          the client must sign in again on its next connection.
        </p>
        <div className="flex items-center gap-2">
          {personFilter ? (
            <Badge variant="soft" color="blue" className="gap-1">
              {personFilter.email}
              <button
                type="button"
                onClick={() => {
                  setPersonFilter(null);
                  setOffset(0);
                }}
                className="cursor-pointer hover:opacity-70"
                aria-label="Clear person filter"
              >
                <XMarkIcon className="size-3.5" />
              </button>
            </Badge>
          ) : (
            <Button variant="outline" size="1" onClick={() => setFilterOpen((v) => !v)}>
              {filterOpen ? 'Close filter' : 'Filter by person'}
            </Button>
          )}
        </div>
      </div>

      {filterOpen && !personFilter && (
        <Card className="p-4">
          <PersonSearchInput
            autoFocus
            onSelect={(person) => {
              setPersonFilter(person);
              setFilterOpen(false);
              setOffset(0);
            }}
          />
        </Card>
      )}

      <Card className="overflow-hidden">
        <DataTable
          table={table}
          loading={loading}
          emptyState={
            <div className="py-4">
              <SignalIcon className="mx-auto size-10 text-[var(--gray-a8)]" />
              <p className="mt-3 text-[var(--gray-11)]">
                {personFilter ? 'No sessions for this person.' : 'No MCP sessions yet.'}
              </p>
            </div>
          }
        />
      </Card>

      {(offset > 0 || hasMore) && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--gray-11)]">
            Showing {total === 0 ? 0 : offset + 1}–{offset + sessions.length} of {total}
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

      <ConfirmModal
        isOpen={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        title="Revoke MCP session?"
        message={`This immediately kills the refresh token for ${
          revokeTarget?.client_name || 'this client'
        }${revokeTarget?.email ? ` (${revokeTarget.email})` : ''}. The client will need to sign in again.`}
        confirmText="Revoke"
        confirmVariant="danger"
      />
    </div>
  );
}
