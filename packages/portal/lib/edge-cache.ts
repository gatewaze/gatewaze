// Runtime-agnostic key-value cache for middleware-scope lookups.
// Per spec-portal-on-cloudflare-workers §4.4.
//
// On Cloudflare Workers, in-memory Maps don't survive between isolate
// invocations and don't share state across the global edge — they are
// effectively useless as a hot cache. The replacement is Cloudflare KV
// (the SLUG_CACHE binding declared in wrangler.toml).
//
// On Node.js (current K8s runtime, `next dev`, vitest) there is no KV
// binding, so this module falls back to an in-memory Map. The semantics
// are intentionally identical: TTL'd lookups, null-as-negative-cache.
//
// This module is the abstraction surface that middleware.ts will
// migrate to. It does NOT modify middleware.ts itself yet — that's a
// follow-up commit so the diff stays focused.
//
// Resolution order at call time:
//   1. If we can resolve a Cloudflare context with a `SLUG_CACHE`
//      binding, use KV.
//   2. Otherwise, use the process-global in-memory Map.
//
// Resolution is per-call (cheap) so the same module works under
// `next dev` (Node), under OpenNext build output (Workers), and under
// vitest (Node, no env).

interface KVNamespace {
  get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

// OpenNext exposes Cloudflare bindings via `getCloudflareContext()`,
// which is safe to import on Workers and dynamic-import-only on Node
// (the module isn't installed at runtime in the K8s container, so a
// static import would fail at module load time). Import lazily and
// swallow errors so this file is safe to load in any runtime.
//
// The import target is hidden behind a string variable so TypeScript's
// module resolver doesn't try to follow it during typecheck — the
// package only exists in the OpenNext build path, not in the K8s
// container's node_modules, and we don't want a hard dep on dev
// machines either.
const OPENNEXT_PKG = '@opennextjs/cloudflare';

async function getKVBinding(name: 'SLUG_CACHE' | 'CACHE'): Promise<KVNamespace | null> {
  try {
    const mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ OPENNEXT_PKG).catch(() => null)) as
      | { getCloudflareContext?: () => { env?: Record<string, unknown> } }
      | null;
    if (!mod || typeof mod.getCloudflareContext !== 'function') return null;
    const ctx = mod.getCloudflareContext();
    const binding = ctx?.env?.[name] as KVNamespace | undefined;
    return binding ?? null;
  } catch {
    return null;
  }
}

interface MemoryEntry {
  value: string;
  expiresAt: number;
}
const memoryStore = new Map<string, MemoryEntry>();

function memoryGet(key: string): string | null {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

function memoryPut(key: string, value: string, ttlSeconds: number): void {
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function memoryDelete(key: string): void {
  memoryStore.delete(key);
}

// Public API. Generic over the cached value type — callers JSON-encode
// on put and JSON-decode on get. Null is reserved for "not present"
// (NOT "explicitly cached as null") — use a sentinel string like
// JSON-encoded `null` if you want to negative-cache a miss.

export async function edgeCacheGet<T>(
  binding: 'SLUG_CACHE' | 'CACHE',
  key: string,
): Promise<T | null> {
  const kv = await getKVBinding(binding);
  const raw = kv ? await kv.get(`${binding}:${key}`) : memoryGet(`${binding}:${key}`);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function edgeCachePut<T>(
  binding: 'SLUG_CACHE' | 'CACHE',
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  const serialized = JSON.stringify(value);
  const kv = await getKVBinding(binding);
  if (kv) {
    // KV minimum TTL is 60s; clamp to be safe.
    await kv.put(`${binding}:${key}`, serialized, {
      expirationTtl: Math.max(60, ttlSeconds),
    });
  } else {
    memoryPut(`${binding}:${key}`, serialized, ttlSeconds);
  }
}

export async function edgeCacheDelete(
  binding: 'SLUG_CACHE' | 'CACHE',
  key: string,
): Promise<void> {
  const kv = await getKVBinding(binding);
  if (kv) {
    await kv.delete(`${binding}:${key}`);
  } else {
    memoryDelete(`${binding}:${key}`);
  }
}

// Test-only escape hatch. Not exported from a public index file; tests
// import this path directly.
export function __resetMemoryStoreForTests(): void {
  memoryStore.clear();
}
