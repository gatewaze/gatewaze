/**
 * API client for the Gatewaze public API.
 * The MCP server accesses data through the public API with an API key,
 * NOT directly via Supabase service_role.
 */

export interface ApiClientOptions {
  baseUrl: string;   // e.g. http://localhost:3002/api/v1
  apiKey: string;    // gw_live_...
}

export class GatewazeApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
  }

  async get<T = unknown>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), {
      headers: { 'X-API-Key': this.apiKey },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(body.error?.message ?? `API error ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const respBody = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(respBody.error?.message ?? `API error ${res.status}`);
    }
    return res.json() as Promise<T>;
  }
}

export function createApiClient(): GatewazeApiClient {
  const baseUrl = process.env.GATEWAZE_API_URL ?? 'http://localhost:3002';
  const apiKey = process.env.GATEWAZE_MCP_API_KEY;
  if (!apiKey) {
    throw new Error('GATEWAZE_MCP_API_KEY is required — create an API key via the admin UI and set it here');
  }
  return new GatewazeApiClient({
    baseUrl: `${baseUrl}/api/v1`,
    apiKey,
  });
}
