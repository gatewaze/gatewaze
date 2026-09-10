/**
 * Read-through cache over sqlite. Stale-while-revalidate policy is applied
 * by callers (paint from cache, refresh in background); pull-to-refresh
 * bypasses the cache entirely. TTLs are per key class and enforced at read
 * time by the caller passing maxAgeMs.
 */

import { getDb } from './db';

export async function cacheGet(key: string, maxAgeMs?: number): Promise<unknown | undefined> {
  const row = getDb().getFirstSync<{ body: string; cached_at: number }>(
    'SELECT body, cached_at FROM cache WHERE cache_key = ?',
    [key]
  );
  if (!row) return undefined;
  if (maxAgeMs !== undefined && Date.now() - row.cached_at > maxAgeMs) return undefined;
  try {
    return JSON.parse(row.body);
  } catch {
    return undefined;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  getDb().runSync(
    'INSERT INTO cache (cache_key, body, cached_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET body = excluded.body, cached_at = excluded.cached_at',
    [key, JSON.stringify(value), Date.now()]
  );
}
