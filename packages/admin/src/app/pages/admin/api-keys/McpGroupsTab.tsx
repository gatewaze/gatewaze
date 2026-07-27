import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  UserGroupIcon,
  UsersIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
} from '@tanstack/react-table';
import { Badge, Button, Card, ConfirmModal, Modal } from '@/components/ui';
import { DataTable } from '@/components/shared/table/DataTable';
import { RowActions } from '@/components/shared/table/RowActions';
import { Input } from '@/components/ui/Form/Input';
import { ScopePicker } from '@/components/mcp/ScopePicker';
import { PersonSearchInput } from '@/components/mcp/PersonSearchInput';
import {
  McpAccessService,
  type McpGroup,
  type McpGroupMember,
  type McpScopeOption,
} from '@/utils/mcpAccessService';

const columnHelper = createColumnHelper<McpGroup>();

function ruleSummary(group: McpGroup): string {
  const active = group.rules.filter((r) => r.is_active);
  if (active.length === 0) return '—';
  return active
    .map((r) => (r.kind === 'all_authenticated' ? 'all authenticated' : `@${r.match}`))
    .join(', ');
}

export function McpGroupsTab() {
  const [groups, setGroups] = useState<McpGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [scopeOptions, setScopeOptions] = useState<McpScopeOption[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<McpGroup | null>(null);
  const [membersTarget, setMembersTarget] = useState<McpGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<McpGroup | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGroups(await McpAccessService.listGroups());
    } catch (e) {
      toast.error(`Failed to load MCP groups: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    McpAccessService.getScopes()
      .then(setScopeOptions)
      .catch((e) => toast.error(`Failed to load scope catalog: ${(e as Error).message}`));
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await McpAccessService.deleteGroup(deleteTarget.id);
      toast.success(`Deleted "${deleteTarget.label}"`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error(`Failed to delete: ${(e as Error).message}`);
    }
  };

  const toggleActive = async (group: McpGroup) => {
    try {
      await McpAccessService.updateGroup(group.id, { is_active: !group.is_active });
      toast.success(group.is_active ? `Deactivated "${group.label}"` : `Activated "${group.label}"`);
      load();
    } catch (e) {
      toast.error(`Failed to update: ${(e as Error).message}`);
    }
  };

  const columns = useMemo(
    () => [
      columnHelper.accessor('label', {
        header: 'Group',
        cell: (info) => {
          const group = info.row.original;
          return (
            <div className="max-w-xs">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--gray-12)] truncate" title={group.label}>
                  {group.label}
                </span>
                {group.is_default && (
                  <Badge variant="soft" color="blue">
                    Default
                  </Badge>
                )}
              </div>
              <code className="text-xs text-[var(--gray-11)]">{group.name}</code>
            </div>
          );
        },
      }),
      columnHelper.accessor((g) => g.scopes.length, {
        id: 'scopes',
        header: 'Scopes',
        cell: (info) => {
          const scopes = info.row.original.scopes;
          return (
            <span className="text-sm text-[var(--gray-11)]" title={scopes.join(', ')}>
              {scopes.length}
            </span>
          );
        },
      }),
      columnHelper.display({
        id: 'rules',
        header: 'Rules',
        cell: (info) => (
          <span className="text-xs text-[var(--gray-11)] max-w-[16rem] truncate inline-block align-middle">
            {ruleSummary(info.row.original)}
          </span>
        ),
      }),
      columnHelper.accessor('member_count', {
        header: 'Members',
        cell: (info) => (
          <button
            type="button"
            onClick={() => setMembersTarget(info.row.original)}
            className="text-sm text-[var(--accent-11)] hover:underline cursor-pointer"
          >
            {info.getValue()}
          </button>
        ),
      }),
      columnHelper.accessor('is_active', {
        header: 'Status',
        cell: (info) => (
          <Badge variant="soft" color={info.getValue() ? 'green' : 'gray'}>
            {info.getValue() ? 'Active' : 'Inactive'}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const group = info.row.original;
          return (
            <RowActions
              actions={[
                {
                  label: 'Edit',
                  icon: <PencilSquareIcon className="size-4" />,
                  onClick: () => setEditTarget(group),
                },
                {
                  label: 'Members',
                  icon: <UsersIcon className="size-4" />,
                  onClick: () => setMembersTarget(group),
                },
                {
                  label: group.is_active ? 'Deactivate' : 'Activate',
                  icon: group.is_active ? (
                    <PauseCircleIcon className="size-4" />
                  ) : (
                    <PlayCircleIcon className="size-4" />
                  ),
                  onClick: () => toggleActive(group),
                },
                {
                  label: 'Delete',
                  icon: <TrashIcon className="size-4" />,
                  onClick: () => setDeleteTarget(group),
                  color: 'red',
                  hidden: group.is_default,
                },
              ]}
            />
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const table = useReactTable({
    data: groups,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-[var(--gray-11)] max-w-2xl">
          Access groups grant MCP scopes to signed-in users — via rules (e.g. a verified email
          domain) and/or explicit membership. A person's effective scopes are the union of every
          group they match, plus their personal grants.
        </p>
        <Button variant="solid" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-4 mr-1" />
          New group
        </Button>
      </div>

      <Card className="overflow-hidden">
        <DataTable
          table={table}
          loading={loading}
          emptyState={
            <div className="py-4">
              <UserGroupIcon className="mx-auto size-10 text-[var(--gray-a8)]" />
              <p className="mt-3 text-[var(--gray-11)]">No MCP access groups yet.</p>
              <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                Create your first group
              </Button>
            </div>
          }
        />
      </Card>

      {createOpen && (
        <GroupEditModal
          mode="create"
          scopeOptions={scopeOptions}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            load();
          }}
        />
      )}

      {editTarget && (
        <GroupEditModal
          mode="edit"
          existing={editTarget}
          scopeOptions={scopeOptions}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            load();
          }}
        />
      )}

      {membersTarget && (
        <GroupMembersModal
          group={membersTarget}
          onClose={() => {
            setMembersTarget(null);
            load();
          }}
        />
      )}

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete MCP group?"
        message={`This removes "${deleteTarget?.label ?? ''}" including its rules and memberships. People matched only by this group fall back to their remaining groups on their next token.`}
        confirmText="Delete"
        confirmVariant="danger"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit modal (with rules editor in edit mode)
// ---------------------------------------------------------------------------

type GroupEditModalProps =
  | {
      mode: 'create';
      scopeOptions: McpScopeOption[];
      onClose: () => void;
      onSaved: () => void;
    }
  | {
      mode: 'edit';
      existing: McpGroup;
      scopeOptions: McpScopeOption[];
      onClose: () => void;
      onSaved: () => void;
    };

function GroupEditModal(props: GroupEditModalProps) {
  const isEdit = props.mode === 'edit';
  const existing = isEdit ? props.existing : null;

  const [name, setName] = useState(existing?.name ?? '');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [scopes, setScopes] = useState<Set<string>>(new Set(existing?.scopes ?? []));
  const [submitting, setSubmitting] = useState(false);

  // Rules editor state — API-backed per rule, so keep a local mirror that we
  // refresh after each add/delete without reloading the whole tab.
  const [rules, setRules] = useState(existing?.rules ?? []);
  const [newDomain, setNewDomain] = useState('');
  const [ruleBusy, setRuleBusy] = useState(false);

  const addDomainRule = async () => {
    if (!existing) return;
    const domain = newDomain.trim().replace(/^@/, '').toLowerCase();
    if (!domain || !domain.includes('.')) {
      toast.error('Enter a valid email domain (e.g. linuxfoundation.org)');
      return;
    }
    setRuleBusy(true);
    try {
      const rule = await McpAccessService.addGroupRule(existing.id, {
        kind: 'email_domain',
        match: domain,
      });
      setRules((prev) => [...prev, rule]);
      setNewDomain('');
      toast.success(`Added @${domain} rule`);
    } catch (e) {
      toast.error(`Failed to add rule: ${(e as Error).message}`);
    } finally {
      setRuleBusy(false);
    }
  };

  const deleteRule = async (ruleId: string) => {
    if (!existing) return;
    setRuleBusy(true);
    try {
      await McpAccessService.deleteGroupRule(existing.id, ruleId);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      toast.success('Rule removed');
    } catch (e) {
      toast.error(`Failed to remove rule: ${(e as Error).message}`);
    } finally {
      setRuleBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) {
      toast.error('Label is required');
      return;
    }
    if (!isEdit && !name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit) {
        await McpAccessService.updateGroup(existing!.id, {
          label: label.trim(),
          scopes: Array.from(scopes),
        });
        toast.success(`Updated "${label.trim()}"`);
      } else {
        await McpAccessService.createGroup({
          name: name.trim(),
          label: label.trim(),
          scopes: Array.from(scopes),
        });
        toast.success(`Created "${label.trim()}"`);
      }
      props.onSaved();
    } catch (e) {
      toast.error(`Failed to ${isEdit ? 'save' : 'create'}: ${(e as Error).message}`);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      title={isEdit ? `Edit "${existing!.label}"` : 'Create MCP group'}
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
              : (isEdit ? 'Save changes' : 'Create group')}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. lf-staff"
              disabled={isEdit}
              autoFocus={!isEdit}
            />
            <p className="text-xs text-[var(--gray-11)] mt-1">
              Stable identifier{isEdit ? ' (cannot be changed)' : ''}.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Label</label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. LF Staff"
              autoFocus={isEdit}
            />
            <p className="text-xs text-[var(--gray-11)] mt-1">Shown in the admin UI.</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Scopes</label>
          <ScopePicker options={props.scopeOptions} selected={scopes} onChange={setScopes} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Rules</label>
          {isEdit ? (
            <div className="space-y-2">
              {rules.length === 0 ? (
                <p className="text-xs text-[var(--gray-11)]">
                  No rules — only explicit members match this group.
                </p>
              ) : (
                <div className="border border-[var(--gray-a6)] rounded-md divide-y divide-[var(--gray-a4)]">
                  {rules.map((rule) => (
                    <div key={rule.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="flex-1 min-w-0 text-sm">
                        {rule.kind === 'all_authenticated' ? (
                          <span>All authenticated users</span>
                        ) : (
                          <span>
                            Email domain <code className="text-xs font-medium">@{rule.match}</code>
                          </span>
                        )}
                        {!rule.is_active && (
                          <Badge variant="soft" color="gray" className="ml-2">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        color="red"
                        size="1"
                        isIcon
                        type="button"
                        onClick={() => deleteRule(rule.id)}
                        disabled={ruleBusy}
                        title="Remove rule"
                      >
                        <XMarkIcon className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    placeholder="Email domain, e.g. linuxfoundation.org"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!ruleBusy) addDomainRule();
                      }
                    }}
                  />
                </div>
                <Button
                  variant="soft"
                  type="button"
                  onClick={addDomainRule}
                  disabled={ruleBusy || !newDomain.trim()}
                >
                  <PlusIcon className="size-4 mr-1" />
                  Add domain rule
                </Button>
              </div>
              <p className="text-xs text-[var(--gray-11)]">
                People with a verified email on a listed domain match this group automatically.
                Rule changes apply immediately.
              </p>
            </div>
          ) : (
            <p className="text-xs text-[var(--gray-11)]">
              Create the group first, then add email-domain rules from its Edit dialog.
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Members modal
// ---------------------------------------------------------------------------

const MEMBERS_PAGE_SIZE = 50;

function GroupMembersModal({ group, onClose }: { group: McpGroup; onClose: () => void }) {
  const [members, setMembers] = useState<McpGroupMember[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(
    async (offset = 0) => {
      setLoading(true);
      try {
        const result = await McpAccessService.listGroupMembers(group.id, {
          limit: MEMBERS_PAGE_SIZE,
          offset,
        });
        setMembers((prev) => (offset === 0 ? result.data : [...prev, ...result.data]));
        setTotal(result.pagination.total);
        setHasMore(result.pagination.has_more);
      } catch (e) {
        toast.error(`Failed to load members: ${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    },
    [group.id],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const addMember = async (personId: string, email: string) => {
    setBusy(true);
    try {
      await McpAccessService.addGroupMember(group.id, personId);
      toast.success(`Added ${email} to "${group.label}"`);
      setAddOpen(false);
      load(0);
    } catch (e) {
      toast.error(`Failed to add member: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (member: McpGroupMember) => {
    setBusy(true);
    try {
      await McpAccessService.removeGroupMember(group.id, member.person_id);
      toast.success(`Removed ${member.email}`);
      setMembers((prev) => prev.filter((m) => m.person_id !== member.person_id));
      setTotal((prev) => Math.max(0, prev - 1));
    } catch (e) {
      toast.error(`Failed to remove member: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`"${group.label}" members`}
      size="lg"
      resizable={false}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-[var(--gray-11)]">
            {total} explicit member{total === 1 ? '' : 's'}. Rule-matched people are not listed
            here — they match the group automatically.
          </p>
          <Button variant="soft" size="1" onClick={() => setAddOpen((v) => !v)}>
            <PlusIcon className="size-4 mr-1" />
            {addOpen ? 'Close search' : 'Add person'}
          </Button>
        </div>

        {addOpen && (
          <div className="border border-[var(--gray-a6)] rounded-md p-3">
            <PersonSearchInput
              autoFocus
              disabled={busy}
              onSelect={(person) => addMember(person.id, person.email)}
            />
          </div>
        )}

        {loading && members.length === 0 ? (
          <div className="flex justify-center py-8">
            <div className="size-5 border-2 border-[var(--accent-9)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-[var(--gray-11)] py-4 text-center">No explicit members yet.</p>
        ) : (
          <div className="border border-[var(--gray-a6)] rounded-md divide-y divide-[var(--gray-a4)] max-h-80 overflow-y-auto">
            {members.map((member) => (
              <div key={member.person_id} className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--gray-12)] truncate">
                    {member.name || member.email}
                  </p>
                  <p className="text-xs text-[var(--gray-11)] truncate">{member.email}</p>
                </div>
                <span className="text-xs text-[var(--gray-10)] whitespace-nowrap">
                  Added {new Date(member.added_at).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  color="red"
                  size="1"
                  isIcon
                  onClick={() => removeMember(member)}
                  disabled={busy}
                  title="Remove from group"
                >
                  <XMarkIcon className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center">
            <Button variant="outline" size="1" onClick={() => load(members.length)} disabled={loading}>
              {loading ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
