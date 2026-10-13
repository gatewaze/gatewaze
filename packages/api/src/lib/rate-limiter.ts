/**
 * Redis-backed rate limiter for module API endpoints.
 *
 * v1.1 used in-process counters which only worked at replicaCount=1.
 * v1.2 (this file) uses ioredis with sliding-window counters and
 * concurrency tracked via SET-with-TTL keys, so the limiter is
 * correct across multiple API replicas — phase-3 sub-task 3.6a per
 * spec §7.3, the prerequisite to flipping replicaCount default to 2.
 *
 * Falls back to a permissive in-memory mode when Redis isn't
 * configured (preserves dev ergonomics; logs a warning at first use).
 */

import type { Request, Response, NextFunction } from 'express';
import { type RateLimiterAbstract, RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { getRedisConnection } from './queue/index.js';
import { logger } from './logger.js';

interface RateLimitConfig {
  /** Max requests per window per user */
  perUserRate: number;
  /** Window in seconds */
  windowSecs: number;
  /** Max concurrent requests per user */
  perUserConcurrency: number;
  /** Max concurrent requests globally */
  globalConcurrency: number;
  /** Optional metric/key namespace (defaults to caller location). */
  bucket?: string;
}

const KEY_PREFIX = 'rl:'; // redis key prefix (rl: rate-limit)
const ACTIVE_TTL_SECS = 60; // hard ceiling on a request's "active" lifetime

let warned = false;

/**
 * Create a rate limiter middleware. Each instance gets its own bucket
 * so different routes don't share counters.
 */
export function rateLimiter(config: RateLimitConfig) {
  const bucket = config.bucket ?? `b${Math.random().toString(36).slice(2, 8)}`;

  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as { userId?: string }).userId ?? req.ip ?? 'anonymous';
    const now = Date.now();
    const windowMs = config.windowSecs * 1000;

    let redis;
    try {
      redis = getRedisConnection();
    } catch {
      if (!warned) {
        logger.warn('rate-limiter: Redis not configured — running in PERMISSIVE mode (dev only)');
        warned = true;
      }
      return next();
    }

    const userKey = `${KEY_PREFIX}${bucket}:u:${userId}`;
    const userActiveKey = `${KEY_PREFIX}${bucket}:ua:${userId}`;
    const globalActiveKey = `${KEY_PREFIX}${bucket}:ga`;

    // Sliding window: ZSET of timestamps, prune old, count remaining.
    const cutoff = now - windowMs;
    const requestId = `${now}:${Math.random().toString(36).slice(2, 8)}`;

    try {
      const pipeline = redis.multi();
      pipeline.zremrangebyscore(userKey, 0, cutoff);
      pipeline.zcard(userKey);
      pipeline.scard(userActiveKey);
      pipeline.scard(globalActiveKey);
      const result = (await pipeline.exec()) ?? [];
      const userRate = (result[1]?.[1] as number | null) ?? 0;
      const userActive = (result[2]?.[1] as number | null) ?? 0;
      const globalActive = (result[3]?.[1] as number | null) ?? 0;

      if (userRate >= config.perUserRate) {
        const retryAfter = config.windowSecs;
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({
          error: {
            code: 'rate_limited',
            message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
            details: { retryAfter },
          },
        });
        return;
      }

      if (userActive >= config.perUserConcurrency) {
        res.setHeader('Retry-After', '5');
        res.status(429).json({
          error: { code: 'rate_limited', message: 'Too many concurrent requests', details: { retryAfter: 5 } },
        });
        return;
      }

      if (globalActive >= config.globalConcurrency) {
        res.setHeader('Retry-After', '5');
        res.status(429).json({
          error: { code: 'rate_limited', message: 'System is busy processing other requests', details: { retryAfter: 5 } },
        });
        return;
      }

      // Reserve: add to ZSET (rate), and SET (concurrency).
      const reserve = redis.multi();
      reserve.zadd(userKey, now, requestId);
      reserve.expire(userKey, config.windowSecs);
      reserve.sadd(userActiveKey, requestId);
      reserve.expire(userActiveKey, ACTIVE_TTL_SECS);
      reserve.sadd(globalActiveKey, requestId);
      reserve.expire(globalActiveKey, ACTIVE_TTL_SECS);
      await reserve.exec();

      // Release on response finish.
      res.on('finish', () => {
        const release = redis.multi();
        release.srem(userActiveKey, requestId);
        release.srem(globalActiveKey, requestId);
        release.exec().catch(err => {
          logger.warn({ err: (err as Error).message }, 'rate-limiter: release failed');
        });
      });

      next();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'rate-limiter: redis failure — failing open');
      next();
    }
  };
}

/**
 * Options for {@link ipRateLimiter}.
 */
interface IpRateLimitConfig {
  /** Max requests per window, per client IP. */
  points: number;
  /** Window in seconds. */
  durationSecs: number;
  /** Key namespace, so routers don't share a counter. */
  bucket: string;
}

function createIpStore(config: IpRateLimitConfig): RateLimiterAbstract {
  const options = {
    keyPrefix: `${KEY_PREFIX}ip:${config.bucket}`,
    points: config.points,
    duration: config.durationSecs,
  };
  try {
    return new RateLimiterRedis({ ...options, storeClient: getRedisConnection() });
  } catch {
    // Redis isn't configured. Unlike rateLimiter() above, don't fall
    // through to no limit at all: a per-process counter still caps a
    // single replica, and single-replica is the only shape a deployment
    // without Redis can have.
    logger.warn('ip-rate-limiter: Redis not configured — counting in-process (single replica only)');
    return new RateLimiterMemory(options);
  }
}

/**
 * Per-IP rate limiting that runs *in front of* authentication.
 *
 * {@link rateLimiter} keys on `req.userId`, so it can only be installed
 * after `requireJwt()` has resolved one. That leaves the authentication
 * itself unthrottled, and authentication is the expensive half of a
 * request here: for cloud-issued ES256 tokens `requireJwt()` calls
 * `supabase.auth.getUser()`, an outbound round trip, and
 * `resolveActiveAccount()` then reads `accounts_users`. Both run before a
 * per-user limiter is ever reached, so anyone who can send bytes — with
 * a junk token, even — can drive them.
 *
 * The client IP is the only identity available before a token is
 * verified. Install this as a router's first middleware so nothing
 * expensive runs ahead of it, and keep the per-user limiter behind
 * `requireJwt()` for the work that only a signed-in caller can reach.
 *
 * Failing open on a store error matches {@link rateLimiter}: a Redis
 * outage should not take the API down with it.
 *
 * The returned middleware is named so a router's layer stack can be read
 * back (Express copies `fn.name` onto the layer) — see
 * `src/lib/__tests__/rate-limiter.test.ts`, which pins the ordering this
 * whole function exists for.
 */
export function ipRateLimiter(config: IpRateLimitConfig) {
  const store = createIpStore(config);

  return function ipRateLimit(req: Request, res: Response, next: NextFunction): void {
    // `trust proxy` is set in server.ts, so req.ip is the real client
    // address rather than the ingress one.
    const key = req.ip ?? 'unknown';
    store.consume(key, 1).then(
      () => next(),
      (rejection: unknown) => {
        if (rejection instanceof Error) {
          logger.warn({ err: rejection.message }, 'ip-rate-limiter: store failure — failing open');
          next();
          return;
        }
        const msBeforeNext = (rejection as { msBeforeNext?: number }).msBeforeNext ?? config.durationSecs * 1000;
        const retryAfter = Math.max(1, Math.ceil(msBeforeNext / 1000));
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({
          error: {
            code: 'rate_limited',
            message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
            details: { retryAfter },
          },
        });
      },
    );
  };
}

// Pre-configured rate limiters for specific endpoints — bucket names
// keep counters disjoint between routes.
export const uploadRateLimiter = rateLimiter({
  perUserRate: 5,
  windowSecs: 60,
  perUserConcurrency: 1,
  globalConcurrency: 3,
  bucket: 'upload',
});

export const selectRateLimiter = rateLimiter({
  perUserRate: 10,
  windowSecs: 60,
  perUserConcurrency: 1,
  globalConcurrency: 1,
  bucket: 'select',
});

export const deployRateLimiter = rateLimiter({
  perUserRate: 10,
  windowSecs: 60,
  perUserConcurrency: 1,
  globalConcurrency: 3,
  bucket: 'deploy',
});

export const reconcileRateLimiter = rateLimiter({
  perUserRate: 3,
  windowSecs: 60,
  perUserConcurrency: 1,
  globalConcurrency: 1,
  bucket: 'reconcile',
});
