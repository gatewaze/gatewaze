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

/**
 * Resolve the Supabase URL from the environment. The docker-compose stack
 * (and gatewaze.config.ts demo) names the var differently in different
 * places — the api service mostly sees `SUPABASE_URL`, the admin Vite app
 * uses `VITE_SUPABASE_URL`. Local dev shells running `pnpm dev` outside
 * compose commonly only have one of the two; check both.
 */
export function resolveSupabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
}

/** Service-role key with fallback to the .env.example unprefixed name. */
export function resolveServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;
}

/** Anon key with fallback to the .env.example unprefixed name. */
export function resolveAnonKey(): string | undefined {
  return process.env.SUPABASE_ANON_KEY ?? process.env.ANON_KEY;
}

function buildServiceClient(): SupabaseClient {
  const url = resolveSupabaseUrl();
  const key = resolveServiceRoleKey();
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (also accepts SERVICE_ROLE_KEY)');
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
 * Returns synchronously so route handlers can do
 * `const supabase = getRequestSupabase(req)` without an extra await.
 * The GUC-set RPC fires in the background — RLS falls back to the
 * user_account_ids() subquery if the GUC isn't ready yet, which is
 * correct for the small set of in-flight queries before
 * set_app_account_id resolves.
 *
 * Requires that requireJwt() ran first (so `req.userId`,
 * `req.accountId`, and the Authorization header are all populated).
 */
export function getRequestSupabase(req: Request): SupabaseClient {
  // Test bypass: when requireJwt() short-circuited via
  // GATEWAZE_TEST_DISABLE_AUTH, no JWT is on the request. The
  // service-role fallback keeps route tests that don't mock supabase
  // from 401-ing.
  if (process.env.GATEWAZE_TEST_DISABLE_AUTH === '1') {
    return getServiceSupabase();
  }

  const url = resolveSupabaseUrl();
  const anonKey = resolveAnonKey();
  if (!url || !anonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY (also accepts ANON_KEY) for user-scoped client');
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

  // Fire-and-forget: set the per-request GUC so RLS policies that
  // prefer the fast-path (current_account_id()) narrow scope without
  // the user_account_ids() subquery. Failure is recoverable — RLS
  // simply falls back to the subquery path.
  if (req.accountId) {
    const accountId = req.accountId;
    void (async () => {
      try {
        await client.rpc('set_app_account_id', { p_account_id: accountId });
      } catch {
        // ignore — subquery fallback handles it.
      }
    })();
  }

  return client;
}

let anonClient: SupabaseClient | null = null;

/**
 * Process-wide anon-key Supabase client for serving portal-public reads.
 *
 * Used by `routes/portal-events.ts` and other portal-public routers to
 * proxy CDN-cached reads. The anon key engages PostgREST RLS so a
 * public read only returns rows that the public RLS policies expose
 * (e.g. `events` rows where `is_live_in_production = true`). Service-
 * role escalation is intentionally NOT used here because:
 *
 *   - These responses are CDN-cached at `cdn.aaif.live` and served to
 *     any unauthenticated viewer. Leaking a service-role-scoped row
 *     into the cache would leak it globally.
 *   - The portal's existing direct-Supabase reads use the anon key
 *     today; this client preserves identical RLS visibility.
 *
 * Per spec-portal-on-cloudflare-workers §8 and
 * spec-production-readiness-hardening §5.1.
 */
export function getAnonSupabase(): SupabaseClient {
  if (anonClient) return anonClient;
  const url = resolveSupabaseUrl();
  const key = resolveAnonKey();
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY (also accepts ANON_KEY) for anon client');
  }
  anonClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return anonClient;
}
