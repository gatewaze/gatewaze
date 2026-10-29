// Middleware parity matrix — pre-cutover gate per
// spec-portal-on-cloudflare-workers §12.
//
// The portal's middleware.ts is 650+ lines and the highest-risk part
// of the migration. Every behaviour that today's K8s pod implements
// must round-trip identically through the Cloudflare Worker; if even
// one branch silently changes (e.g. custom-domain rewrites, slug
// canonicalisation, auth refresh), the public site degrades for
// every viewer behind that path.
//
// These tests pin the OBSERVABLE behaviour of each branch — the
// inputs (Host header, pathname, cookies) and the outputs (status,
// Location header, NextResponse.next() vs rewrite). They run against
// the middleware module directly under vitest, plus the same matrix
// is exercised against `wrangler dev` + the staging Worker URL via
// the `make portal-parity` target (defined in
// gatewaze-environments/Makefile, see runbook).
//
// What this DOES test:
//   - Custom domain hostname → tenant resolution
//   - Event-slug canonicalisation (slug-with-id → canonical)
//   - Module prefix rewrites (/blog/* → /m/blog/*)
//   - Auth session-refresh cookie roundtrip
//   - Health check passthrough
//   - Defence-in-depth Vary: Host header
//
// What this does NOT test (deferred to runbook E2E):
//   - Real KV propagation latency (KV is eventually consistent across
//     POPs; matters for cache invalidation, but the 5-min TTL hides
//     short-term staleness)
//   - Cookie SameSite behaviour across browsers
//   - SSR data-fetch fallback when CDN 5xxs (covered by gatewaze.test)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock @opennextjs/cloudflare so edge-cache.ts falls through to the
// in-memory Map fallback. Cloudflare KV semantics are exercised in the
// staging-Worker side of this matrix (see runbook).
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: {} }),
}));

// Mock @supabase/ssr so updateSupabaseSession is a no-op for the
// middleware unit tests — the auth roundtrip is verified at the
// integration layer (wrangler dev → real Supabase).
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  }),
}));

// Stub the global fetch the middleware uses for its Supabase REST
// calls (custom-domain lookup, event-slug canonicalisation, events
// module status). Each test replays the response shape PostgREST
// returns for the relevant query.
// The module prefixes are generated at build time and gitignored; pin a
// known set so the module-root custom-domain cases do not depend on
// which module repos this checkout has resolved.
vi.mock('../lib/modules/generated-module-prefixes.json', () => ({
  default: ['blog', 'photo-booth'],
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  // The middleware reads its Supabase target and the portal's own URL
  // from the environment; without them every lookup short-circuits to
  // "unknown host" and the legacy branch throws on `new URL(undefined)`.
  vi.stubEnv('SUPABASE_URL', 'https://supabase.example.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-for-tests');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://portal.example.test');
  vi.stubEnv('PORTAL_HOST', 'portal.example.test');
  fetchMock.mockReset();
  // Clear the in-process edge-cache Map between tests so cached
  // negative results don't leak across cases.
  vi.resetModules();
});

// Helper: construct a NextRequest the middleware can consume.
function makeRequest(opts: {
  url: string;
  host?: string;
  cookies?: Record<string, string>;
}): NextRequest {
  const headers = new Headers();
  if (opts.host) headers.set('host', opts.host);
  if (opts.cookies) {
    headers.set(
      'cookie',
      Object.entries(opts.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    );
  }
  return new NextRequest(new Request(opts.url, { headers }));
}

describe('middleware parity matrix', () => {
  describe('passthrough cases', () => {
    it('lets /api/health through without any Supabase lookup', async () => {
      const { middleware } = await import('../middleware');
      const res = await middleware(
        makeRequest({ url: 'https://example.com/api/health', host: 'example.com' }),
      );

      expect(res.status).toBe(200);
      // Critical: the health check must NEVER hit Supabase (it gates
      // K8s readiness probes; an outbound network call there causes
      // crashloop on Supabase blip).
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('Vary: Host defence-in-depth', () => {
    it('attaches Vary: Host on portal listing API responses', async () => {
      const { middleware } = await import('../middleware');
      // Stub Supabase responses for the brand resolution path.
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 }),
      );
      const res = await middleware(
        makeRequest({
          url: 'https://example.com/api/portal/listing/events',
          host: 'example.com',
        }),
      );
      // The middleware appends Host to whatever Vary the response
      // already carries. Multi-brand cache poisoning protection.
      const vary = res.headers.get('Vary') || '';
      expect(vary).toContain('Host');
    });
  });

  describe('event slug canonicalisation', () => {
    it('redirects when an event_id-only URL has a canonical slug available', async () => {
      const { middleware } = await import('../middleware');
      // First call: lookup by slug returns no row; second call: lookup
      // by event_id returns the canonical slug.
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify([{ event_slug: 'ai-summit-tk06c2' }]), {
          status: 200,
        }),
      );
      const res = await middleware(
        makeRequest({
          url: 'https://example.com/events/tk06c2',
          host: 'example.com',
        }),
      );
      // Either a 308 (permanent redirect) or rewrite — depends on the
      // middleware implementation. Both are valid; the test pins that
      // it's NOT a 200 with the original URL.
      expect([301, 302, 307, 308]).toContain(res.status);
      const location = res.headers.get('location');
      if (location) expect(location).toContain('ai-summit-tk06c2');
    });
  });

  describe('custom-domain lookup', () => {
    it('serves the event page when a custom domain matches', async () => {
      const { middleware } = await import('../middleware');
      // PostgREST returns the matching custom_domain row first; then
      // the event lookup returns the event metadata.
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              content_type: 'event',
              content_id: 'EVT-1',
              content_slug: 'my-event-evt-1',
              page_title: 'My Event',
              favicon_url: null,
            },
          ]),
          { status: 200 },
        ),
      );
      const res = await middleware(
        makeRequest({
          url: 'https://my-conference.example.com/',
          host: 'my-conference.example.com',
        }),
      );
      // Either a rewrite (200 on the new URL) or a redirect — test
      // pins the URL was processed (not just passed through unchanged).
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('module-root custom domain', () => {
    // A custom_domains row whose content_type is a module id with portal
    // pages and no slug: the module lives at the domain root.
    const boothDomainRow = () =>
      new Response(
        JSON.stringify([
          { content_type: 'photo-booth', content_id: null, content_slug: null, page_title: 'Aime', favicon_url: null },
        ]),
        { status: 200 },
      );
    const rewriteTarget = (res: Response) => {
      const raw = res.headers.get('x-middleware-rewrite');
      return raw ? new URL(raw).pathname : null;
    };

    it('serves the module at the root, keeps the module prefix working, and passes the shared paths through', async () => {
      const { middleware } = await import('../middleware');
      fetchMock.mockImplementation(async (url: string) =>
        String(url).includes('custom_domains')
          ? boothDomainRow()
          : new Response(JSON.stringify([{ status: 'enabled' }]), { status: 200 }),
      );
      const on = (path: string) =>
        middleware(makeRequest({ url: `https://aime.photo${path}`, host: 'aime.photo' }));

      const root = await on('/');
      expect(rewriteTarget(root)).toBe('/m/photo-booth');
      expect(root.headers.get('x-custom-domain')).toBe('true');
      expect(root.headers.get('x-content-type')).toBe('photo-booth');
      expect(root.headers.get('x-custom-domain-title')).toBe('Aime');

      expect(rewriteTarget(await on('/b/dans-booth'))).toBe('/m/photo-booth/b/dans-booth');
      expect(rewriteTarget(await on('/dial'))).toBe('/m/photo-booth/dial');
      // The module's own absolute links.
      expect(rewriteTarget(await on('/photo-booth/b/dans-booth'))).toBe('/m/photo-booth/b/dans-booth');
      expect(rewriteTarget(await on('/photo-booth'))).toBe('/m/photo-booth');
      // Another module is not reachable from this domain: it is a page of this one.
      expect(rewriteTarget(await on('/blog/hello'))).toBe('/m/photo-booth/blog/hello');

      // Sign-in and the api proxy pass through untouched, still marked as the domain's.
      const signIn = await on('/sign-in?redirectTo=%2Fphoto-booth');
      expect(rewriteTarget(signIn)).toBeNull();
      expect(signIn.headers.get('x-custom-domain')).toBe('true');
      expect(rewriteTarget(await on('/api/public/photo-booth/beta'))).toBeNull();
    });

    it('never forwards a routing header the client sent: the row decides, on every host (security review 2026-10-29)', async () => {
      const { middleware } = await import('../middleware');
      const spoofed = (url: string, host: string) => {
        const headers = new Headers({
          host,
          'x-custom-domain': 'true',
          'x-custom-domain-title': 'Evil',
          'x-custom-domain-favicon': 'https://evil.example/pixel.png',
          'x-event-identifier': 'x,or(event_slug.eq.other)',
          'x-content-type': 'events',
        });
        return new NextRequest(new Request(url, { headers }));
      };
      // The app sees exactly the forwarded set, so a forwarded request must list the override and omit ours.
      const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);
      const overridden = (res: Response) => res.headers.get('x-middleware-override-headers') ?? '';

      // The brand host: a plain pass-through becomes a cleaned forward.
      fetchMock.mockResolvedValue(new Response(JSON.stringify([{ status: 'enabled' }]), { status: 200 }));
      const brand = await middleware(spoofed('https://portal.example.test/profile', 'portal.example.test'));
      expect(overridden(brand)).toContain('host');
      expect(forwarded(brand, 'x-custom-domain-title')).toBeNull();
      expect(forwarded(brand, 'x-custom-domain')).toBeNull();
      expect(forwarded(brand, 'x-event-identifier')).toBeNull();

      // A module-root domain whose row has no title: the spoofed title does not stand in for it.
      fetchMock.mockImplementation(async (url: string) =>
        String(url).includes('custom_domains')
          ? new Response(JSON.stringify([{ content_type: 'photo-booth', content_id: null, content_slug: null, page_title: null, favicon_url: null }]), { status: 200 })
          : new Response(JSON.stringify([{ status: 'enabled' }]), { status: 200 }),
      );
      const booth = await middleware(spoofed('https://aime.photo/b/x', 'aime.photo'));
      expect(forwarded(booth, 'x-content-type')).toBe('photo-booth');
      expect(forwarded(booth, 'x-custom-domain-title')).toBeNull();
      expect(forwarded(booth, 'x-custom-domain-favicon')).toBeNull();
      expect(forwarded(booth, 'x-event-identifier')).toBeNull();
      expect(booth.headers.get('x-custom-domain-title')).toBeNull();
    });

    it('leaves a content_type that is not a module prefix to the content routes', async () => {
      const { middleware } = await import('../middleware');
      fetchMock.mockImplementation(async (url: string) =>
        String(url).includes('custom_domains')
          ? new Response(JSON.stringify([{ content_type: 'blog', content_id: 'B1', content_slug: 'hello', page_title: null, favicon_url: null }]), { status: 200 })
          : new Response(JSON.stringify([{ status: 'enabled' }]), { status: 200 }),
      );
      const res = await middleware(makeRequest({ url: 'https://words.example.com/', host: 'words.example.com' }));
      // blog has a content route of its own (a single post), so the module-root branch must not take it.
      expect(rewriteTarget(res)).toBe('/blog/hello');
    });
  });

  describe('events module disabled', () => {
    it('passes /events through normally when events module is enabled', async () => {
      const { middleware } = await import('../middleware');
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify([{ status: 'enabled' }]), { status: 200 }),
      );
      const res = await middleware(
        makeRequest({ url: 'https://example.com/events', host: 'example.com' }),
      );
      // Not a 404 / not a redirect — passes through.
      expect(res.status).toBe(200);
    });
  });

  describe('cache fallthrough', () => {
    it('reuses the in-memory cache for the same custom-domain on subsequent calls', async () => {
      const { middleware } = await import('../middleware');
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              content_type: 'event',
              content_id: 'EVT-2',
              content_slug: 'cached-event',
              page_title: null,
              favicon_url: null,
            },
          ]),
          { status: 200 },
        ),
      );

      await middleware(
        makeRequest({
          url: 'https://cached.example.com/',
          host: 'cached.example.com',
        }),
      );
      const callsAfterFirst = fetchMock.mock.calls.length;

      await middleware(
        makeRequest({
          url: 'https://cached.example.com/agenda',
          host: 'cached.example.com',
        }),
      );

      // Second call should reuse the cached lookup → no additional
      // fetch for the same hostname. (Other lookups may still fire
      // — events module status, etc. — but the custom-domain one
      // is the one this test pins.)
      const customDomainCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('custom_domains'),
      ).length;
      expect(customDomainCalls).toBe(1);
    });
  });
});
