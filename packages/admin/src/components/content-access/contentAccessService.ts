import { getApiBaseUrl } from '@/config/brands';
import { supabase } from '@/lib/supabase';

// A row in the content_access_policies registry (content-platform migration 008).
export interface ContentAccessPolicy {
  id: string;
  content_type: string;
  entity_id: string | null;      // null = per-type default; else per-item override
  audience: 'public' | 'members';
  min_tier_rank: number;         // 0 = any member; else >= this membership_tier_ranks.rank
  embargo_days: number | null;   // recent-content window (members-only for N days, then public)
  gated_actions: string[];       // e.g. ['register'] for events
  placeholder: Record<string, unknown> | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccessTier {
  tier: string;
  rank: number;
  display_label: string;
  color?: string | null;
  sort_order: number;
}

const base = () => getApiBaseUrl();

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${base()}${input}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(init?.headers ?? {}) },
    ...init,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw Object.assign(new Error(body?.error?.message ?? r.statusText), {
      code: body?.error?.code ?? `http_${r.status}`,
      status: r.status,
    });
  }
  return r.json();
}

export interface SetPolicyArgs {
  content_type: string;
  entity_id?: string | null;
  audience: 'public' | 'members';
  min_tier_rank?: number;
  embargo_days?: number | null;
  gated_actions?: string[];
  placeholder?: Record<string, unknown> | null;
  note?: string | null;
}

// All routes are admin-gated (requireAdmin) on the content-platform module API.
export const contentAccessService = {
  async listPolicies(contentType?: string): Promise<ContentAccessPolicy[]> {
    const q = contentType ? `?content_type=${encodeURIComponent(contentType)}` : '';
    const r = await jsonFetch<{ policies: ContentAccessPolicy[] }>(`/admin/content-access${q}`);
    return r.policies ?? [];
  },
  // Convenience: the policy for a specific item (or null).
  async getPolicy(contentType: string, entityId: string): Promise<ContentAccessPolicy | null> {
    const all = await this.listPolicies(contentType);
    return all.find((p) => p.entity_id === entityId) ?? null;
  },
  async setPolicy(args: SetPolicyArgs): Promise<ContentAccessPolicy> {
    const r = await jsonFetch<{ policy: ContentAccessPolicy }>(`/admin/content-access`, {
      method: 'PUT',
      body: JSON.stringify(args),
    });
    return r.policy;
  },
  async clearPolicy(contentType: string, entityId?: string | null): Promise<void> {
    await jsonFetch<{ cleared: boolean }>(`/admin/content-access`, {
      method: 'DELETE',
      body: JSON.stringify({ content_type: contentType, entity_id: entityId ?? null }),
    });
  },
  // Membership tiers (for the tier picker); driven by membership_tier_ranks.
  async listTiers(): Promise<AccessTier[]> {
    try {
      const r = await jsonFetch<{ data: AccessTier[] }>(`/membership/tiers`);
      return (r.data ?? []).slice().sort((a, b) => a.rank - b.rank);
    } catch {
      return []; // membership module absent -> no tier picker, "any member" still works
    }
  },
};
