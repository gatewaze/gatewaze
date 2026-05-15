// k6 load test for the staging Worker, run before the production
// cutover (per spec-portal-on-cloudflare-workers §13 step 1 / §12).
//
// Goal: 10K-20K virtual users hitting a mix of cached + uncached +
// auth-required routes for ≥10 minutes. The pass criteria below
// reflect the SLA in spec §10:
//   - p99 TTFB ≤ 200ms for cached responses
//   - p99 TTFB ≤ 600ms for cache-miss SSR
//   - <0.5% 5xx rate
//
// Run:
//   BASE_URL=https://staging.aaif.live EVENT_SLUG=ai-summit-tk06c2 \
//     k6 run --vus 10000 --duration 10m tests/load/portal-cutover.k6.ts
//
// Or for a quick smoke (no infra):
//   k6 run --vus 50 --duration 30s tests/load/portal-cutover.k6.ts
//
// Set AUTH_JWT to also exercise the per-viewer authenticated path:
//   AUTH_JWT="$(supabase token | jq -r .access_token)" k6 run ...
//
// Output: JSON summary to stdout + Cloudflare Workers analytics
// dashboard for the staging Worker.

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'https://staging.aaif.live';
const EVENT_SLUG = __ENV.EVENT_SLUG || 'sample-event';
const AUTH_JWT = __ENV.AUTH_JWT || '';

// Per-bucket latency trends so the summary breaks down where time
// goes. The default `http_req_duration` mixes them all together.
const cachedLatency = new Trend('latency_cached', true);
const ssrLatency = new Trend('latency_ssr', true);
const authedLatency = new Trend('latency_authed', true);
const errorRate = new Rate('error_rate');

export const options = {
  scenarios: {
    // 90% of traffic: anonymous public reads. These should serve from
    // the CDN edge cache (warm after the first request).
    cached_reads: {
      executor: 'ramping-vus',
      exec: 'cachedRead',
      startVUs: 100,
      stages: [
        { duration: '1m', target: 1000 },
        { duration: '5m', target: 9000 },
        { duration: '3m', target: 9000 },
        { duration: '1m', target: 0 },
      ],
    },
    // 10% of traffic: authenticated reads. These bypass the CDN
    // (Authorization header) so they hit the Worker → API path
    // every time.
    authed_reads: {
      executor: 'ramping-vus',
      exec: 'authedRead',
      startVUs: 10,
      stages: [
        { duration: '1m', target: 100 },
        { duration: '5m', target: 1000 },
        { duration: '3m', target: 1000 },
        { duration: '1m', target: 0 },
      ],
      // Skip authenticated stage entirely if no JWT supplied.
      gracefulStop: '5s',
    },
  },
  thresholds: {
    'latency_cached': ['p(99)<200'],
    'latency_ssr': ['p(99)<600'],
    'latency_authed': ['p(99)<1000'],
    'error_rate': ['rate<0.005'], // <0.5% 5xx, per spec §10
    'http_req_failed': ['rate<0.01'], // <1% all-cause failures
  },
};

// Per-VU pacing — k6 fires as fast as the response returns by default,
// which is unrealistic. Real viewers click through over seconds, not
// milliseconds. Sleep 0.5-2s between requests to model that.
function pace(): void {
  sleep(0.5 + Math.random() * 1.5);
}

export function cachedRead(): void {
  // Mix of route types in proportion to expected traffic during a
  // virtual event (per spec-virtual-events-partykit numbers):
  //   - 60% land on event detail
  //   - 20% navigate to a sub-page (sponsors / agenda / speakers)
  //   - 20% hit the listing
  const roll = Math.random();

  if (roll < 0.6) {
    group('event detail (cached)', () => {
      const res = http.get(`${BASE_URL}/events/${EVENT_SLUG}`);
      check(res, {
        'event detail 200': (r) => r.status === 200,
        // Cache hit indicator: Cloudflare adds `cf-cache-status: HIT`
        // when served from the edge cache. First request will MISS
        // (revalidating), subsequent should HIT.
        'cf-cache-status present': (r) => 'cf-cache-status' in r.headers,
      });
      const cached = res.headers['Cf-Cache-Status'] === 'HIT';
      (cached ? cachedLatency : ssrLatency).add(res.timings.duration);
      if (res.status >= 500) errorRate.add(1);
      else errorRate.add(0);
    });
  } else if (roll < 0.8) {
    group('event sub-page (cached)', () => {
      const subpaths = ['/sponsors', '/agenda', '/speakers', '/talks'];
      const sub = subpaths[Math.floor(Math.random() * subpaths.length)];
      const res = http.get(`${BASE_URL}/events/${EVENT_SLUG}${sub}`);
      check(res, { '200 OK': (r) => r.status === 200 });
      const cached = res.headers['Cf-Cache-Status'] === 'HIT';
      (cached ? cachedLatency : ssrLatency).add(res.timings.duration);
      if (res.status >= 500) errorRate.add(1);
      else errorRate.add(0);
    });
  } else {
    group('event listing (cached)', () => {
      const res = http.get(`${BASE_URL}/events/upcoming`);
      check(res, { '200 OK': (r) => r.status === 200 });
      const cached = res.headers['Cf-Cache-Status'] === 'HIT';
      (cached ? cachedLatency : ssrLatency).add(res.timings.duration);
      if (res.status >= 500) errorRate.add(1);
      else errorRate.add(0);
    });
  }
  pace();
}

export function authedRead(): void {
  if (!AUTH_JWT) {
    // No JWT supplied — skip this VU's iteration. The scenario still
    // ran, but it'll produce zero samples in the authed bucket. The
    // summary makes that obvious.
    return;
  }
  group('authenticated event detail', () => {
    const res = http.get(`${BASE_URL}/events/${EVENT_SLUG}`, {
      headers: { Cookie: `sb-access-token=${AUTH_JWT}` },
    });
    check(res, { '200 OK': (r) => r.status === 200 });
    authedLatency.add(res.timings.duration);
    if (res.status >= 500) errorRate.add(1);
    else errorRate.add(0);
  });
  pace();
}
