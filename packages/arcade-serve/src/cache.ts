/**
 * Tiny TTL cache. The TTL is what bounds publish/rollback propagation on this
 * service (spec §3: ≤ 5 s), so it is deliberately small, unconditional, and
 * caches misses too — an unknown slug must not turn into a DB query per request.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): { value: T } | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return { value: hit.value };
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.maxEntries) {
      // Cheap bound: drop the oldest insertion. Entries are short-lived anyway.
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }
}
