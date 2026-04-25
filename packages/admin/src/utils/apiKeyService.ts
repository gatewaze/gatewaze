export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  rateLimitRpm: number;
  writeRateLimitRpm: number;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  totalRequests: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApiKeyInput {
  name: string;
  scopes?: string[];
  rateLimitRpm?: number;
  writeRateLimitRpm?: number;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateApiKeyResult {
  apiKey: string; // raw key — shown once
  key: ApiKey;
}

const apiUrl = (): string => import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiUrl()}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message ?? body?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const ApiKeyService = {
  async list(opts: { active?: boolean; limit?: number; offset?: number } = {}): Promise<{
    data: ApiKey[];
    pagination: { total: number; limit: number; offset: number; has_more: boolean };
  }> {
    const params = new URLSearchParams();
    if (opts.active !== undefined) params.set('active', String(opts.active));
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request(`/api/api-keys${qs ? `?${qs}` : ''}`);
  },

  async create(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    const result = await request<{ data: CreateApiKeyResult }>('/api/api-keys', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.data;
  },

  async update(id: string, patch: Partial<CreateApiKeyInput & { isActive: boolean }>): Promise<ApiKey> {
    const result = await request<{ data: ApiKey }>(`/api/api-keys/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return result.data;
  },

  async revoke(id: string): Promise<void> {
    await request(`/api/api-keys/${id}`, { method: 'DELETE' });
  },

  async getScopes(): Promise<Array<{ scope: string; description: string; moduleId: string }>> {
    const result = await request<{ data: Array<{ scope: string; description: string; moduleId: string }> }>(
      '/api/api-keys/scopes',
    );
    return result.data;
  },
};
