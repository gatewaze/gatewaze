// OpenNext Cloudflare adapter config. Per
// https://opennext.js.org/cloudflare/get-started — this file is
// required at the project root and consumed by `opennextjs-cloudflare
// build`.
//
// Wrangler bindings (R2 ASSETS, KV CACHE + SLUG_CACHE) are declared in
// wrangler.toml; the adapter discovers them from there. The KV-backed
// incremental cache below is what makes OpenNext serve `revalidate: N`
// pages from the edge instead of falling back to the origin on every
// request.

import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import kvIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache';

export default defineCloudflareConfig({
  // Maps Next.js's `revalidate` semantics onto the CACHE KV namespace.
  // Without this, the adapter uses an in-memory cache that resets on
  // every isolate spin-up — which on Workers is effectively per
  // request, defeating the point of ISR.
  incrementalCache: kvIncrementalCache,
});
