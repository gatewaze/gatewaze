// The admin BFF's own sign-in: the GoTrue PKCE redirect flow, run through
// supabase-js. It stays here rather than in @gatewaze/host-session, which
// has no Supabase client; a host that already holds an ID token (LFX One)
// uses that package's signInWithIdToken instead. The session it returns goes
// through the same toGwSession as every other sign-in and refresh.
import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import { type GwSession, type HostSessionConfig, safeReturnTo, toGwSession } from '@gatewaze/host-session';

export interface BffConfig extends HostSessionConfig {
  // Supabase origin as seen from the browser (SUPABASE_PUBLIC_URL). The
  // GoTrue authorize URL is rewritten to it.
  publicSupabaseUrl: string;
  // Public origin of the admin SPA and this BFF (ADMIN_URL).
  siteUrl: string;
  // GoTrue provider identifier (OIDC_IDENTIFIER), e.g. custom:lfid.
  provider: string;
}

// PKCE state carried in the short-lived flow cookie between login and callback.
export interface LoginFlow {
  storage: Record<string, string>;
  returnTo: string;
}

// Every GoTrue call supabase-js makes here is bounded, as in the package.
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
