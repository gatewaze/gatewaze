// Framework-free GoTrue session handling for a host-session session holder.
// Callers persist the returned values (in the session store); nothing in this
// module touches HTTP requests or responses. Every call is plain fetch against
// GoTrue and PostgREST, so the package needs no Supabase client. Ported from
// the PoC's admin/server/core/session.ts.
export { safeReturnTo } from './host-session.js';

// Where the core reports failures it handles (a Fastify, pino or winston
// logger fits). Messages never include tokens.
export interface CoreLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface HostSessionConfig {
  // Supabase origin as seen from the session holder (the in-cluster URL).
  supabaseUrl: string;
  // The project's anon key: a legacy JWT anon key or an sb_publishable_ key.
  anonKey: string;
  // GoTrue provider identifier for the ID token grant. Default: custom:lfid.
  provider?: string;
  log?: CoreLogger;
}

export const DEFAULT_PROVIDER = 'custom:lfid';

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
  // The IdP subject the session belongs to (the `sub` of the ID token it was
  // minted from, or of the user's identity for the configured provider). A
  // host passes its own signed-in subject as expectedSub, and the store
  // treats a session for anyone else as no session. Absent when GoTrue gave
  // no identity for the provider, and on records written before this field.
  sub?: string;
}

// The message of a thrown value, whatever was thrown.
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function isAdminCheckPending(s: GwSession): boolean {
  return s.admin_check === 'pending';
}

// Seconds until a pending admin check is retried (the session refreshes
// REFRESH_SKEW_SECONDS before expires_at), for a Retry-After header.
export function retryAfterSeconds(s: GwSession): number {
  return Math.max(1, Math.ceil(s.expires_at - REFRESH_SKEW_SECONDS - Date.now() / 1000));
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

const timedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });

const fetchWithin = (ms: number, input: string, init: RequestInit = {}) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(ms) });

// Builds the stored session and runs the admin_profiles check. Used at
// sign-in and on every refresh. If the check can't be completed (network
// error, timeout, or any non-200 answer), the tokens are still kept, because
// GoTrue has already issued (or rotated) them. The session fails closed: it
// is not an admin, and its expiry is set so the next request after
// ADMIN_RECHECK_SECONDS refreshes it and repeats the check.
//
// `sub` is the IdP subject to record. When it is not given, it is read from
// the user's identity for cfg.provider, then from user_metadata.sub.
export async function toGwSession(
  cfg: HostSessionConfig,
  s: { access_token: string; refresh_token: string; expires_at?: number; user: GoTrueUser },
  sub?: string,
): Promise<GwSession> {
  const expires_at = s.expires_at ?? Math.floor(Date.now() / 1000) + 300;
  const subject = sub ?? identitySubject(s.user, cfg.provider ?? DEFAULT_PROVIDER);
  const base = {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    user_id: s.user.id,
    ...(subject === undefined ? {} : { sub: subject }),
  };
  try {
    return { ...base, expires_at, is_admin: await isAdmin(cfg, s.access_token, s.user.id), admin_check: 'ok' };
  } catch (e) {
    cfg.log?.warn({ err: errorMessage(e), user_id: s.user.id }, 'admin_profiles check failed; failing closed and retrying');
    const recheckAt = Math.floor(Date.now() / 1000) + REFRESH_SKEW_SECONDS + ADMIN_RECHECK_SECONDS;
    return { ...base, expires_at: Math.min(expires_at, recheckAt), is_admin: false, admin_check: 'pending' };
  }
}

// The parts of a GoTrue user this module reads.
export interface GoTrueUser {
  id: string;
  identities?: Array<{ provider?: unknown; id?: unknown; identity_data?: unknown }> | null;
  user_metadata?: unknown;
}

// The IdP subject GoTrue recorded for the user under `provider`.
export function identitySubject(user: GoTrueUser, provider: string): string | undefined {
  const identity = Array.isArray(user.identities) ? user.identities.find((i) => i?.provider === provider) : undefined;
  if (identity) {
    const data = identity.identity_data;
    const sub = data && typeof data === 'object' ? (data as Record<string, unknown>).sub : undefined;
    if (typeof sub === 'string' && sub) return sub;
    if (typeof identity.id === 'string' && identity.id) return identity.id;
  }
  const meta = user.user_metadata;
  const metaSub = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).sub : undefined;
  return typeof metaSub === 'string' && metaSub ? metaSub : undefined;
}

// The `sub` claim of a JWT, read without checking the signature. Only for a
// token GoTrue has just accepted, which has checked it.
export function unverifiedJwtSubject(jwt: string): string | undefined {
  const payload = jwt.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const sub = claims && typeof claims === 'object' ? (claims as Record<string, unknown>).sub : undefined;
    return typeof sub === 'string' && sub ? sub : undefined;
  } catch {
    // Not a JWT payload: the caller falls back to the GoTrue identity.
    return undefined;
  }
}

export class AdminCheckError extends Error {}

// Authorization is separate from sign-in: an active admin_profiles row is
// required, read with the user's own token under RLS. Resolves false only on
// a definite answer (a 200 with no active row). Throws AdminCheckError on any
// other response or a network failure, so the caller can fail closed and
// retry instead of recording a transient error as "not an admin".
export async function isAdmin(cfg: HostSessionConfig, accessToken: string, userId: string): Promise<boolean> {
  const url = `${cfg.supabaseUrl}/rest/v1/admin_profiles?select=is_active&user_id=eq.${encodeURIComponent(userId)}`;
  let res: Response;
  try {
    res = await fetchWithin(ADMIN_CHECK_TIMEOUT_MS, url, {
      headers: { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new AdminCheckError(errorMessage(e));
  }
  if (res.status !== 200) throw new AdminCheckError(`admin_profiles returned ${res.status}`);
  let rows: unknown;
  try {
    rows = await res.json();
  } catch (e) {
    throw new AdminCheckError(errorMessage(e));
  }
  if (!Array.isArray(rows)) throw new AdminCheckError('admin_profiles returned a non-array');
  return (rows[0] as { is_active?: unknown } | undefined)?.is_active === true;
}

// The admin_profiles columns the admin reads for the signed-in user (its
// auth context's user record): every column but first_name and last_name.
export const ADMIN_PROFILE_COLUMNS = 'id,user_id,email,name,role,avatar_url,is_active,created_at,updated_at';

// The signed-in user's active admin_profiles row, as ADMIN_PROFILE_COLUMNS
// selects it.
export interface AdminProfile {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  avatar_url: string | null;
  is_active: true;
  created_at: string;
  updated_at: string;
}

// What a session holder may add to its /me 200 body as `admin`, so the admin
// does not have to read it again before its first render: the user's admin
// profile, and the features admin_get_features grants them (with no account
// filter: a feature listed here is one admin_has_feature_permission answers
// true for when no account is given). Optional and additive; the admin falls
// back to its own queries when it is absent.
export interface AdminContext {
  profile: AdminProfile;
  features: string[];
}

// Bounded tighter than the other upstream calls: /me waits for this, and it
// is only a shortcut, so a slow answer is dropped rather than waited for.
export const ADMIN_CONTEXT_TIMEOUT_MS = 3_000;

function isAdminProfile(v: unknown, userId: string): v is AdminProfile {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  const optionalString = (x: unknown) => x === null || typeof x === 'string';
  return (
    typeof r.id === 'string' &&
    r.id !== '' &&
    r.user_id === userId &&
    typeof r.email === 'string' &&
    optionalString(r.name) &&
    typeof r.role === 'string' &&
    optionalString(r.avatar_url) &&
    r.is_active === true &&
    typeof r.created_at === 'string' &&
    typeof r.updated_at === 'string'
  );
}

// Reads the AdminContext with the user's own token (under RLS), the profile
// and the feature list in parallel, each bounded by ADMIN_CONTEXT_TIMEOUT_MS.
// Resolves null instead of throwing on any failure (network, timeout, a
// non-200, an unexpected body, no active row): the caller then leaves `admin`
// out of /me and the admin reads it itself, exactly as before.
//
// isAdmin() is not reused for this: it runs at sign-in and refresh and only
// reads is_active, and its answer is kept in the session as is_admin. This
// runs per /me, so the profile and features are as fresh as the request.
export async function getAdminContext(
  cfg: HostSessionConfig,
  accessToken: string,
  userId: string,
): Promise<AdminContext | null> {
  const headers = { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}` };
  const profileUrl =
    `${cfg.supabaseUrl}/rest/v1/admin_profiles?select=${ADMIN_PROFILE_COLUMNS}` +
    // Two rows, not one: admin_profiles.user_id is not unique, and the admin's
    // own read (.maybeSingle()) fails on a duplicate rather than picking one.
    // This does the same by giving up when more than one row comes back.
    `&user_id=eq.${encodeURIComponent(userId)}&is_active=eq.true&limit=2`;
  const readJson = async (input: string, init: RequestInit): Promise<unknown> => {
    const res = await fetchWithin(ADMIN_CONTEXT_TIMEOUT_MS, input, init);
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`${new URL(input).pathname} returned ${res.status}`);
    }
    return res.json();
  };
  try {
    const [rows, featureRows] = await Promise.all([
      readJson(profileUrl, { headers }),
      readJson(`${cfg.supabaseUrl}/rest/v1/rpc/admin_get_features`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ p_admin_id: userId }),
      }),
    ]);
    // No active row is a normal answer (the session holder's is_admin can
    // be up to a token lifetime old); every other miss is logged, so a schema
    // change that quietly turns the shortcut off is visible.
    const skip = (reason: string) => {
      cfg.log?.warn({ reason, user_id: userId }, 'admin context unusable; /me answers without it');
      return null;
    };
    if (!Array.isArray(rows)) return skip('admin_profiles returned a non-array');
    if (rows.length === 0) return null;
    if (rows.length > 1) return skip('more than one active admin_profiles row');
    const profile: unknown = rows[0];
    if (!isAdminProfile(profile, userId)) return skip('admin_profiles row in an unexpected shape');
    if (!Array.isArray(featureRows)) return skip('admin_get_features returned a non-array');
    const features: string[] = [];
    for (const row of featureRows) {
      const feature = row && typeof row === 'object' ? (row as Record<string, unknown>).feature : undefined;
      if (typeof feature !== 'string') return skip('admin_get_features row without a feature string');
      features.push(feature);
    }
    return { profile, features: [...new Set(features)] };
  } catch (e) {
    cfg.log?.warn({ err: errorMessage(e), user_id: userId }, 'admin context read failed; /me answers without it');
    return null;
  }
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
  user: GoTrueUser;
}

// Reads a token endpoint's 200 body. Throws `unavailable` when the body is
// not JSON or is missing a field: GoTrue answered, but not with a session.
async function tokenResponse(
  res: Response,
  what: string,
  unavailable: new (message: string) => SessionUnavailableError,
): Promise<GoTrueSession> {
  let session: GoTrueSession;
  try {
    session = (await res.json()) as GoTrueSession;
  } catch (e) {
    throw new unavailable(errorMessage(e));
  }
  if (
    typeof session?.access_token !== 'string' ||
    !session.access_token ||
    typeof session.refresh_token !== 'string' ||
    !session.refresh_token ||
    typeof session.user?.id !== 'string' ||
    !session.user.id
  ) {
    throw new unavailable(`GoTrue ${what} returned no session`);
  }
  // A missing or non-numeric expiry falls back to toGwSession's default.
  const expiresAt = typeof session.expires_at === 'number' ? session.expires_at : undefined;
  const expiresIn = typeof session.expires_in === 'number' && session.expires_in > 0 ? session.expires_in : undefined;
  return {
    ...session,
    expires_at: expiresAt ?? (expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined),
  };
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
export async function refreshSession(cfg: HostSessionConfig, s: GwSession): Promise<GwSession> {
  let res: Response;
  try {
    res = await fetchWithin(REFRESH_TIMEOUT_MS, `${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
  } catch (e) {
    throw new RefreshUnavailableError(errorMessage(e));
  }
  // 5xx, 408 (timeout) and 429 (rate limited) say nothing about the refresh
  // token itself, so the session is kept and the caller retries.
  if (isTransientStatus(res.status)) {
    throw new RefreshUnavailableError(`GoTrue refresh returned ${res.status}`);
  }
  if (!res.ok) throw new Error(`GoTrue refused the refresh token (${res.status})`);
  // The identity does not change on a refresh: keep the recorded subject.
  return toGwSession(cfg, await tokenResponse(res, 'refresh', RefreshUnavailableError), s.sub);
}

// GoTrue answered the ID token grant with a 4xx other than 408 or 429: the
// token was refused (expired, wrong audience, unknown provider, signature).
// Trying again with the same token will not help; the host should send the
// user through its own sign-in again.
export class IdTokenGrantRefusedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'IdTokenGrantRefusedError';
  }
}

// The ID token grant's outcome is unknown (network error, timeout, 5xx, 408,
// 429, or a 200 without a session). The host answers 503 and may retry.
export class IdTokenGrantUnavailableError extends SessionUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = 'IdTokenGrantUnavailableError';
  }
}

export interface IdTokenGrantOptions {
  // The raw nonce whose SHA-256 hex digest is the ID token's `nonce` claim.
  // GoTrue requires it exactly when the token has a nonce claim, and checks
  // sha256hex(nonce) against the claim. An ID token from an Auth0
  // refresh_token grant carries no nonce claim, so leave this unset for one.
  nonce?: string;
  // Bound on the token call. Default ID_TOKEN_TIMEOUT_MS, and never more
  // than MAX_ID_TOKEN_TIMEOUT_MS.
  timeoutMs?: number;
}

export const ID_TOKEN_TIMEOUT_MS = 10_000;
// The grant plus the admin_profiles read must fit inside one mint under
// acquire()'s create lock (store.ts MINT_TIMEOUT_MS, 30 seconds), so a
// longer timeoutMs is clamped to this.
export const MAX_ID_TOKEN_TIMEOUT_MS = 20_000;

function grantTimeout(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return ID_TOKEN_TIMEOUT_MS;
  return Math.min(ms, MAX_ID_TOKEN_TIMEOUT_MS);
}

// Signs in to GoTrue with an OIDC ID token the host already holds (for
// example the one express-openid-connect received from the IdP), with no
// browser redirect: POST /auth/v1/token?grant_type=id_token. The result goes
// through toGwSession like a PKCE sign-in, so the admin_profiles check runs
// with the user's token and a check that can't be made comes back pending.
//
// Throws IdTokenGrantRefusedError on a 4xx (other than 408 and 429), and
// IdTokenGrantUnavailableError when the outcome is unknown. A mint is at most
// this call plus the admin_profiles read, each bounded.
export async function signInWithIdToken(
  cfg: HostSessionConfig,
  idToken: string,
  opts: IdTokenGrantOptions = {},
): Promise<GwSession> {
  const body: Record<string, string> = { provider: cfg.provider ?? DEFAULT_PROVIDER, id_token: idToken };
  if (opts.nonce !== undefined) body.nonce = opts.nonce;
  let res: Response;
  try {
    res = await fetchWithin(grantTimeout(opts.timeoutMs), `${cfg.supabaseUrl}/auth/v1/token?grant_type=id_token`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new IdTokenGrantUnavailableError(errorMessage(e));
  }
  if (isTransientStatus(res.status)) {
    throw new IdTokenGrantUnavailableError(`GoTrue id_token grant returned ${res.status}`);
  }
  if (!res.ok) {
    // The body is not read: its text may echo the token's claims, so it is
    // never logged. Cancelling it aborts the response stream rather than
    // leaving it buffered until garbage collection. A failure to cancel
    // changes nothing about the answer, which is already known, so it is
    // only logged.
    await res.body?.cancel().catch((e: unknown) => {
      cfg.log?.warn({ err: errorMessage(e) }, 'could not cancel a refused ID token response');
    });
    throw new IdTokenGrantRefusedError(`GoTrue refused the ID token (${res.status})`, res.status);
  }
  const session = await tokenResponse(res, 'id_token grant', IdTokenGrantUnavailableError);
  // GoTrue accepted this ID token, so its sub is the user's IdP subject.
  return toGwSession(cfg, session, unverifiedJwtSubject(idToken));
}

// Reads the user from GoTrue. Throws SessionEndedError on 401, 403 or 404
// (the token is no longer good) and SessionUnavailableError when GoTrue gave
// no usable answer.
export async function getUser(cfg: HostSessionConfig, accessToken: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await timedFetch(`${cfg.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new SessionUnavailableError(errorMessage(e));
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new SessionEndedError(`GoTrue /user returned ${res.status}`);
  }
  if (!res.ok) throw new SessionUnavailableError(`GoTrue /user returned ${res.status}`);
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    throw new SessionUnavailableError(errorMessage(e));
  }
}

// Revokes the refresh token at GoTrue. The IdP's SSO session is left alone.
// GoTrue authenticates the call with the access token, so the caller should
// pass a session refreshed if needed. Resolves false (and logs) when GoTrue
// could not be reached or refused; the refresh token then stays valid at
// GoTrue until it expires, though the BFF has already forgotten it.
export async function logout(cfg: HostSessionConfig, s: GwSession): Promise<boolean> {
  try {
    const res = await timedFetch(`${cfg.supabaseUrl}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, authorization: `Bearer ${s.access_token}` },
    });
    if (res.ok) return true;
    cfg.log?.warn({ status: res.status, user_id: s.user_id }, 'GoTrue logout refused; refresh token not revoked');
  } catch (e) {
    cfg.log?.warn({ err: errorMessage(e), user_id: s.user_id }, 'GoTrue logout failed; refresh token not revoked');
  }
  return false;
}
