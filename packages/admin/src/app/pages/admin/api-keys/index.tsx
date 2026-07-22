import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  KeyIcon,
  PlusIcon,
  TrashIcon,
  ClipboardIcon,
  CheckCircleIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
} from '@tanstack/react-table';
import { Button, Card, ConfirmModal, Modal, WorkspaceLayout } from '@/components/ui';
import { Page } from '@/components/shared/Page';
import { DataTable } from '@/components/shared/table/DataTable';
import { RowActions } from '@/components/shared/table/RowActions';
import { Input } from '@/components/ui/Form/Input';
import { ApiKeyService, type ApiKey } from '@/utils/apiKeyService';

const SCOPE_OPTIONS = [
  { scope: 'events:read', label: 'Read events (incl. speakers, sponsors)' },
  { scope: 'events:metrics', label: 'Read event registration metrics (registrants, check-ins)' },
  { scope: 'calendars:read', label: 'Read public calendars' },
  { scope: 'forms:read', label: 'Read form definitions' },
  { scope: 'forms:submit', label: 'Submit form responses' },
  { scope: 'lists:read', label: 'Read public lists' },
  { scope: 'lists:subscribe', label: 'List subscribe / unsubscribe' },
  { scope: 'blog:read', label: 'Read blog posts' },
  { scope: 'speakers:read', label: 'Read speaker profiles' },
  { scope: 'sponsors:read', label: 'Read sponsor profiles' },
  { scope: 'registrations:create', label: 'Create event registrations' },
  { scope: 'newsletters:read', label: 'Read newsletter editions' },
  { scope: 'resources:read', label: 'Read public resource collections and items' },
  { scope: 'resources:write', label: 'Create and manage structured resources (MCP authoring)' },
];

const columnHelper = createColumnHelper<ApiKey>();

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = Date.now();
  const diffMs = now - d.getTime();
  const day = 86_400_000;
  if (diffMs < 60_000) return 'just now';
  if (diffMs < day) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  if (diffMs < 30 * day) return `${Math.floor(diffMs / day)}d ago`;
  return d.toLocaleDateString();
}

export default function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [createdKey, setCreatedKey] = useState<{ apiKey: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ApiKeyService.list({ limit: 100 });
      setKeys(result.data);
    } catch (e) {
      toast.error(`Failed to load API keys: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await ApiKeyService.revoke(revokeTarget.id);
      toast.success(`Revoked "${revokeTarget.name}"`);
      setRevokeTarget(null);
      load();
    } catch (e) {
      toast.error(`Failed to revoke: ${(e as Error).message}`);
    }
  };

  const handleCreated = (apiKey: string, key: ApiKey) => {
    setCreateOpen(false);
    setCreatedKey({ apiKey, name: key.name });
    setCopied(false);
    load();
  };

  const copyKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Name',
        cell: (info) => (
          <div className="text-sm font-medium text-[var(--gray-12)] max-w-xs truncate" title={info.getValue()}>
            {info.getValue()}
          </div>
        ),
      }),
      columnHelper.accessor('keyPrefix', {
        header: 'Prefix',
        cell: (info) => <code className="text-xs text-[var(--gray-11)]">{info.getValue()}…</code>,
      }),
      columnHelper.accessor('scopes', {
        header: 'Scopes',
        enableSorting: false,
        cell: (info) => {
          const scopes = info.getValue();
          return (
            <div className="flex flex-wrap gap-1 max-w-xs">
              {scopes.length === 0 ? (
                <span className="text-xs italic text-[var(--gray-10)]">no scopes</span>
              ) : scopes.length <= 3 ? (
                scopes.map((s) => (
                  <span key={s} className="text-xs bg-[var(--gray-a3)] px-1.5 py-0.5 rounded">
                    {s}
                  </span>
                ))
              ) : (
                <span className="text-xs text-[var(--gray-11)]" title={scopes.join(', ')}>
                  {scopes.slice(0, 2).join(', ')} +{scopes.length - 2} more
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor('lastUsedAt', {
        header: 'Last used',
        cell: (info) => (
          <span className="text-sm text-[var(--gray-11)] whitespace-nowrap">{formatDate(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor('totalRequests', {
        header: 'Requests',
        cell: (info) => (
          <span className="text-sm text-[var(--gray-11)]">{info.getValue().toLocaleString()}</span>
        ),
      }),
      columnHelper.accessor('isActive', {
        header: 'Status',
        cell: (info) => (
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${
              info.getValue()
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                : 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
            }`}
          >
            {info.getValue() ? 'Active' : 'Revoked'}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const key = info.row.original;
          return (
            <RowActions
              actions={[
                {
                  label: 'Edit',
                  icon: <PencilSquareIcon className="size-4" />,
                  onClick: () => setEditTarget(key),
                  hidden: !key.isActive,
                },
                {
                  label: 'Revoke',
                  icon: <TrashIcon className="size-4" />,
                  onClick: () => setRevokeTarget(key),
                  color: 'red',
                  hidden: !key.isActive,
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
    data: keys,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Page title="API Keys">
      <WorkspaceLayout
        title="API Keys"
        actions={
          <Button variant="solid" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4 mr-1" />
            New key
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--gray-11)] max-w-2xl">
            API keys authenticate external consumers calling the public REST API at{' '}
            <code className="text-xs">/api/v1/</code> and the MCP server. Each key has scoped permissions
            and per-key rate limits.
          </p>

          <Card className="overflow-hidden">
            <DataTable
              table={table}
              loading={loading}
              emptyState={
                <div className="py-4">
                  <KeyIcon className="mx-auto size-10 text-[var(--gray-a8)]" />
                  <p className="mt-3 text-[var(--gray-11)]">No API keys yet.</p>
                  <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                    Create your first key
                  </Button>
                </div>
              }
            />
          </Card>
        </div>

      {createOpen && (
        <KeyEditModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}

      {editTarget && (
        <KeyEditModal
          mode="edit"
          existing={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            load();
          }}
        />
      )}

      {createdKey && (
        <Modal
          isOpen
          onClose={() => setCreatedKey(null)}
          title="API key created"
          size="lg"
          resizable={false}
          footer={
            <Button onClick={() => setCreatedKey(null)}>Done</Button>
          }
        >
          <div className="space-y-4">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-800 rounded p-3 text-sm text-yellow-900 dark:text-yellow-200">
              <strong>Save this key now.</strong> For security, the full key cannot be retrieved later.
              You will only see it this once.
            </div>
            <div>
              <p className="text-sm font-medium mb-2">"{createdKey.name}" key:</p>
              <div className="flex gap-2 items-stretch">
                <code className="flex-1 bg-[var(--gray-a3)] px-3 py-2 rounded text-xs font-mono break-all">
                  {createdKey.apiKey}
                </code>
                <Button onClick={copyKey} variant="outline">
                  {copied ? (
                    <>
                      <CheckCircleIcon className="size-4 mr-1 text-green-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <ClipboardIcon className="size-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>
            <p className="text-xs text-[var(--gray-11)]">
              Use this key by setting the <code>X-API-Key</code> header on requests to{' '}
              <code>/api/v1/*</code>, or by setting <code>GATEWAZE_MCP_API_KEY</code> for the MCP server.
            </p>
          </div>
        </Modal>
      )}

      <ConfirmModal
        isOpen={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        title="Revoke API key?"
        message={`This will immediately disable "${revokeTarget?.name ?? ''}". External consumers using this key will start receiving 401 errors. This cannot be undone — create a new key if needed.`}
        confirmText="Revoke"
        confirmVariant="danger"
      />
      </WorkspaceLayout>
    </Page>
  );
}

type KeyEditModalProps =
  | {
      mode: 'create';
      onClose: () => void;
      onCreated: (apiKey: string, key: ApiKey) => void;
    }
  | {
      mode: 'edit';
      existing: ApiKey;
      onClose: () => void;
      onSaved: () => void;
    };

function KeyEditModal(props: KeyEditModalProps) {
  const isEdit = props.mode === 'edit';
  const existing = isEdit ? props.existing : null;

  const [name, setName] = useState(existing?.name ?? '');
  const [scopes, setScopes] = useState<Set<string>>(new Set(existing?.scopes ?? []));
  const [rateLimitRpm, setRateLimitRpm] = useState(existing?.rateLimitRpm ?? 60);
  const [writeRateLimitRpm, setWriteRateLimitRpm] = useState(existing?.writeRateLimitRpm ?? 10);
  const [submitting, setSubmitting] = useState(false);

  const allSelected = scopes.size === SCOPE_OPTIONS.length;

  const toggleScope = (scope: string) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const toggleAll = () => {
    setScopes(allSelected ? new Set() : new Set(SCOPE_OPTIONS.map((o) => o.scope)));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (scopes.size === 0) {
      toast.error('Select at least one scope');
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit) {
        await ApiKeyService.update(existing!.id, {
          name: name.trim(),
          scopes: Array.from(scopes),
          rateLimitRpm,
          writeRateLimitRpm,
        });
        toast.success(`Updated "${name.trim()}"`);
        props.onSaved();
      } else {
        const result = await ApiKeyService.create({
          name: name.trim(),
          scopes: Array.from(scopes),
          rateLimitRpm,
          writeRateLimitRpm,
        });
        props.onCreated(result.apiKey, result.key);
      }
    } catch (e) {
      toast.error(`Failed to ${isEdit ? 'save' : 'create'}: ${(e as Error).message}`);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      title={isEdit ? `Edit "${existing!.name}"` : 'Create API key'}
      size="lg"
      resizable={false}
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={props.onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting
              ? (isEdit ? 'Saving…' : 'Creating…')
              : (isEdit ? 'Save changes' : 'Create key')}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Partner website"
            autoFocus
          />
          <p className="text-xs text-[var(--gray-11)] mt-1">
            Used to identify the key in this list. Not visible to consumers.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium">Scopes</label>
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-[var(--accent-11)] hover:underline"
            >
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="space-y-1.5 border border-[var(--gray-a6)] rounded-md p-3 max-h-64 overflow-y-auto">
            {SCOPE_OPTIONS.map((opt) => (
              <label
                key={opt.scope}
                className="flex items-start gap-2 cursor-pointer hover:bg-[var(--gray-a3)] -mx-1 px-1 py-0.5 rounded"
              >
                <input
                  type="checkbox"
                  checked={scopes.has(opt.scope)}
                  onChange={() => toggleScope(opt.scope)}
                  className="mt-0.5"
                />
                <div>
                  <code className="text-xs font-medium">{opt.scope}</code>
                  <p className="text-xs text-[var(--gray-11)]">{opt.label}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Read rate limit (req/min)</label>
            <Input
              type="number"
              min={1}
              max={10000}
              value={rateLimitRpm}
              onChange={(e) => setRateLimitRpm(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Write rate limit (req/min)</label>
            <Input
              type="number"
              min={1}
              max={10000}
              value={writeRateLimitRpm}
              onChange={(e) => setWriteRateLimitRpm(Number(e.target.value))}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
