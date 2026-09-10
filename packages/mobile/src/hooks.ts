/**
 * Hooks and helpers exposed to module screens through '@gatewaze/mobile'.
 */

import { useCallback, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import type { MobileModuleContext } from '@gatewaze/shared';
import { getModuleContext } from './core/context';
import { isApiFailure } from './core/errors';
import { cacheGet as coreCacheGet } from './core/cache';

function cacheGetWithAge(
  _ctx: MobileModuleContext,
  key: string,
  maxAgeMs?: number
): Promise<unknown | undefined> {
  return coreCacheGet(key, maxAgeMs);
}

/** The core primitives a module builds its typed calls on. */
export function useModuleContext(): MobileModuleContext {
  return getModuleContext();
}

/** Generate a client_ref — once per logical action, reused across retries. */
export function newClientRef(): string {
  return Crypto.randomUUID();
}

export { isApiFailure };

/**
 * Stale-while-revalidate load helper: paints last-known-good from cache,
 * refreshes in the background. `refresh()` (pull-to-refresh) bypasses the
 * cache per the offline model.
 */
export function useCachedQuery<T>(
  cacheKey: string,
  fetcher: (ctx: MobileModuleContext) => Promise<T>,
  opts?: { maxAgeMs?: number }
): {
  data: T | undefined;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const ctx = getModuleContext();
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (bypass: boolean) => {
      if (bypass) setRefreshing(true);
      try {
        const fresh = await fetcher(ctx);
        setData(fresh);
        setError(null);
        await ctx.cacheSet(cacheKey, fresh);
      } catch (err) {
        // Cache paint already happened; keep last-known-good on transient
        // failures and only surface the message.
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // cacheKey identifies the query; fetcher/ctx are intentionally not deps.
    [cacheKey]  
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = (await cacheGetWithAge(ctx, cacheKey, opts?.maxAgeMs)) as T | undefined;
      if (!cancelled && cached !== undefined) {
        setData(cached);
        setLoading(false);
      }
      await load(false);
    })();
    return () => {
      cancelled = true;
    };
    // Run once per cacheKey.
  }, [cacheKey]);  

  const refresh = useCallback(() => load(true), [load]);

  return { data, loading, refreshing, error, refresh };
}
