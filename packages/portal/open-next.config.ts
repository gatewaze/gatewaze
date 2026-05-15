// OpenNext Cloudflare adapter config. Per
// https://opennext.js.org/cloudflare/get-started — this file is
// required at the project root and consumed by `opennextjs-cloudflare
// build`.
//
// Wrangler bindings (R2 ASSETS, KV SLUG_CACHE) are declared in
// wrangler.toml; the adapter discovers them from there.
//
// FIRST-DEPLOY NOTE: kvIncrementalCache override is intentionally
// commented out for the v0 deploy. With it enabled, OpenNext's
// `populate-cache` step runs at deploy time and bulk-PUTs prerendered
// page data into the NEXT_INC_CACHE_KV namespace — and wrangler
// 4.92's bulk PUT against the per-namespace endpoint returns "No
// route for that URI [code: 7000]" against newly-created namespaces
// (the endpoint works via direct curl with the same token). The
// `--skipPopulateCache` deploy flag does NOT actually skip the step,
// confirmed in run 25945930914.
//
// Trade-off: without the override, OpenNext falls back to an
// in-memory cache that resets per isolate (effectively per-request
// on Workers). ISR pages still WORK — they just don't share cache
// across requests, so every viewer pays the SSR cost. The
// `cdn.aaif.live` Worker in front of this still caches the rendered
// HTML responses though, so end-user impact is limited to:
//   1. The very first viewer of each page after a CDN cache miss
//      pays full SSR latency (one upstream API hit per data dep).
//   2. Workers' isolate count stays bounded, so a popular page
//      converges to a "warm" set of isolates that hold the cache
//      anyway.
//
// Re-enable once Cloudflare ships a wrangler 4 patch (or we move
// to r2IncrementalCache, which doesn't go through the broken bulk
// endpoint).

import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig({
  // incrementalCache: kvIncrementalCache,  // disabled — see header
});
