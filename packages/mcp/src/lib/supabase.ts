/**
 * API client for the Gatewaze public API.
 * The MCP server accesses data through the public API with an API key,
 * NOT directly via Supabase service_role.
 */

export interface ApiClientOptions {
  baseUrl: string;   // e.g. http://localhost:3002/api/v1
  apiKey: string;    // gw_live_...
}

/**
 * The public API's error envelope is `{error:{code,message,details?}}`.
 * Non-2xx responses throw this so callers keep the HTTP status and the
 * machine-readable code/details (e.g. a 409 ALREADY_TRACKED carries the
 * existing row's id in details) — `message` stays what it always was, so
 * anything catching a plain Error is unaffected.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? `API error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error?.code;
    this.details = body.error?.details;
  }
}

type ApiErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

async function throwApiError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({ error: { message: res.statusText } }))) as ApiErrorBody;
  throw new ApiError(res.status, body);
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
    if (!res.ok) await throwApiError(res);
    return res.json() as Promise<T>;
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.send('POST', path, body);
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.send('PATCH', path, body);
  }

  async put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.send('PUT', path, body);
  }

  private async send<T = unknown>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) await throwApiError(res);
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
