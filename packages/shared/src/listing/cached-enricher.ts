/**
 * Per-request context enricher with TTL caching.
 *
 * Used by listing schemas (e.g. events) that need to look up brand-level
 * config every request — the lookup is expensive enough that we want to
 * memoise it for `ttlMs`, but the cache MUST be keyed (typically by
 * `brandId`) to prevent cross-brand pollution in multi-brand servers.
 *
 * Required `keyBy` is intentional: there is no shared default that would
 * silently leak across brands. Implementations that omit `keyBy` fail
 * TypeScript compilation.
 */

import type { HandlerContext } from './types';

export interface CachedEnricherConfig {
  /** Cache TTL in milliseconds. */
  ttlMs: number;
  /**
   * Required cache key derivation. Returning the same key for two
   * different brands (or auth scopes) would cross-pollute the enriched
   * extras. Typical: `(ctx) => ctx.brandId`. If a key cannot be derived
   * for a request, return `null` to bypass the cache for that call.
   */
  keyBy: (ctx: HandlerContext) => string | null;
  /** Loader executed on cache miss. */
  load: (ctx: HandlerContext) => Promise<Record<string, unknown>>;
}

interface CacheEntry {
  expiresAt: number;
  value: Record<string, unknown>;
}

/**
 * Build a cached enricher function suitable for `ListingSchema.contextEnricher`.
 * Cache lives at module-load scope (one Map per call to `cachedEnricher`),
 * so each schema gets its own cache.
 */
export function cachedEnricher(
  config: CachedEnricherConfig,
): (ctx: HandlerContext) => Promise<Record<string, unknown>> {
  const cache = new Map<string, CacheEntry>();

  return async (ctx) => {
    const key = config.keyBy(ctx);
    if (key === null) {
      return config.load(ctx);
    }

    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }

    const value = await config.load(ctx);
    cache.set(key, { value, expiresAt: now + config.ttlMs });

    if (cache.size > 256) {
      for (const [k, entry] of cache.entries()) {
        if (entry.expiresAt <= now) cache.delete(k);
      }
    }

    return value;
  };
}
