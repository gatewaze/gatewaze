import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler, type HandlerDeps } from '../handler.js';
import { signPreviewToken } from '../preview-token.js';
import type { Catalog } from '../types.js';
import {
  DRAFT_VERSION_ID,
  LIVE_VERSION_ID,
  PORTAL_ORIGIN,
  SECRET,
  fakeAssets,
  fakeCatalog,
  testConfig,
} from './fixtures.js';

const EXPECTED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${PORTAL_ORIGIN}`,
  "frame-src 'none'",
  `frame-ancestors ${PORTAL_ORIGIN}`,
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

const servers: Server[] = [];

async function start(overrides: Partial<HandlerDeps> = {}): Promise<string> {
  const deps: HandlerDeps = {
    config: testConfig(),
    catalog: fakeCatalog(),
    assets: fakeAssets(),
    sdkSource: '/* sdk */\n',
    log: () => {},
    ...overrides,
  };
  const server = createServer(createHandler(deps));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return `http://127.0.0.1:${address.port}`;
}

function expectSecurityHeaders(res: Response) {
  expect(res.headers.get('content-security-policy')).toBe(EXPECTED_CSP);
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  expect(res.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
  // Deliberately absent (spec §6), and this origin never sets cookies.
  expect(res.headers.get('cross-origin-embedder-policy')).toBeNull();
  expect(res.headers.get('cross-origin-resource-policy')).toBeNull();
  expect(res.headers.get('set-cookie')).toBeNull();
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

describe('live route', () => {
  it('302s to the current live version with a 5 second cache', async () => {
    const base = await start();
    const res = await fetch(`${base}/g/mcp-quest/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/g/mcp-quest/v/${LIVE_VERSION_ID}/`);
    expect(res.headers.get('cache-control')).toBe('public, max-age=5');
    expectSecurityHeaders(res);
  });

  it('follows a publish by pointing at the new version', async () => {
    const nextVersion = '22222222-3333-4444-8555-666666666666';
    const base = await start({
      catalog: fakeCatalog({ liveVersionId: nextVersion, extraVersions: [nextVersion] }),
    });
    const res = await fetch(`${base}/g/mcp-quest/`, { redirect: 'manual' });
    expect(res.headers.get('location')).toBe(`/g/mcp-quest/v/${nextVersion}/`);
  });

  it('canonicalises the missing trailing slash', async () => {
    const base = await start();
    const res = await fetch(`${base}/g/mcp-quest`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/g/mcp-quest/');
  });

  it('404s an unpublished game', async () => {
    const base = await start({ catalog: fakeCatalog({ status: 'draft' }) });
    const res = await fetch(`${base}/g/mcp-quest/`, { redirect: 'manual' });
    expect(res.status).toBe(404);
  });

  it('404s a published game with no live version', async () => {
    const base = await start({ catalog: fakeCatalog({ liveVersionId: null }) });
    expect((await fetch(`${base}/g/mcp-quest/`, { redirect: 'manual' })).status).toBe(404);
  });
});

describe('versioned routes', () => {
  it('serves the manifest entry at the version index', async () => {
    const base = await start();
    const res = await fetch(`${base}/g/mcp-quest/v/${LIVE_VERSION_ID}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await res.text()).toBe('<!doctype html>hi');
    expectSecurityHeaders(res);
  });

  it('serves a relative asset the creator references as ./questions.js', async () => {
    const base = await start();
    const res = await fetch(`${base}/g/mcp-quest/v/${LIVE_VERSION_ID}/questions.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  });

  it('takes Content-Type from the manifest, not the extension', async () => {
    const catalog: Catalog = {
      ...fakeCatalog(),
      async byVersion(slug, versionId) {
        const found = await fakeCatalog().byVersion(slug, versionId);
        if (!found) return null;
        // The manifest says this .js file is a PNG; the manifest wins.
        found.version.manifest.files = found.version.manifest.files.map((f) =>
          f.path === 'questions.js' ? { ...f, content_type: 'image/png' } : f,
        );
        return found;
      },
    };
    const base = await start({ catalog });
    const res = await fetch(`${base}/g/mcp-quest/v/${LIVE_VERSION_ID}/questions.js`);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('404s a file whose manifest content_type is not allowlisted', async () => {
    const base = await start();
    const res = await fetch(`${base}/g/mcp-quest/v/${LIVE_VERSION_ID}/notes.bin`);
    expect(res.status).toBe(404);
  });

  it('404s an object that exists in storage but is not in the manifest', async () => {
    const assets = fakeAssets();
    const base = await start({ assets });
    const res = await fetch(`${base}/g/mcp-quest/v/${LIVE_VERSION_ID}/secrets.env`);
    expect(res.status).toBe(404);
    // The manifest gate runs before any storage call — nothing was read.
    expect(assets.reads).toHaveLength(0);
  });

  it('404s a manifest entry missing from storage', async () => {
    const base = await start();
    expect((await fetch(`${base}/g/mcp-quest/v/${LIVE_VERSION_ID}/missing.js`)).status).toBe(404);
  });

  it('404s traversal attempts without touching storage', async () => {
    const assets = fakeAssets();
    const base = await start({ assets });
    for (const attempt of [
      '../../secrets.env',
      '%2e%2e/secrets.env',
      '%252e%252e/secrets.env',
      'img%2f..%2fsecrets.env',
      '..%5csecrets.env',
    ]) {
      const res = await fetch(`${base}/g/mcp-quest/v/${LIVE_VERSION_ID}/${attempt}`, { redirect: 'manual' });
      expect(res.status, attempt).toBe(404);
    }
    expect(assets.reads).toHaveLength(0);
  });

  it('404s an unknown version id', async () => {
    const base = await start();
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await fetch(`${base}/g/mcp-quest/v/${unknown}/`)).status).toBe(404);
  });

  it('carries the per-game csp_exceptions on the served response', async () => {
    const base = await start({
      catalog: fakeCatalog({ cspExceptions: { connect_src: ['https://api.example.com'], script_src: ['https://evil.example.com'] } }),
    });
    const res = await fetch(`${base}/g/mcp-quest/v/${LIVE_VERSION_ID}/`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain(`connect-src 'self' ${PORTAL_ORIGIN} https://api.example.com`);
    expect(csp).toContain("script-src 'self' 'unsafe-inline';");
    expect(csp).not.toContain('evil.example.com');
  });
});

describe('preview access policy', () => {
  const draftCatalog = () => fakeCatalog({ status: 'draft' });

  it('404s a draft version with no preview token', async () => {
    const base = await start({ catalog: draftCatalog() });
    const res = await fetch(`${base}/g/mcp-quest/v/${DRAFT_VERSION_ID}/`);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expectSecurityHeaders(res);
  });

  it('serves a draft version with a valid preview token', async () => {
    const base = await start({ catalog: draftCatalog() });
    const token = signPreviewToken(DRAFT_VERSION_ID, Math.floor(Date.now() / 1000) + 600, SECRET);
    const res = await fetch(`${base}/g/mcp-quest/v/${DRAFT_VERSION_ID}/?p=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
  });

  it('404s a preview token minted for a different version', async () => {
    const base = await start({ catalog: draftCatalog() });
    const token = signPreviewToken(LIVE_VERSION_ID, Math.floor(Date.now() / 1000) + 600, SECRET);
    const res = await fetch(`${base}/g/mcp-quest/v/${DRAFT_VERSION_ID}/?p=${encodeURIComponent(token)}`);
    expect(res.status).toBe(404);
  });

  it('404s an expired preview token', async () => {
    const base = await start({ catalog: draftCatalog() });
    const token = signPreviewToken(DRAFT_VERSION_ID, Math.floor(Date.now() / 1000) - 10, SECRET);
    const res = await fetch(`${base}/g/mcp-quest/v/${DRAFT_VERSION_ID}/?p=${encodeURIComponent(token)}`);
    expect(res.status).toBe(404);
  });

  it('needs no token once the game is published', async () => {
    const base = await start();
    expect((await fetch(`${base}/g/mcp-quest/v/${DRAFT_VERSION_ID}/`)).status).toBe(200);
  });

  it('still gates an archived game', async () => {
    const base = await start({ catalog: fakeCatalog({ status: 'archived' }) });
    expect((await fetch(`${base}/g/mcp-quest/v/${LIVE_VERSION_ID}/`)).status).toBe(404);
  });
});

describe('404s and non-routes', () => {
  it('serves the static error page with no-store and full headers', async () => {
    const base = await start();
    const res = await fetch(`${base}/g/no-such-game/`, { redirect: 'manual' });
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toContain('Game not found');
    expectSecurityHeaders(res);
  });

  it('refuses anything outside the games/sdk/ops surface', async () => {
    const base = await start();
    for (const path of ['/', '/index.html', '/api/modules/arcade/state', '/games/x/y/index.html']) {
      const res = await fetch(`${base}${path}`, { redirect: 'manual' });
      expect(res.status, path).toBe(404);
    }
  });

  it('rejects non-GET methods', async () => {
    const base = await start();
    const res = await fetch(`${base}/g/mcp-quest/`, { method: 'POST', redirect: 'manual' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    expectSecurityHeaders(res);
  });

  it('renders the 500 page when the catalog fails, without leaking why', async () => {
    const catalog: Catalog = {
      async bySlug() {
        throw new Error('connection refused to db-host:5432');
      },
      async byVersion() {
        return null;
      },
      async ping() {
        return false;
      },
    };
    const base = await start({ catalog });
    const res = await fetch(`${base}/g/mcp-quest/`, { redirect: 'manual' });
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain('Temporarily unavailable');
    expect(body).not.toContain('db-host');
    expectSecurityHeaders(res);
  });
});

describe('operational endpoints', () => {
  it('serves the SDK with a one hour cache and a JS content type', async () => {
    const base = await start({ sdkSource: 'window.GatewazeArcade = {};\n' });
    const res = await fetch(`${base}/sdk/gatewaze-arcade-1.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await res.text()).toContain('GatewazeArcade');
    expectSecurityHeaders(res);
  });

  it('reports health, readiness and metrics', async () => {
    const base = await start();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    const metrics = await fetch(`${base}/metrics`);
    expect(metrics.status).toBe(200);
    expect(await metrics.text()).toContain('arcade_serve_requests_total');
  });

  it('fails readiness when the database is unreachable', async () => {
    const catalog: Catalog = { ...fakeCatalog(), async ping() { return false; } };
    const base = await start({ catalog });
    expect((await fetch(`${base}/readyz`)).status).toBe(503);
  });
});

describe('strict host mode', () => {
  it('404s game routes served under the wrong Host', async () => {
    const base = await start({ config: testConfig({ strictHost: true }) });
    const res = await fetch(`${base}/g/mcp-quest/`, { redirect: 'manual' });
    expect(res.status).toBe(404);
  });
});
