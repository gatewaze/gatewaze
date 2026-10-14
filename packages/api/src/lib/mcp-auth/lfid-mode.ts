/**
 * How the MCP authorization server signs a user in when the lfid-auth module
 * is enabled.
 *
 * The lfid-auth module (lf-gatewaze-modules) has two LFID sign-in flows:
 *
 *   bridge — its `integrations-lfid-callback` edge function runs the Auth0
 *            exchange and hands a Supabase session back in the URL fragment.
 *   native — Supabase Auth (GoTrue) runs the exchange itself through the
 *            custom OIDC provider `custom:lfid`. The bridge function is not
 *            deployed.
 *
 * The mode is decided the same way the module decides it (lf-gatewaze-modules
 * #62, docs/lfid-auth-setup.md step 6):
 *
 *   1. `LFID_SIGN_IN_MODE=native` in the API environment marks a native-deploy
 *      install. The module's manifest reads the same key to leave the bridge
 *      out, so there is no bridge to fall back to and the lookup is skipped.
 *   2. Otherwise `public.lfid_sign_in_mode()` (module migration 005) decides.
 *      It returns `native` only when the module config says so and the
 *      identity trigger native mode depends on exists. A missing function, an
 *      error or any other value means bridge, which is what an install without
 *      the key has always done.
 *
 * Bridge mode still needs AUTH0_DOMAIN and AUTH0_CLIENT_ID in the module
 * config and SUPABASE_PUBLIC_URL, exactly as before. Without them, and
 * whenever the module is not enabled, the caller uses magic link.
 *
 * On a bridge install this adds one lookup per /authorize, bounded at
 * LFID_SIGN_IN_MODE_TIMEOUT_MS. An install without module migration 005 logs
 * a warning on each one and keeps the bridge.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger.js';

export const LFID_SIGN_IN_MODE_KEY = 'LFID_SIGN_IN_MODE';
export const LFID_SIGN_IN_MODE_RPC = 'lfid_sign_in_mode';
export const LFID_SIGN_IN_MODE_TIMEOUT_MS = 3000;
export const LFID_BRIDGE_FUNCTION = 'integrations-lfid-callback';

export type LfidLogin =
  | { mode: 'bridge'; startUrl: string }
  | { mode: 'native' };

type Env = Record<string, string | undefined>;

async function rpcSaysNative(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .rpc(LFID_SIGN_IN_MODE_RPC)
      .abortSignal(AbortSignal.timeout(LFID_SIGN_IN_MODE_TIMEOUT_MS));
    if (error) {
      logger.warn({ code: error.code, err: error.message }, '[mcp-auth] lfid_sign_in_mode() failed; using bridge');
      return false;
    }
    if (data !== 'native' && data !== 'bridge') {
      logger.warn({ value: typeof data === 'string' ? data.slice(0, 40) : typeof data }, '[mcp-auth] lfid_sign_in_mode() returned an unexpected value; using bridge');
    }
    return data === 'native';
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[mcp-auth] lfid_sign_in_mode() threw; using bridge');
    return false;
  }
}

/**
 * null means the lfid-auth module does not apply: sign in with magic link.
 * A failed module lookup also returns null, as it always has here.
 */
export async function resolveLfidLogin(supabase: SupabaseClient, env: Env = process.env): Promise<LfidLogin | null> {
  const { data, error } = await supabase
    .from('installed_modules')
    .select('status, config')
    .eq('id', 'lfid-auth')
    .maybeSingle();
  if (error) logger.error({ err: error.message }, '[mcp-auth] lfid-auth module lookup failed; using magic link');
  if (!data || data.status !== 'enabled') return null;

  if (env[LFID_SIGN_IN_MODE_KEY] === 'native' || (await rpcSaysNative(supabase))) {
    return { mode: 'native' };
  }

  const cfg = (data.config ?? {}) as Record<string, string>;
  if (!cfg.AUTH0_DOMAIN || !cfg.AUTH0_CLIENT_ID) return null;
  const supabasePublic = (env.SUPABASE_PUBLIC_URL ?? '').replace(/\/+$/, '');
  if (!supabasePublic) return null;
  return { mode: 'bridge', startUrl: `${supabasePublic}/functions/v1/${LFID_BRIDGE_FUNCTION}` };
}
