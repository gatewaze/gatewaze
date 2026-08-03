import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler, type HandlerDeps } from '../handler.js';
import { LIVE_VERSION_ID, fakeAssets, fakeCatalog, testConfig } from './fixtures.js';
import type { AssetStore, Catalog } from '../types.js';

// Two hardening fixes from the security review:
//  - the live redirect's Location is built from DB columns, so they are
//    re-validated like every other externally-sourced value in the handler;
//  - Content-Length is only ever a length measured from the same read as the
//    stream being sent, never the manifest's recorded size (a mismatch between
//    the two is the classic response-desync precondition behind a keep-alive
//    reverse proxy).

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

/** A catalog whose rows have been corrupted after the schema's own checks. */
function catalogReturning(mutate: (found: NonNullable<Awaited<ReturnType<Catalog['bySlug']>>>) => unknown): Catalog {
  const base = fakeCatalog();
  return {
    ...base,
    async bySlug(slug: string) {
      const found = await base.bySlug(slug);
      if (!found) return null;
      return mutate(found) as Awaited<ReturnType<Catalog['bySlug']>>;
    },
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

describe('live redirect Location is built only from re-validated values', () => {
  it('404s rather than emitting a header when the row has a malformed slug', async () => {
    const catalog = catalogReturning((found) => ({
      ...(found as Record<string, unknown>),
      game: { ...((found as { game: Record<string, unknown> }).game), slug: 'bad\r\nX-Injected: 1' },
    }));
    const base = await start({ catalog });

    const res = await fetch(`${base}/g/mcp-quest/`, { redirect: 'manual' });

    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-injected')).toBeNull();
  });

  it('404s when the live version id is not a uuid', async () => {
    const catalog = catalogReturning((found) => ({
      ...(found as Record<string, unknown>),
      liveVersion: { ...((found as { liveVersion: Record<string, unknown> }).liveVersion), id: '../../etc/passwd' },
    }));
    const base = await start({ catalog });

    const res = await fetch(`${base}/g/mcp-quest/`, { redirect: 'manual' });

    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
  });

  it('still redirects normally for a well-formed row', async () => {
    const base = await start();

    const res = await fetch(`${base}/g/mcp-quest/`, { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/g/mcp-quest/v/${LIVE_VERSION_ID}/`);
  });
});

describe('Content-Length is never taken from the manifest', () => {
  it('omits the header when the read reports no measured size', async () => {
    const body = 'console.log(1)';
    // The manifest records 10 bytes for questions.js; this store cannot measure.
    const assets: AssetStore = {
      async read() {
        return { stream: Readable.from([Buffer.from(body, 'utf8')]), bytes: null };
      },
    };
    const base = await start({ assets });

    const res = await fetch(`${base}/g/mcp-quest/v/${LIVE_VERSION_ID}/questions.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBeNull();
    expect(await res.text()).toBe(body);
  });

  it('uses the measured size when the read provides one', async () => {
    const base = await start();

    const res = await fetch(`${base}/g/mcp-quest/v/${LIVE_VERSION_ID}/questions.js`);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(text)));
  });
});
