import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  ArrowTopRightOnSquareIcon,
  NoSymbolIcon,
  ShieldCheckIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { Badge, Button, Card, ConfirmModal } from '@/components/ui';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Form/Textarea';
import { ScopePicker } from '@/components/mcp/ScopePicker';
import {
  McpAccessService,
  type McpPersonAccess,
  type McpScopeOption,
  type McpSession,
} from '@/utils/mcpAccessService';

interface PersonMcpAccessPanelProps {
  personId: string;
  /** Display label for confirmations (name or email). */
  personLabel?: string;
  /**
   * Where "View activity" links to. Callers pass a route that lands on the
   * Activity tab pre-filtered to this person, e.g.
   * `/admin/api-keys?tab=activity&person_id=<id>`.
   */
  activityTo?: string;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

/**
 * Per-person MCP access panel: effective scopes with derivation, the
 * scopes_add / scopes_remove grants editor, and the person's sessions with
 * revoke. Shared between the "MCP People" tab on the API & MCP Access page
 * and the person-detail page's "MCP Access" tab.
 */
export function PersonMcpAccessPanel({ personId, personLabel, activityTo }: PersonMcpAccessPanelProps) {
  const [access, setAccess] = useState<McpPersonAccess | null>(null);
  const [sessions, setSessions] = useState<McpSession[]>([]);
  const [scopeOptions, setScopeOptions] = useState<McpScopeOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Grants editor state
  const [scopesAdd, setScopesAdd] = useState<Set<string>>(new Set());
  const [scopesRemove, setScopesRemove] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [savingGrants, setSavingGrants] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<McpSession | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accessResult, sessionsResult] = await Promise.all([
        McpAccessService.getPersonAccess(personId),
        McpAccessService.listSessions({ person_id: personId, limit: 100 }),
      ]);
      setAccess(accessResult);
      setSessions(sessionsResult.data);
      setScopesAdd(new Set(accessResult.grants?.scopes_add ?? []));
      setScopesRemove(new Set(accessResult.grants?.scopes_remove ?? []));
      setNote(accessResult.grants?.note ?? '');
    } catch (e) {
      toast.error(`Failed to load MCP access: ${(e as Error).message}`);
      setAccess(null);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    McpAccessService.getScopes()
      .then(setScopeOptions)
      .catch((e) => toast.error(`Failed to load scope catalog: ${(e as Error).message}`));
  }, []);

  // Group the derivation lines by scope so each scope shows every path that
  // grants it ("events:read — via Members, LF Staff").
  const derivationByScope = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of access?.derivation ?? []) {
      const vias = map.get(entry.scope) ?? [];
      vias.push(entry.via);
      map.set(entry.scope, vias);
    }
    return map;
  }, [access]);

  const saveGrants = async () => {
    setSavingGrants(true);
    try {
      await McpAccessService.setPersonGrants(personId, {
        scopes_add: Array.from(scopesAdd),
        scopes_remove: Array.from(scopesRemove),
        note: note.trim(),
      });
      toast.success('Grants saved');
      load();
    } catch (e) {
      toast.error(`Failed to save grants: ${(e as Error).message}`);
    } finally {
      setSavingGrants(false);
    }
  };

  const revokeSession = async () => {
    if (!revokeTarget) return;
    try {
      await McpAccessService.revokeSession(revokeTarget.id);
      toast.success('Session revoked');
      setRevokeTarget(null);
      load();
    } catch (e) {
      toast.error(`Failed to revoke session: ${(e as Error).message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!access) {
    return (
      <p className="text-sm text-[var(--gray-11)]">
        Could not load MCP access for this person.
      </p>
    );
  }

  const activeSessions = sessions.filter((s) => !s.revoked_at);

  return (
    <div className="space-y-6">
      {/* Effective scopes with derivation */}
      <Card variant="surface" className="p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-[var(--gray-12)] flex items-center gap-2">
            <ShieldCheckIcon className="size-4" />
            Effective scopes
          </h3>
          {activityTo && (
            <Link
              to={activityTo}
              className="text-xs text-[var(--accent-11)] hover:underline inline-flex items-center gap-1"
            >
              View activity
              <ArrowTopRightOnSquareIcon className="size-3.5" />
            </Link>
          )}
        </div>

        {access.groups.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <UserGroupIcon className="size-4 text-[var(--gray-a9)]" />
            {access.groups.map((g) => (
              <Badge key={g.id} variant="soft" color="blue" title={g.name}>
                {g.label}
              </Badge>
            ))}
          </div>
        )}

        {access.effective_scopes.length === 0 ? (
          <p className="text-sm text-[var(--gray-11)]">
            No effective scopes — this person currently gets the anonymous tool surface.
          </p>
        ) : (
          <ul className="space-y-1">
            {access.effective_scopes.map((scope) => {
              const vias = derivationByScope.get(scope);
              return (
                <li key={scope} className="text-sm">
                  <code className="text-xs font-medium">{scope}</code>
                  {vias && vias.length > 0 && (
                    <span className="text-xs text-[var(--gray-11)]"> — via {vias.join(', ')}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Grants editor */}
      <Card variant="surface" className="p-4">
        <h3 className="text-sm font-semibold text-[var(--gray-12)] mb-1">Personal grants</h3>
        <p className="text-xs text-[var(--gray-11)] mb-3">
          Fine-grained overrides applied on top of group scopes. Added scopes extend access;
          removed scopes are subtracted even if a group would grant them. Changes apply to
          newly issued tokens.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Add scopes</label>
            <ScopePicker
              options={scopeOptions}
              selected={scopesAdd}
              onChange={setScopesAdd}
              maxHeightClass="max-h-48"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Remove scopes</label>
            <ScopePicker
              options={scopeOptions}
              selected={scopesRemove}
              onChange={setScopesRemove}
              maxHeightClass="max-h-48"
            />
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium mb-1">Note</label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this person has custom access (visible to admins only)…"
            rows={2}
          />
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={saveGrants} disabled={savingGrants}>
            {savingGrants ? 'Saving…' : 'Save grants'}
          </Button>
        </div>
      </Card>

      {/* Sessions */}
      <Card variant="surface" className="p-4">
        <h3 className="text-sm font-semibold text-[var(--gray-12)] mb-3">
          Sessions{' '}
          <span className="font-normal text-[var(--gray-11)]">
            ({activeSessions.length} active)
          </span>
        </h3>
        {sessions.length === 0 ? (
          <p className="text-sm text-[var(--gray-11)]">No MCP sessions for this person yet.</p>
        ) : (
          <div className="divide-y divide-[var(--gray-a4)]">
            {sessions.map((session) => (
              <div key={session.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[var(--gray-12)]">
                      {session.client_name || 'Unknown client'}
                    </span>
                    <Badge variant="soft" color="gray">
                      {session.auth_mode}
                    </Badge>
                    {session.revoked_at ? (
                      <Badge variant="soft" color="red">
                        Revoked
                      </Badge>
                    ) : (
                      <Badge variant="soft" color="green">
                        Active
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-[var(--gray-11)] mt-0.5">
                    Issued {formatDateTime(session.issued_at)} · Last seen{' '}
                    {formatDateTime(session.last_seen_at)} · {session.scopes.length} scope
                    {session.scopes.length === 1 ? '' : 's'}
                  </p>
                </div>
                {!session.revoked_at && (
                  <Button
                    variant="outline"
                    color="red"
                    size="1"
                    onClick={() => setRevokeTarget(session)}
                    className="gap-1"
                  >
                    <NoSymbolIcon className="size-3.5" />
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmModal
        isOpen={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={revokeSession}
        title="Revoke MCP session?"
        message={`This immediately kills the refresh token for ${
          revokeTarget?.client_name || 'this client'
        }${personLabel ? ` (${personLabel})` : ''}. The client will need to sign in again.`}
        confirmText="Revoke"
        confirmVariant="danger"
      />
    </div>
  );
}
