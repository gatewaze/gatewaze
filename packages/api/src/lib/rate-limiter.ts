/**
 * In-process rate limiter for module API endpoints.
 * v1.1 uses in-process counters (single-replica constraint).
 * v1.2 will switch to Redis-backed distributed rate limiting.
 */

import type { Request, Response, NextFunction } from 'express';

interface RateLimitConfig {
  /** Max requests per window per user */
  perUserRate: number;
  /** Window in seconds */
  windowSecs: number;
  /** Max concurrent requests per user */
  perUserConcurrency: number;
  /** Max concurrent requests globally */
  globalConcurrency: number;
}

interface UserEntry {
  requests: number[];
  active: number;
}

const userCounters = new Map<string, UserEntry>();
let globalActive = 0;

/**
 * Create a rate limiter middleware with the given config.
 */
export function rateLimiter(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).userId ?? req.ip ?? 'anonymous';
    const now = Date.now();
    const windowMs = config.windowSecs * 1000;

    // Get or create user entry
    let entry = userCounters.get(userId);
    if (!entry) {
      entry = { requests: [], active: 0 };
      userCounters.set(userId, entry);
    }

    // Prune old requests
    entry.requests = entry.requests.filter((t) => now - t < windowMs);

    // Check per-user rate
    if (entry.requests.length >= config.perUserRate) {
      const oldestInWindow = entry.requests[0];
      const retryAfter = Math.ceil((oldestInWindow + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          details: { retryAfter },
        },
      });
    }

    // Check per-user concurrency
    if (entry.active >= config.perUserConcurrency) {
      res.setHeader('Retry-After', '5');
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many concurrent requests',
          details: { retryAfter: 5 },
        },
      });
    }

    // Check global concurrency
    if (globalActive >= config.globalConcurrency) {
      res.setHeader('Retry-After', '5');
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'System is busy processing other requests',
          details: { retryAfter: 5 },
        },
      });
    }

    // Record request
    entry.requests.push(now);
    entry.active++;
    globalActive++;

    // Decrement on response finish
    res.on('finish', () => {
      const e = userCounters.get(userId);
      if (e) e.active = Math.max(0, e.active - 1);
      globalActive = Math.max(0, globalActive - 1);
    });

    next();
  };
}

// Pre-configured rate limiters for specific endpoints
export const uploadRateLimiter = rateLimiter({
  perUserRate: 5,
  windowSecs: 60,
  perUserConcurrency: 1,
  globalConcurrency: 3,
});

export const selectRateLimiter = rateLimiter({
  perUserRate: 10,
  windowSecs: 60,
  perUserConcurrency: 1,
  globalConcurrency: 1,
});

export const deployRateLimiter = rateLimiter({
  perUserRate: 10,
  windowSecs: 60,
  perUserConcurrency: 1,
  globalConcurrency: 3,
});

export const reconcileRateLimiter = rateLimiter({
  perUserRate: 3,
  windowSecs: 60,
  perUserConcurrency: 1,
  globalConcurrency: 1,
});
