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
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error('SUPABASE_JWT_SECRET is not set; requireJwt() cannot verify tokens');
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

    let claims: SupabaseJwtClaims;
    try {
      claims = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as SupabaseJwtClaims;
    } catch (err) {
      const code = (err as Error).name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token';
      errorResponse(res, 401, code, 'JWT verification failed');
      return;
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
