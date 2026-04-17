import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { hashApiKey } from './api-key-utils.js';
import { getFromCache, setInCache, type CachedApiKey } from './api-key-cache.js';
import { checkKeyRateLimit, checkGlobalRateLimit } from './public-api-rate-limiter.js';
import { getSupabase } from './supabase.js';

declare global {
  namespace Express {
    interface Request {
      apiKey?: { id: string; name: string; scopes: string[]; rateLimitRpm: number; writeRateLimitRpm: number };
    }
  }
}

/* ---------- IP-based failed auth tracking ---------- */

const FAILED_AUTH_WINDOW_MS = 60_000;
const FAILED_AUTH_MAX = 10;
const failedAuthMap = new Map<string, number[]>();

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip ?? '0.0.0.0';
}

function trackFailedAuth(ip: string): boolean {
  const now = Date.now();
  let timestamps = failedAuthMap.get(ip);
  if (!timestamps) {
    timestamps = [];
    failedAuthMap.set(ip, timestamps);
  }
  // Prune old entries
  while (timestamps.length > 0 && now - timestamps[0] >= FAILED_AUTH_WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= FAILED_AUTH_MAX) {
    return false; // blocked
  }
  timestamps.push(now);
  return true; // allowed
}

/* ---------- Helpers ---------- */

function errorResponse(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/* ---------- Middleware ---------- */

/**
 * Express middleware that authenticates requests using an API key
 * provided in the `X-API-Key` header.
 */
export function apiKeyAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);

    const ip = getClientIp(req);

    // Extract key from header
    const rawKey = req.headers['x-api-key'] as string | undefined;
    if (!rawKey) {
      return errorResponse(res, 401, 'MISSING_API_KEY', 'An API key is required. Provide it via the X-API-Key header.');
    }

    // Validate prefix
    if (!rawKey.startsWith('gw_live_')) {
      if (!trackFailedAuth(ip)) {
        return errorResponse(res, 401, 'INVALID_API_KEY', 'Authentication failed.');
      }
      return errorResponse(res, 401, 'INVALID_API_KEY', 'The API key format is invalid.');
    }

    // Hash the key
    let keyHash: string;
    try {
      keyHash = hashApiKey(rawKey);
    } catch {
      return errorResponse(res, 500, 'INTERNAL_ERROR', 'Server configuration error.');
    }

    // Lookup: cache first, then database
    let cached: CachedApiKey | null = getFromCache(keyHash);

    if (!cached) {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, name, scopes, rate_limit_rpm, write_rate_limit_rpm, expires_at, is_active')
        .eq('key_hash', keyHash)
        .single();

      if (error || !data) {
        if (!trackFailedAuth(ip)) {
          return errorResponse(res, 401, 'INVALID_API_KEY', 'Authentication failed.');
        }
        return errorResponse(res, 401, 'INVALID_API_KEY', 'The provided API key is not valid.');
      }

      if (!data.is_active) {
        if (!trackFailedAuth(ip)) {
          return errorResponse(res, 401, 'INVALID_API_KEY', 'Authentication failed.');
        }
        return errorResponse(res, 401, 'INVALID_API_KEY', 'This API key has been deactivated.');
      }

      cached = {
        id: data.id,
        name: data.name,
        scopes: data.scopes ?? [],
        rateLimitRpm: data.rate_limit_rpm,
        writeRateLimitRpm: data.write_rate_limit_rpm,
        expiresAt: data.expires_at,
        cachedAt: Date.now(),
      };
      setInCache(keyHash, cached);
    }

    // Check expiration
    if (cached.expiresAt && new Date(cached.expiresAt).getTime() < Date.now()) {
      return errorResponse(res, 401, 'KEY_EXPIRED', 'This API key has expired.');
    }

    // Determine bucket and limit
    const isRead = READ_METHODS.has(req.method.toUpperCase());
    const bucket: 'read' | 'write' = isRead ? 'read' : 'write';
    const limitRpm = isRead ? cached.rateLimitRpm : cached.writeRateLimitRpm;

    // Per-key rate limit
    const keyRateResult = checkKeyRateLimit(cached.id, bucket, limitRpm);
    if (!keyRateResult.allowed) {
      res.setHeader('X-RateLimit-Limit', String(limitRpm));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(keyRateResult.resetAt));
      res.setHeader('Retry-After', String(keyRateResult.retryAfter));
      return errorResponse(res, 429, 'RATE_LIMITED', `Rate limit exceeded. Try again in ${keyRateResult.retryAfter} seconds.`);
    }

    // Global rate limit
    const globalRateResult = checkGlobalRateLimit();
    if (!globalRateResult.allowed) {
      res.setHeader('X-RateLimit-Limit', String(limitRpm));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(globalRateResult.resetAt));
      res.setHeader('Retry-After', String(globalRateResult.retryAfter));
      return errorResponse(res, 429, 'RATE_LIMITED', `Global rate limit exceeded. Try again in ${globalRateResult.retryAfter} seconds.`);
    }

    // Set rate limit headers (use per-key values)
    res.setHeader('X-RateLimit-Limit', String(limitRpm));
    res.setHeader('X-RateLimit-Remaining', String(keyRateResult.remaining));
    res.setHeader('X-RateLimit-Reset', String(keyRateResult.resetAt));

    // Attach key info to request
    req.apiKey = {
      id: cached.id,
      name: cached.name,
      scopes: cached.scopes,
      rateLimitRpm: cached.rateLimitRpm,
      writeRateLimitRpm: cached.writeRateLimitRpm,
    };

    // Fire-and-forget: update usage stats
    const supabase = getSupabase();
    supabase.rpc('increment_api_key_usage', { key_id: cached.id }).then(
      () => {},
      () => {},
    );

    next();
  };
}

/**
 * Express middleware that checks whether the authenticated API key
 * includes the required scope.
 * Must be used after `apiKeyAuth()`.
 */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      return errorResponse(res, 401, 'MISSING_API_KEY', 'Authentication is required.');
    }
    if (!req.apiKey.scopes.includes(scope)) {
      return errorResponse(
        res,
        403,
        'INSUFFICIENT_SCOPE',
        `This API key does not have the required scope: ${scope}.`,
      );
    }
    next();
  };
}
