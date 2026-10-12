// Framework-free GoTrue session handling for the admin BFF. Callers persist
// the returned values (in the session store); nothing in this module touches
// HTTP requests or responses. Ported from the PoC's admin/server/core/session.ts.
import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import { safeReturnTo } from './host-session.js';

export { safeReturnTo } from './host-session.js';

// Where the core reports failures it handles (a Fastify or pino logger fits).
// Messages never include tokens.
export interface CoreLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface BffConfig {
  // Supabase origin as seen from the BFF (SUPABASE_INTERNAL_URL).
  supabaseUrl: string;
  // Supabase origin as seen from the browser (SUPABASE_PUBLIC_URL). The
  // GoTrue authorize URL is rewritten to it.
  publicSupabaseUrl: string;
  anonKey: string;
  // Public origin of the admin SPA and this BFF (ADMIN_URL).
  siteUrl: string;
  // GoTrue provider identifier (OIDC_IDENTIFIER), e.g. custom:lfid.
  provider: string;
  log?: CoreLogger;
}

export interface GwSession {
  access_token: string;
  refresh_token: string;
  // Seconds since the epoch.
  expires_at: number;
  user_id: string;
  is_admin: boolean;
  // 'pending' when the admin_profiles check could not be made (is_admin is
  // then false only to fail closed, and expires_at is short so the check is
  // retried). Absent on records written before this field: read as 'ok'.
  admin_check?: 'ok' | 'pending';
}

export function isAdminCheckPending(s: GwSession): boolean {
  return s.admin_check === 'pending';
}

// Seconds until a pending admin check is retried (the session refreshes
// REFRESH_SKEW_SECONDS before expires_at), for a Retry-After header.
export function retryAfterSeconds(s: GwSession): number {
  return Math.max(1, Math.ceil(s.expires_at - REFRESH_SKEW_SECONDS - Date.now() / 1000));
}

// PKCE state carried in the short-lived flow cookie between login and callback.
export interface LoginFlow {
  storage: Record<string, string>;
  returnTo: string;
}

// GoTrue or Redis could not give an answer (network error, timeout, 5xx, 408,
// 429), so whether the session is still good is unknown. The session is kept
// and the caller answers 503.
export class SessionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionUnavailableError';
  }
}

// GoTrue says the access token is no longer good (401, 403 or 404 from
// /user): the session is over.
export class SessionEndedError extends Error {}

// Thrown when GoTrue could not be reached or answered with a server error, so
// the refresh outcome is unknown. The session is kept; the caller answers 503
// and the next request tries again. (The PoC signed the user out on any
// refresh failure, which turns a GoTrue blip into a mass sign-out.)
export class RefreshUnavailableError extends SessionUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = 'RefreshUnavailableError';
  }
}

// The same split refreshSession makes: no answer, or an answer that says
// nothing about the token.
export function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

export const REFRESH_SKEW_SECONDS = 60;
// How soon a refresh whose admin_profiles read failed is retried.
export const ADMIN_RECHECK_SECONDS = 15;
// Every call this module makes to GoTrue or PostgREST is bounded, so a hung
// upstream can't hold a request (or the refresh lock) open indefinitely. A
// refresh is one token call plus one admin_profiles read, so the refresh lock
// in store.ts (LOCK_MS) must exceed REFRESH_TIMEOUT_MS + ADMIN_CHECK_TIMEOUT_MS.
export const REFRESH_TIMEOUT_MS = 10_000;
export const ADMIN_CHECK_TIMEOUT_MS = 10_000;
const UPSTREAM_TIMEOUT_MS = 10_000;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  const storage: SupportedStorage = {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
  return { data, storage };
}

const timedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });

const fetchWithin = (ms: number, input: string, init: RequestInit = {}) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(ms) });

function gotrue(cfg: BffConfig, initial?: Record<string, string>) {
  const mem = memoryStorage(initial);
  const client = createClient(cfg.supabaseUrl, cfg.anonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: mem.storage,
    },
    global: { fetch: timedFetch },
  });
  return { client, mem };
}

export async function startLogin(cfg: BffConfig, returnTo: string): Promise<{ url: string; flow: LoginFlow }> {
  const { client, mem } = gotrue(cfg);
  const { data, error } = await client.auth.signInWithOAuth({
    // Custom providers aren't in the SDK's Provider union.
    provider: cfg.provider as never,
    options: { redirectTo: `${cfg.siteUrl}/bff/callback`, skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new Error(error?.message ?? 'GoTrue returned no authorize URL');
  // GoTrue builds the authorize URL from the internal gateway host; rewrite it for the browser.
  const url = data.url.startsWith(cfg.supabaseUrl)
    ? cfg.publicSupabaseUrl + data.url.slice(cfg.supabaseUrl.length)
    : data.url;
  return { url, flow: { storage: mem.data, returnTo: safeReturnTo(returnTo) } };
}

export async function finishLogin(cfg: BffConfig, code: string, flow: LoginFlow): Promise<GwSession> {
  const { client } = gotrue(cfg, flow.storage);
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error || !data.session) throw new Error(error?.message ?? 'code exchange returned no session');
  return toGwSession(cfg, data.session);
}

// Builds the stored session and runs the admin_profiles check. Used at
// sign-in and on every refresh. If the check can't be completed (network
// error, timeout, or any non-200 answer), the tokens are still kept, because
// GoTrue has already issued (or rotated) them. The session fails closed: it
// is not an admin, and its expiry is set so the next request after
// ADMIN_RECHECK_SECONDS refreshes it and repeats the check.
async function toGwSession(
  cfg: BffConfig,
  s: { access_token: string; refresh_token: string; expires_at?: number; user: { id: string } },
): Promise<GwSession> {
  const expires_at = s.expires_at ?? Math.floor(Date.now() / 1000) + 300;
  const base = { access_token: s.access_token, refresh_token: s.refresh_token, user_id: s.user.id };
  try {
    return { ...base, expires_at, is_admin: await isAdmin(cfg, s.access_token, s.user.id), admin_check: 'ok' };
  } catch (e) {
    cfg.log?.warn({ err: (e as Error).message, user_id: s.user.id }, 'admin_profiles check failed; failing closed and retrying');
    const recheckAt = Math.floor(Date.now() / 1000) + REFRESH_SKEW_SECONDS + ADMIN_RECHECK_SECONDS;
    return { ...base, expires_at: Math.min(expires_at, recheckAt), is_admin: false, admin_check: 'pending' };
  }
}

export class AdminCheckError extends Error {}

// Authorization is separate from sign-in: an active admin_profiles row is
// required, read with the user's own token under RLS. Resolves false only on
// a definite answer (a 200 with no active row). Throws AdminCheckError on any
// other response or a network failure, so the caller can fail closed and
// retry instead of recording a transient error as "not an admin".
export async function isAdmin(cfg: BffConfig, accessToken: string, userId: string): Promise<boolean> {
  const url = `${cfg.supabaseUrl}/rest/v1/admin_profiles?select=is_active&user_id=eq.${encodeURIComponent(userId)}`;
  let res: Response;
  try {
    res = await fetchWithin(ADMIN_CHECK_TIMEOUT_MS, url, {
      headers: { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new AdminCheckError((e as Error).message);
  }
  if (res.status !== 200) throw new AdminCheckError(`admin_profiles returned ${res.status}`);
  let rows: unknown;
  try {
    rows = await res.json();
  } catch (e) {
    throw new AdminCheckError((e as Error).message);
  }
  if (!Array.isArray(rows)) throw new AdminCheckError('admin_profiles returned a non-array');
  return (rows[0] as { is_active?: unknown } | undefined)?.is_active === true;
}

// True when the access token expires within the refresh skew.
export function needsRefresh(s: GwSession): boolean {
  return s.expires_at - REFRESH_SKEW_SECONDS <= Date.now() / 1000;
}

interface GoTrueSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: { id: string };
}

// Exchanges the refresh token for a new session. GoTrue rotates refresh
// tokens, so callers must serialize refreshes per session. Throws
// RefreshUnavailableError when the outcome is unknown (network error,
// timeout, 5xx), and a plain Error when GoTrue refused the refresh token
// (the session is over).
//
// This calls GoTrue's token endpoint directly rather than through
// supabase-js (as the PoC did): auth-js retries a retryable refresh with
// backoff for up to 30 seconds, which would hold the request, and the
// refresh lock, far past LOCK_MS during a GoTrue outage.
export async function refreshSession(cfg: BffConfig, s: GwSession): Promise<GwSession> {
  let res: Response;
  try {
    res = await fetchWithin(REFRESH_TIMEOUT_MS, `${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
  } catch (e) {
    throw new RefreshUnavailableError((e as Error).message);
  }
  // 5xx, 408 (timeout) and 429 (rate limited) say nothing about the refresh
  // token itself, so the session is kept and the caller retries.
  if (isTransientStatus(res.status)) {
    throw new RefreshUnavailableError(`GoTrue refresh returned ${res.status}`);
  }
  if (!res.ok) throw new Error(`GoTrue refused the refresh token (${res.status})`);
  let session: GoTrueSession;
  try {
    session = (await res.json()) as GoTrueSession;
  } catch (e) {
    throw new RefreshUnavailableError((e as Error).message);
  }
  if (!session?.access_token || !session.refresh_token || !session.user?.id) {
    throw new RefreshUnavailableError('GoTrue refresh returned no session');
  }
  const data = {
    session: {
      ...session,
      expires_at: session.expires_at ?? (session.expires_in ? Math.floor(Date.now() / 1000) + session.expires_in : undefined),
    },
  };
  return toGwSession(cfg, data.session);
}

// Reads the user from GoTrue. Throws SessionEndedError on 401, 403 or 404
// (the token is no longer good) and SessionUnavailableError when GoTrue gave
// no usable answer.
export async function getUser(cfg: BffConfig, accessToken: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await timedFetch(`${cfg.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new SessionUnavailableError((e as Error).message);
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new SessionEndedError(`GoTrue /user returned ${res.status}`);
  }
  if (!res.ok) throw new SessionUnavailableError(`GoTrue /user returned ${res.status}`);
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    throw new SessionUnavailableError((e as Error).message);
  }
}

// Revokes the refresh token at GoTrue. The IdP's SSO session is left alone.
// GoTrue authenticates the call with the access token, so the caller should
// pass a session refreshed if needed. Resolves false (and logs) when GoTrue
// could not be reached or refused; the refresh token then stays valid at
// GoTrue until it expires, though the BFF has already forgotten it.
export async function logout(cfg: BffConfig, s: GwSession): Promise<boolean> {
  try {
    const res = await timedFetch(`${cfg.supabaseUrl}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, authorization: `Bearer ${s.access_token}` },
    });
    if (res.ok) return true;
    cfg.log?.warn({ status: res.status, user_id: s.user_id }, 'GoTrue logout refused; refresh token not revoked');
  } catch (e) {
    cfg.log?.warn({ err: (e as Error).message, user_id: s.user_id }, 'GoTrue logout failed; refresh token not revoked');
  }
  return false;
}
