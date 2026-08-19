import { useEffect, useMemo, useState } from 'react';
import { Card, Radio, Select, Input } from '@/components/ui';
import { contentAccessService, type AccessTier, type ContentAccessPolicy } from './contentAccessService';

/**
 * Unified access control for a content item, backed by the content_access_policies
 * registry (content-platform). One component for every content type:
 *
 *   - Status (optional): Draft = admin-only / Published — bound to the editor's
 *     own status field via `status` + `onStatusChange` (the editor persists it
 *     on its normal save). "Admin only" == draft.
 *   - When published, the gate:
 *       * visibility types (newsletter_edition / blog_post / resource /
 *         podcast_episode): Everyone / Members-only (+ tier); editions also get
 *         an Embargo (members-only for N days, then public).
 *       * event: Registration Everyone / Members-only (+ tier) — the event stays
 *         visible; only signing up is gated (gated_actions=['register']).
 *
 * The gate saves to the registry immediately on change (idempotent PUT, or DELETE
 * when set back to Everyone). Membership tiers drive the tier picker from the
 * authoritative membership_tier_ranks.
 */
export interface ContentAccessControlProps {
  contentType: 'newsletter_edition' | 'blog_post' | 'resource' | 'podcast_episode' | 'event' | string;
  entityId: string;
  /** Current status value from the editor's form (enables the Draft/Published row). */
  status?: string;
  onStatusChange?: (value: string) => void;
  draftValue?: string;
  publishedValue?: string;
  className?: string;
}

type Mode = 'everyone' | 'members' | 'embargo';

export function ContentAccessControl({
  contentType,
  entityId,
  status,
  onStatusChange,
  draftValue = 'draft',
  publishedValue = 'published',
  className,
}: ContentAccessControlProps) {
  const isEvent = contentType === 'event';
  const supportsEmbargo = contentType === 'newsletter_edition';
  const label = isEvent ? 'Registration' : 'Who can see this';

  const [loading, setLoading] = useState(true);
  const [tiers, setTiers] = useState<AccessTier[]>([]);
  const [mode, setMode] = useState<Mode>('everyone');
  const [tierRank, setTierRank] = useState(0);
  const [embargoDays, setEmbargoDays] = useState(30);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load tiers + the current policy.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [t, pol] = await Promise.all([
          contentAccessService.listTiers(),
          contentAccessService.getPolicy(contentType, entityId),
        ]);
        if (!alive) return;
        setTiers(t);
        applyPolicy(pol);
      } catch (e) {
        if (alive) setErrorMsg((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentType, entityId]);

  function applyPolicy(pol: ContentAccessPolicy | null) {
    if (!pol) { setMode('everyone'); setTierRank(0); return; }
    if (isEvent) {
      setMode(pol.gated_actions?.includes('register') ? 'members' : 'everyone');
    } else if (pol.embargo_days) {
      setMode('embargo'); setEmbargoDays(pol.embargo_days);
    } else {
      setMode(pol.audience === 'members' ? 'members' : 'everyone');
    }
    setTierRank(pol.min_tier_rank ?? 0);
  }

  const tierOptions = useMemo(
    () => [
      { value: 0, label: 'Any member' },
      ...tiers.map((t) => ({ value: t.rank, label: `${t.display_label} or higher` })),
    ],
    [tiers],
  );

  // Persist the current selection to the registry (or clear it when fully open).
  async function save(next: { mode: Mode; tierRank: number; embargoDays: number }) {
    setSaveState('saving'); setErrorMsg(null);
    try {
      if (next.mode === 'everyone') {
        await contentAccessService.clearPolicy(contentType, entityId);
      } else if (isEvent) {
        await contentAccessService.setPolicy({
          content_type: contentType, entity_id: entityId,
          audience: 'public', min_tier_rank: next.tierRank, gated_actions: ['register'],
          note: 'Members-only registration',
        });
      } else if (next.mode === 'embargo') {
        await contentAccessService.setPolicy({
          content_type: contentType, entity_id: entityId,
          audience: 'public', min_tier_rank: next.tierRank, embargo_days: next.embargoDays,
        });
      } else {
        await contentAccessService.setPolicy({
          content_type: contentType, entity_id: entityId,
          audience: 'members', min_tier_rank: next.tierRank,
        });
      }
      setSaveState('saved');
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch (e) {
      setSaveState('error'); setErrorMsg((e as Error).message);
    }
  }

  const update = (patch: Partial<{ mode: Mode; tierRank: number; embargoDays: number }>) => {
    const next = { mode, tierRank, embargoDays, ...patch };
    setMode(next.mode); setTierRank(next.tierRank); setEmbargoDays(next.embargoDays);
    void save(next);
  };

  // Draft == admin-only. Driven by the status VALUE (read-only) so the progressive
  // hint works whether or not this control owns the status field; the editable
  // Draft/Published radio only appears when an editor opts in via onStatusChange
  // (avoids a second status control next to the editor's existing one).
  const isDraft = status != null && status !== publishedValue;
  const showTier = mode === 'members' || mode === 'embargo';

  return (
    <Card className={className}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--gray-12)]">Access</h3>
        <span className="text-xs text-[var(--gray-a10)]">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved ✓'}
          {saveState === 'error' && <span className="text-[var(--red-9)]">Save failed</span>}
        </span>
      </div>

      {onStatusChange && (
        <div className="mt-3">
          <div className="text-xs font-medium text-[var(--gray-11)] mb-1">Status</div>
          <div className="flex flex-col gap-1">
            <Radio name={`status-${entityId}`} label="Draft — admin only"
              checked={status !== publishedValue}
              onChange={() => onStatusChange(draftValue)} />
            <Radio name={`status-${entityId}`} label="Published"
              checked={status === publishedValue}
              onChange={() => onStatusChange(publishedValue)} />
          </div>
        </div>
      )}

      {isDraft ? (
        <p className="mt-3 text-xs text-[var(--gray-a10)]">
          This {contentType.replace(/_/g, ' ')} is a draft — visible to admins only. Publish it to apply access rules.
        </p>
      ) : (
        <div className="mt-3">
          <div className="text-xs font-medium text-[var(--gray-11)] mb-1">{label}</div>
          <div className="flex flex-col gap-1">
            <Radio name={`vis-${entityId}`} label={isEvent ? 'Anyone can register' : 'Everyone'}
              checked={mode === 'everyone'} onChange={() => update({ mode: 'everyone' })} />
            <Radio name={`vis-${entityId}`} label={isEvent ? 'Members only' : 'Members only'}
              checked={mode === 'members'} onChange={() => update({ mode: 'members' })} />
            {supportsEmbargo && (
              <Radio name={`vis-${entityId}`} label="Members-only for a while, then public"
                checked={mode === 'embargo'} onChange={() => update({ mode: 'embargo' })} />
            )}
          </div>

          {showTier && (
            <div className="mt-2 pl-6">
              <Select label="Minimum tier" value={tierRank}
                data={tierOptions}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => update({ tierRank: Number(e.target.value) })} />
            </div>
          )}
          {mode === 'embargo' && (
            <div className="mt-2 pl-6">
              <Input label="Members-only for (days)" type="number" min={1} value={embargoDays}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ embargoDays: Math.max(1, Number(e.target.value) || 1) })} />
            </div>
          )}
        </div>
      )}

      {errorMsg && <p className="mt-2 text-xs text-[var(--red-9)]">{errorMsg}</p>}
      {loading && <p className="mt-2 text-xs text-[var(--gray-a10)]">Loading…</p>}
    </Card>
  );
}

export default ContentAccessControl;
