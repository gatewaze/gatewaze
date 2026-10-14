/**
 * Native LFID sign-in for the MCP authorization server: the GoTrue PKCE
 * redirect flow against the custom OIDC provider `custom:lfid`, run on the
 * server through supabase-js, the same way the admin BFF does it
 * (packages/admin-bff/src/login.ts).
 *
 *   start:  signInWithOAuth builds the GoTrue /authorize URL with a fresh
 *           code_challenge and keeps the code_verifier in an in-memory store.
 *           The caller saves that store with the MCP authorization request.
 *   finish: a client seeded with the saved store exchanges GoTrue's ?code=
 *           at /token?grant_type=pkce. The result is the Gatewaze user.
 *
 * The GoTrue session that the exchange creates is only used to identify the
 * user. The MCP flow issues its own tokens, so the session is revoked again
 * at once. The revoke is best effort: a failure is logged and the sign-in
 * goes on.
 */
import { createClient, isAuthApiError, type SupportedStorage, type User } from '@supabase/supabase-js';
import { logger } from '../logger.js';

export const LFID_NATIVE_PROVIDER = 'custom:lfid';

// Every GoTrue call made here is bounded.
const UPSTREAM_TIMEOUT_MS = 10_000;

export interface NativeLfidConfig {
  /** Supabase URL the API pod reaches (SUPABASE_URL). */
  supabaseUrl: string;
  /** Supabase URL the browser reaches (SUPABASE_PUBLIC_URL, else SUPABASE_URL). */
  publicSupabaseUrl: string;
  anonKey: string;
}

export function nativeLfidConfig(env: Record<string, string | undefined> = process.env): NativeLfidConfig | null {
  const supabaseUrl = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const publicSupabaseUrl = (env.SUPABASE_PUBLIC_URL ?? '').trim().replace(/\/+$/, '') || supabaseUrl;
  const anonKey = (env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!supabaseUrl || !anonKey) return null;
  return { supabaseUrl, publicSupabaseUrl, anonKey };
}

const timedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });

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

function gotrue(cfg: NativeLfidConfig, initial?: Record<string, string>) {
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

/**
 * Returns the GoTrue authorize URL to send the browser to, and the PKCE
 * store (holding the code_verifier) to keep server-side until the callback.
 */
export async function startNativeLfid(
  cfg: NativeLfidConfig,
  redirectTo: string,
): Promise<{ url: string; pkce: Record<string, string> }> {
  const { client, mem } = gotrue(cfg);
  const { data, error } = await client.auth.signInWithOAuth({
    // Custom providers aren't in the SDK's Provider union.
    provider: LFID_NATIVE_PROVIDER as never,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new Error(error?.message ?? 'GoTrue returned no authorize URL');
  // GoTrue's URL is built from the API pod's Supabase URL; the browser needs the public one.
  const url = data.url.startsWith(cfg.supabaseUrl)
    ? cfg.publicSupabaseUrl + data.url.slice(cfg.supabaseUrl.length)
    : data.url;
  return { url, pkce: mem.data };
}

/**
 * GoTrue or the user's record refused the sign-in: a 4xx other than 429
 * from the code exchange, or no verified email. Anything else thrown by finishNativeLfid
 * is an upstream failure (timeout, 5xx, network).
 */
export class NativeLfidRefused extends Error {}

export interface NativeLfidIdentity {
  authUserId: string;
  email: string;
  /** The LFID (Auth0) subject from the custom:lfid identity, when present. */
  lfidSub?: string;
  displayName?: string;
}

/**
 * Exchanges GoTrue's code for the signed-in user, then revokes that session
 * (best effort). Throws NativeLfidRefused when the sign-in is refused, and
 * any other error when GoTrue could not be reached or failed.
 */
export async function finishNativeLfid(
  cfg: NativeLfidConfig,
  code: string,
  pkce: Record<string, string>,
): Promise<NativeLfidIdentity> {
  const { client } = gotrue(cfg, pkce);
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
    // 429 is GoTrue's rate limit on the API's own address, not a verdict on the user.
    if (isAuthApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 429) {
      throw new NativeLfidRefused(error.message);
    }
    throw new Error(`GoTrue code exchange failed: ${error.message}`);
  }
  if (!data.session) throw new Error('GoTrue code exchange returned no session');
  const user: User = data.session.user;

  // The MCP client gets its own tokens, so this session is not needed.
  // signOut reports failures in its result rather than throwing.
  const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
  if (signOutError) {
    logger.warn({ err: signOutError.message, userId: user.id }, '[mcp-auth] could not revoke the native LFID GoTrue session');
  }

  if (!user.email) throw new NativeLfidRefused('signed-in user has no email');
  // Access is resolved by email, so only a verified address may be used. A
  // project with allow_unverified_email_sign_ins on can return one that isn't.
  if (!user.email_confirmed_at) throw new NativeLfidRefused('signed-in user email is not verified');
  const identity = user.identities?.find((i) => i.provider === LFID_NATIVE_PROVIDER);
  const sub = identity?.identity_data?.sub;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = meta.full_name ?? meta.name;
  return {
    authUserId: user.id,
    email: user.email,
    lfidSub: typeof sub === 'string' && sub ? sub : undefined,
    displayName: typeof name === 'string' && name ? name : undefined,
  };
}
