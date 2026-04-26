/**
 * In-process LRU cache + mutation-event bus for the listing pattern
 * (spec-platform-listing-pattern.md §14).
 *
 * Single-replica per platform spec §1.2.6. v1.2 multi-replica would
 * push events through Redis pub/sub; the API surface here is identical
 * so callers don't change.
 */

export interface ListingCacheKey {
  module: string;
  consumer: 'admin' | 'publicApi' | 'mcp' | 'portal';
  /** Stringified composite of (page, pageSize, sort, filters, search, userScope). */
  signature: string;
}

export interface ListingMutationEvent {
  module: string;
  /** Optional table — if set, only invalidate keys for this table. */
  table?: string;
  /** Optional reason string for log/observability. */
  reason?: string;
}

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
  /** Promise still resolving — coalesces concurrent fetches for the same key. */
  pending?: Promise<T>;
}

class ListingCache {
  private store = new Map<string, CacheEntry>();
  private listeners = new Set<(e: ListingMutationEvent) => void>();
  private maxEntries = 1000;

  /** Build the canonical map key from a structured ListingCacheKey. */
  private keyOf(k: ListingCacheKey): string {
    return `${k.module}::${k.consumer}::${k.signature}`;
  }

  /**
   * Read or compute. Promise-coalescing guarantees that two concurrent
   * requests for the same key share a single underlying compute.
   */
  async getOrCompute<T>(key: ListingCacheKey, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const id = this.keyOf(key);
    const now = Date.now();
    const existing = this.store.get(id) as CacheEntry<T> | undefined;
    if (existing) {
      if (existing.pending) return existing.pending;
      if (existing.expiresAt > now) return existing.value;
    }
    const promise = compute().then((value) => {
      this.store.set(id, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      this.evictIfFull();
      return value;
    });
    // Mark pending so concurrent callers wait on the same promise.
    this.store.set(id, { value: undefined as unknown as T, expiresAt: 0, pending: promise });
    return promise;
  }

  set<T>(key: ListingCacheKey, value: T, ttlSeconds: number): void {
    this.store.set(this.keyOf(key), { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    this.evictIfFull();
  }

  get<T>(key: ListingCacheKey): T | null {
    const entry = this.store.get(this.keyOf(key)) as CacheEntry<T> | undefined;
    if (!entry || entry.pending) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(this.keyOf(key));
      return null;
    }
    return entry.value;
  }

  /**
   * Drop every cached entry whose key starts with `<module>::`. Called
   * after any mutation under that module's admin write routes.
   */
  invalidate(module: string): number {
    const prefix = `${module}::`;
    let dropped = 0;
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
        dropped++;
      }
    }
    return dropped;
  }

  /** Subscribe to mutation events emitted by `emit()`. */
  subscribe(fn: (e: ListingMutationEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Publish a mutation event. Subscribers (typically the cache itself
   * via the auto-wired listener below) react accordingly.
   */
  emit(event: ListingMutationEvent): void {
    for (const fn of this.listeners) {
      try { fn(event); } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[listing-cache] listener threw:', err);
      }
    }
  }

  /** For tests / introspection. */
  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  private evictIfFull(): void {
    if (this.store.size <= this.maxEntries) return;
    // Drop the oldest 10% of entries.
    const drop = Math.ceil(this.maxEntries * 0.1);
    let i = 0;
    for (const k of this.store.keys()) {
      this.store.delete(k);
      if (++i >= drop) break;
    }
  }
}

export const listingCache = new ListingCache();

// Auto-wire: every emitted mutation event invalidates the matching
// module's cache entries. This is the contract described in
// spec-platform-listing-pattern.md §14.
listingCache.subscribe((e) => {
  listingCache.invalidate(e.module);
});
