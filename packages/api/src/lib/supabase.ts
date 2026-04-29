import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Request } from 'express';

/**
 * The API server now holds two Supabase clients per
 * spec-production-readiness-hardening §5.1:
 *
 *   - getRequestSupabase(req): a per-request, user-scoped client
 *     constructed with the caller's JWT. RLS enforces account_id
 *     membership against the active account selected by requireJwt().
 *     Use this for all CRUD on tenant-owned resources.
 *
 *   - getServiceSupabase(): a process-wide service-role client used
 *     for narrow, intentional escalation: module install, cron-driven
 *     background jobs, audit-log writes, webhook ingestion, and the
 *     active-account membership lookup that runs *before* the user-
 *     scoped client is constructed.
 *
 * Every call site that uses getServiceSupabase() must be annotated with
 * a `// SERVICE-ROLE OK: <reason>` comment. New escalations are
 * pull-request-reviewed.
 *
 * `getSupabase()` is kept as a deprecated alias of getServiceSupabase()
 * so existing call sites compile while the per-route migration to
 * getRequestSupabase() proceeds in phases (Session 16 + phase 4).
 */

let serviceClient: SupabaseClient | null = null;

function buildServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getServiceSupabase(): SupabaseClient {
  if (serviceClient) return serviceClient;
  serviceClient = buildServiceClient();
  return serviceClient;
}

/**
 * Deprecated alias of {@link getServiceSupabase}. New code must use
 * either {@link getRequestSupabase} (user-scoped) or
 * {@link getServiceSupabase} (with a SERVICE-ROLE OK annotation).
 *
 * @deprecated since hardening-p1
 */
export function getSupabase(): SupabaseClient {
  return getServiceSupabase();
}

/**
 * Constructs a user-scoped Supabase client for the current request.
 *
 * Steps performed:
 *   1. Reads the caller's JWT from the Authorization header (extracted
 *      by requireJwt() and re-passed via the Express Request).
 *   2. Builds a fresh SupabaseClient with that JWT as the auth header.
 *      The client therefore inherits the user's `auth.uid()` and
 *      `auth.jwt()` claims under RLS — every query is filtered by
 *      whichever policies apply to that role.
 *   3. Calls `select set_config('app.account_id', <accountId>, true)`
 *      so RLS policies that use the GUC fast path (per spec §5.1)
 *      narrow scope to the request's active account immediately.
 *
 * The returned client is single-use — do not cache or share it across
 * requests. It must be created at the start of a route handler that
 * needs user-scoped access, and discarded when the response is sent.
 *
 * Requires that requireJwt() ran first (so `req.userId`,
 * `req.accountId`, and the Authorization header are all populated).
 */
export async function getRequestSupabase(req: Request): Promise<SupabaseClient> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY for user-scoped client');
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('getRequestSupabase requires a Bearer token (requireJwt must run first)');
  }
  const token = authHeader.slice(7).trim();

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Set the per-request GUC so RLS policies that prefer the fast-path
  // (current_account_id()) narrow scope without falling back to the
  // user_account_ids() subquery. The set_app_account_id() RPC is a
  // SECURITY INVOKER wrapper around pg_catalog.set_config (not exposed
  // by PostgREST). is_local=true reverts the GUC at end of transaction.
  if (req.accountId) {
    const { error } = await client.rpc('set_app_account_id', {
      p_account_id: req.accountId,
    });
    if (error) {
      // Recoverable — RLS falls back to the user_account_ids()
      // subquery. Log via Pino once Session 9 lands; console for now.
      // eslint-disable-next-line no-console
      console.warn('[supabase] set_app_account_id failed:', error.message);
    }
  }

  return client;
}
