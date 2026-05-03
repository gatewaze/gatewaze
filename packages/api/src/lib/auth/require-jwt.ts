import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
// SERVICE-ROLE OK: requireJwt() resolves the active account by reading
// accounts_users *before* the user-scoped client can be constructed.
// This is the bootstrap path for tenancy; it's bounded to a single
// (user_id, account_id) lookup and emits no data beyond membership.
import { getSupabase } from '../supabase.js';
import {
  resolveActiveAccount,
  NoAccountMembershipError,
  HeaderAccountMismatchError,
} from './active-account.js';

/**
 * Supabase Cloud rotated default auth-key signing from HS256 (shared
 * secret) to ES256 (asymmetric, kid + JWKS) in early 2026. Tokens issued
 * by the cloud now carry alg=ES256 and the local-HS256 verify path
 * always rejects them with "JWT verification failed". Self-hosted
 * Supabase still uses HS256.
 *
 * Verify via the Supabase auth REST API as a primary path — it's the
 * service that issued the token and knows which key signed it. Local
 * HS256 stays as a fallback for self-hosted deployments where the auth
 * REST round-trip is undesirable, and to keep the legacy test path
 * (GATEWAZE_TEST_DISABLE_AUTH) working.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      accountId?: string;
      jwtClaims?: Record<string, unknown>;
    }
  }
}

interface SupabaseJwtClaims {
  sub?: string;
  exp?: number;
  iat?: number;
  email?: string;
  role?: string;
  [key: string]: unknown;
}

function errorResponse(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function getJwtSecret(): string {
  // The docker-compose stack — and Supabase itself — uses JWT_SECRET. The
  // SUPABASE_JWT_SECRET name is an alias kept for explicit overrides (e.g.
  // when an operator wants to scope a different secret to the api service
  // alone). Prefer the explicit name, fall back to the standard one.
  const secret = process.env.SUPABASE_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET (or SUPABASE_JWT_SECRET) is not set; requireJwt() cannot verify tokens');
  }
  return secret;
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  // Supabase ssr cookie auth — accept the access token cookie if present.
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/sb-[^=]+-auth-token=([^;]+)/);
    if (match) {
      try {
        const decoded = decodeURIComponent(match[1]);
        const parsed = JSON.parse(decoded) as { access_token?: string };
        if (parsed.access_token) return parsed.access_token;
      } catch {
        // Cookie malformed — fall through to 401.
      }
    }
  }
  return null;
}

/**
 * Express middleware that verifies a Supabase-issued JWT (HS256) and
 * resolves the request's active account via {@link resolveActiveAccount}.
 *
 * On success, attaches `req.userId`, `req.accountId`, and `req.jwtClaims`.
 * On failure, returns the standard error envelope.
 *
 * Test bypass: when `GATEWAZE_TEST_DISABLE_AUTH=1` (set by the api test
 * setup), the middleware injects a fixed test user/account and skips JWT
 * verification. The auth-specific tests in `require-jwt.test.ts` clear
 * this env var so their assertions still exercise the real path.
 */
export function requireJwt() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.GATEWAZE_TEST_DISABLE_AUTH === '1') {
      req.userId = '00000000-0000-0000-0000-000000000001';
      req.accountId = '00000000-0000-0000-0000-0000000000a1';
      req.jwtClaims = {};
      next();
      return;
    }
    const token = extractToken(req);
    if (!token) {
      errorResponse(res, 401, 'unauthenticated', 'Missing or malformed Authorization header');
      return;
    }

    // Decode without verifying first to read the alg + claims. We still
    // require the auth service to confirm the token below; the decode
    // is just to differentiate ES256 (cloud) vs HS256 (self-hosted) and
    // surface clean error codes.
    const decoded = jwt.decode(token, { complete: true }) as
      | { header: { alg?: string }; payload: SupabaseJwtClaims }
      | null;
    if (!decoded?.payload) {
      errorResponse(res, 401, 'invalid_token', 'JWT verification failed');
      return;
    }
    const alg = decoded.header.alg;
    let claims: SupabaseJwtClaims = decoded.payload;

    if (alg === 'HS256') {
      // Self-hosted path: verify locally against the shared secret. No
      // network round-trip; keeps existing single-node deploys snappy.
      try {
        claims = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as SupabaseJwtClaims;
      } catch (err) {
        const code = (err as Error).name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token';
        errorResponse(res, 401, code, 'JWT verification failed');
        return;
      }
    } else {
      // Cloud / asymmetric path (ES256, RS256, …). Ask the auth service
      // — it owns the signing keys. supabase-js handles the JWKS lookup
      // and kid match for us.
      const { data, error } = await getSupabase().auth.getUser(token);
      if (error || !data?.user) {
        const msg = error?.message ?? 'JWT verification failed';
        const code = /expired/i.test(msg) ? 'token_expired' : 'invalid_token';
        errorResponse(res, 401, code, msg);
        return;
      }
      // Trust the unverified payload's claims (sub/email/role) only after
      // the auth service has confirmed the token. supabase-js validated
      // signature + expiry; the decoded payload carries the rest.
      claims.sub = data.user.id;
      claims.email = data.user.email ?? claims.email;
    }

    if (!claims.sub) {
      errorResponse(res, 401, 'invalid_token', 'JWT missing sub claim');
      return;
    }

    try {
      const resolution = await resolveActiveAccount(req, claims.sub, claims, getSupabase());
      req.userId = claims.sub;
      req.accountId = resolution.accountId;
      req.jwtClaims = claims;
      next();
    } catch (err) {
      if (err instanceof NoAccountMembershipError) {
        // The 1.1 hardening doc explicitly promises "Runtime behaviour
        // is unchanged for users with tenancy_v2_enforced=false (the
        // default)" — operators are supposed to run preflight + backfill
        // before flipping the flag. Without this gate the middleware
        // hard-fails 403 even on freshly-upgraded brands where the
        // backfill hasn't run yet, which broke admin-route auth on
        // every cloud brand we deployed v1.2.x to. Soft-fail when the
        // flag is off (or absent): proceed without an accountId; legacy
        // v1 RLS keeps scoping. Hard-fail only once the flag is on.
        if (!(await isTenancyV2Enforced())) {
          req.userId = claims.sub;
          req.jwtClaims = claims;
          next();
          return;
        }
        errorResponse(res, 403, 'no_account', 'User has no account membership');
        return;
      }
      if (err instanceof HeaderAccountMismatchError) {
        errorResponse(res, 403, 'forbidden', 'Not a member of the requested account');
        return;
      }
      errorResponse(res, 500, 'internal_error', 'Failed to resolve active account');
    }
  };
}

/**
 * Cached read of the tenancy_v2_enforced platform setting. Cache TTL is
 * 60 s — short enough that flag flips reach the api without a restart,
 * long enough that we don't hit platform_settings on every request.
 *
 * Defaults to `false` on read failure so the fallback path keeps the
 * pre-1.1 contract (legacy RLS, no account scoping). Operators flip the
 * flag deliberately after running the preflight + backfill.
 */
let cachedTenancyFlag: { value: boolean; fetchedAt: number } | null = null;
const TENANCY_FLAG_TTL_MS = 60_000;

async function isTenancyV2Enforced(): Promise<boolean> {
  if (cachedTenancyFlag && Date.now() - cachedTenancyFlag.fetchedAt < TENANCY_FLAG_TTL_MS) {
    return cachedTenancyFlag.value;
  }
  try {
    const { data } = await getSupabase()
      .from('platform_settings')
      .select('value')
      .eq('key', 'tenancy_v2_enforced')
      .maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    const value = raw === 'true' || raw === true;
    cachedTenancyFlag = { value, fetchedAt: Date.now() };
    return value;
  } catch {
    return false;
  }
}
