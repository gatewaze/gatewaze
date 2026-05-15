// CDN-first server-side fetch wrapper. Per spec-portal-on-cloudflare-workers §4.2.
//
// All public reads route through `cdn.aaif.live` so cache hits stay at
// the edge and never touch the K8s API. Authenticated reads and writes
// route directly to `api.aaif.live` (the CDN explicitly bypasses on the
// Authorization header — see spec-api-cache-and-revalidation §5.3), so
// per-viewer data is never co-mingled in a shared cache.
//
// CDN→origin auto-fallback for cacheable GETs only: if the CDN returns
// 5xx (rare; the CDN Worker is itself fronted by Cloudflare's network)
// the wrapper retries against the origin so a transient CDN problem
// can't take down the public site. Mutations and authenticated reads
// already go straight to origin so they don't need this dance.
//
// Written to be runtime-agnostic. Uses the global `fetch` and the
// Next-augmented `RequestInit['next']` field. Works in:
//   - Node.js (current K8s runtime, `next dev`, vitest)
//   - Cloudflare Workers via OpenNext (target runtime)

const CDN_URL = process.env.GATEWAZE_CDN_URL ?? "";
const API_URL = process.env.GATEWAZE_API_URL ?? "";

export interface GatewazeFetchOptions {
  // Next.js cache tags for `revalidateTag()`-driven invalidation. The
  // CDN Worker also reads these via the `Cache-Tag` response header so
  // surrogate-key purges propagate end-to-end.
  tags?: string[];
  // Seconds. Defaults to 60.
  revalidate?: number;
  // Bearer JWT. Setting this routes the request to the origin (the CDN
  // bypasses cache when Authorization is present).
  auth?: string;
  init?: RequestInit;
}

export async function gatewazeFetch<T>(
  path: string,
  opts: GatewazeFetchOptions = {},
): Promise<T | null> {
  if (!CDN_URL || !API_URL) {
    // Misconfiguration — return null rather than throwing so SSR
    // degrades to "no data" rather than a 500 page. Logged loudly so
    // the operator notices.
    console.error(
      "[gatewazeFetch] GATEWAZE_CDN_URL / GATEWAZE_API_URL not set; cannot fetch",
      path,
    );
    return null;
  }

  const base = opts.auth ? API_URL : CDN_URL;
  const headers = new Headers(opts.init?.headers);
  if (opts.auth) headers.set("Authorization", `Bearer ${opts.auth}`);

  const method = opts.init?.method ?? "GET";
  const isCacheableGet = method === "GET" && !opts.auth;

  // Next-specific cache hints. Only attach for cacheable GETs — Next
  // ignores `next` on POST/PUT/etc. but it's clearer to omit it.
  const nextOpts: RequestInit = { ...opts.init, headers };
  if (isCacheableGet) {
    (nextOpts as RequestInit & { next?: { revalidate?: number; tags?: string[] } }).next = {
      revalidate: opts.revalidate ?? 60,
      tags: opts.tags,
    };
  }

  try {
    const res = await fetch(`${base}${path}`, nextOpts);

    if (!res.ok) {
      // CDN→origin fallback for cacheable GETs only. The CDN may be
      // transiently down or returning a stale-but-broken response; the
      // origin is the durable answer for read-only paths.
      if (base === CDN_URL && res.status >= 500 && isCacheableGet) {
        const fallbackRes = await fetch(`${API_URL}${path}`, {
          ...opts.init,
          headers,
        });
        if (!fallbackRes.ok) return null;
        return (await fallbackRes.json()) as T;
      }
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.error(`[gatewazeFetch] ${method} ${path} failed`, error);
    return null;
  }
}

// Same shape as gatewazeFetch but returns the raw Response so callers
// can stream / inspect headers (used by the calendar feed route which
// needs to forward Content-Type from the upstream).
export async function gatewazeFetchRaw(
  path: string,
  opts: GatewazeFetchOptions = {},
): Promise<Response | null> {
  if (!CDN_URL || !API_URL) {
    console.error(
      "[gatewazeFetchRaw] GATEWAZE_CDN_URL / GATEWAZE_API_URL not set; cannot fetch",
      path,
    );
    return null;
  }
  const base = opts.auth ? API_URL : CDN_URL;
  const headers = new Headers(opts.init?.headers);
  if (opts.auth) headers.set("Authorization", `Bearer ${opts.auth}`);

  const method = opts.init?.method ?? "GET";
  const isCacheableGet = method === "GET" && !opts.auth;
  const nextOpts: RequestInit = { ...opts.init, headers };
  if (isCacheableGet) {
    (nextOpts as RequestInit & { next?: { revalidate?: number; tags?: string[] } }).next = {
      revalidate: opts.revalidate ?? 60,
      tags: opts.tags,
    };
  }

  try {
    const res = await fetch(`${base}${path}`, nextOpts);
    if (!res.ok && base === CDN_URL && res.status >= 500 && isCacheableGet) {
      return await fetch(`${API_URL}${path}`, { ...opts.init, headers });
    }
    return res;
  } catch (error) {
    console.error(`[gatewazeFetchRaw] ${method} ${path} failed`, error);
    return null;
  }
}
