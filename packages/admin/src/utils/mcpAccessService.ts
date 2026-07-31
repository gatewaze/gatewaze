import { supabase } from '@/lib/supabase';

// Types mirror the /api/mcp-admin/* backend contract.

export interface McpGroupRule {
  id: string;
  kind: 'email_domain' | 'all_authenticated';
  match: string;
  is_active: boolean;
}

export interface McpGroup {
  id: string;
  name: string;
  label: string;
  scopes: string[];
  is_default: boolean;
  is_active: boolean;
  rules: McpGroupRule[];
  member_count: number;
  /** Distinct signed-in people matched by this group's active rules (not explicit members). */
  rule_matched_count?: number;
}

export interface McpGroupMember {
  person_id: string;
  name: string;
  email: string;
  added_at: string;
}

export interface McpPersonGrants {
  scopes_add: string[];
  scopes_remove: string[];
  note: string;
}

export interface McpPersonAccess {
  effective_scopes: string[];
  derivation: Array<{ scope: string; via: string }>;
  groups: Array<{ id: string; name: string; label: string }>;
  grants: McpPersonGrants | null;
}

export interface McpSession {
  id: string;
  person_id: string;
  person_name: string;
  email: string;
  auth_mode: string;
  client_name: string;
  scopes: string[];
  issued_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export type McpActivityOutcome = 'ok' | 'error' | 'unknown_tool' | 'insufficient_scope';

export interface McpActivityEntry {
  ts: string;
  identity_kind: 'anonymous' | 'oauth' | 'api_key';
  email: string | null;
  person_id: string | null;
  tier: string | null;
  client_name: string | null;
  era: string | null;
  tool: string;
  args: unknown;
  outcome: McpActivityOutcome;
  error: string | null;
  ms: number;
}

export interface McpScopeOption {
  scope: string;
  description: string;
}

export interface McpPagination {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

const apiUrl = (): string => import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // /api/mcp-admin is JWT-gated — plain fetch() carries no Supabase session,
  // so attach the access token per-call (same pattern as apiKeyService).
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(`${apiUrl()}${path}`, {
    ...init,
    headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message ?? body?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

export const McpAccessService = {
  // ---- Groups ----

  async listGroups(): Promise<McpGroup[]> {
    const result = await request<{ data: McpGroup[] }>('/api/mcp-admin/groups');
    return result.data;
  },

  async createGroup(input: { name: string; label: string; scopes: string[] }): Promise<McpGroup> {
    const result = await request<{ data: McpGroup }>('/api/mcp-admin/groups', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.data;
  },

  async updateGroup(
    id: string,
    patch: { label?: string; scopes?: string[]; is_active?: boolean },
  ): Promise<McpGroup> {
    const result = await request<{ data: McpGroup }>(`/api/mcp-admin/groups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return result.data;
  },

  async deleteGroup(id: string): Promise<void> {
    await request(`/api/mcp-admin/groups/${id}`, { method: 'DELETE' });
  },

  // ---- Group rules ----

  async addGroupRule(
    groupId: string,
    input: { kind: 'email_domain' | 'all_authenticated'; match: string },
  ): Promise<McpGroupRule> {
    const result = await request<{ data: McpGroupRule }>(`/api/mcp-admin/groups/${groupId}/rules`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.data;
  },

  async deleteGroupRule(groupId: string, ruleId: string): Promise<void> {
    await request(`/api/mcp-admin/groups/${groupId}/rules/${ruleId}`, { method: 'DELETE' });
  },

  // ---- Group members ----

  async listGroupMembers(
    groupId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ data: McpGroupMember[]; pagination: McpPagination }> {
    return request(`/api/mcp-admin/groups/${groupId}/members${qs(opts)}`);
  },

  async addGroupMember(groupId: string, personId: string): Promise<void> {
    await request(`/api/mcp-admin/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ person_id: personId }),
    });
  },

  async removeGroupMember(groupId: string, personId: string): Promise<void> {
    await request(`/api/mcp-admin/groups/${groupId}/members/${personId}`, { method: 'DELETE' });
  },

  // ---- Per-person access ----

  async getPersonAccess(personId: string): Promise<McpPersonAccess> {
    const result = await request<{ data: McpPersonAccess }>(
      `/api/mcp-admin/people/${personId}/access`,
    );
    return result.data;
  },

  async setPersonGrants(personId: string, grants: McpPersonGrants): Promise<McpPersonGrants> {
    const result = await request<{ data: McpPersonGrants }>(
      `/api/mcp-admin/people/${personId}/grants`,
      {
        method: 'PUT',
        body: JSON.stringify(grants),
      },
    );
    return result.data;
  },

  // ---- Sessions ----

  async listSessions(
    opts: { person_id?: string; limit?: number; offset?: number } = {},
  ): Promise<{ data: McpSession[]; pagination: McpPagination }> {
    return request(`/api/mcp-admin/sessions${qs(opts)}`);
  },

  async revokeSession(id: string): Promise<void> {
    await request(`/api/mcp-admin/sessions/${id}`, { method: 'DELETE' });
  },

  // ---- Activity ----

  async listActivity(
    opts: {
      person_id?: string;
      tool?: string;
      outcome?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ data: McpActivityEntry[]; pagination: McpPagination }> {
    return request(`/api/mcp-admin/activity${qs(opts)}`);
  },

  // ---- Scopes (for pickers) ----

  async getScopes(): Promise<McpScopeOption[]> {
    const result = await request<{ data: McpScopeOption[] }>('/api/mcp-admin/scopes');
    return result.data;
  },
};
