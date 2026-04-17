export interface CachedApiKey {
  id: string;
  name: string;
  scopes: string[];
  rateLimitRpm: number;
  writeRateLimitRpm: number;
  expiresAt: string | null;
  cachedAt: number;
}

export const API_KEY_CACHE_TTL_MS = 30_000;

const cache = new Map<string, CachedApiKey>();

/**
 * Retrieve a cached API key entry by its hash.
 * Returns null if not found or if the entry has expired (older than TTL).
 */
export function getFromCache(keyHash: string): CachedApiKey | null {
  const entry = cache.get(keyHash);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > API_KEY_CACHE_TTL_MS) {
    cache.delete(keyHash);
    return null;
  }
  return entry;
}

/**
 * Store a validated API key in the cache.
 */
export function setInCache(keyHash: string, key: CachedApiKey): void {
  cache.set(keyHash, key);
}

/**
 * Remove all cache entries that match the given key ID.
 * Iterates the entire cache, which is fine for small sets.
 */
export function invalidateByKeyId(keyId: string): void {
  for (const [hash, entry] of Array.from(cache.entries())) {
    if (entry.id === keyId) {
      cache.delete(hash);
    }
  }
}

/**
 * Clear all entries from the cache.
 */
export function clearCache(): void {
  cache.clear();
}
