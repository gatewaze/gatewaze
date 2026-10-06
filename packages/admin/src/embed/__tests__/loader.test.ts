/**
 * @gatewaze/admin-embed is the loader a host installs; the bundle it loads is
 * the embed built from this package. Testing it from here keeps the two in
 * one CI run, and lets the test build a real GwHostContext from the shared
 * types.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GwEmbedFatalError, GwHostContext } from '../types';
import { EMBED_CONTRACT } from '../contract';

type Loader = typeof import('../../../../admin-embed/src/index');

const BASE = 'https://admin.example.test/embed';
const MANIFEST = {
  contract: EMBED_CONTRACT,
  version: '1.2.3',
  entry: 'admin-embed-abc123.js',
  stylesheet: 'admin-embed-def456.css',
  modules: ['newsletters'],
  builtAt: '2026-01-01T00:00:00.000Z',
};

function hostCtx(overrides: Partial<GwHostContext> = {}): GwHostContext {
  return {
    basename: '/gw',
    supabase: { url: 'https://data.example.test', anonKey: 'anon' },
    apiBaseUrl: '',
    enabled: { moduleIds: ['newsletters'], features: [] },
    signIn: { startUrl: 'https://host.example.test/auth/start', returnUrl: 'https://host.example.test/gw' },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('@gatewaze/admin-embed loader', () => {
  let loader: Loader;
  let fetchMock: ReturnType<typeof vi.fn>;
  let importMock: ReturnType<typeof vi.fn<(url: string) => Promise<unknown>>>;
  let innerMount: ReturnType<typeof vi.fn>;
  let innerUnmount: ReturnType<typeof vi.fn>;
  let fatals: GwEmbedFatalError[];

  beforeEach(async () => {
    // The build stamps these; the source reads them as bare globals.
    Object.assign(globalThis, { __EMBED_CONTRACT__: EMBED_CONTRACT, __ADMIN_EMBED_VERSION__: 'test' });
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fatals = [];
    innerUnmount = vi.fn();
    innerMount = vi.fn(() => ({ unmount: innerUnmount }));
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return jsonResponse(MANIFEST);
      if (url.endsWith('.css')) return new Response('.gw{color:red}', { status: 200 });
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    loader = await import('../../../../admin-embed/src/index');
    // vitest cannot intercept a native dynamic import() of an https URL, so
    // every mount below passes source.importEntry.
    importMock = vi.fn<(url: string) => Promise<unknown>>(async () => ({ mount: innerMount, version: 'bundle' }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.head.querySelectorAll('style[data-gw-embed-stylesheet]').forEach((s) => s.remove());
  });

  it('refuses a source that is not https (or localhost http) without touching the network', async () => {
    const el = document.createElement('div');
    const handle = loader.mount(el, { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: 'ftp://x' } });
    expect(await handle.ready).toBeNull();
    expect(fatals.map((f) => f.code)).toEqual(['gw_ctx_source_invalid']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the manifest no-store, injects the stylesheet, seeds the runtime config and mounts', async () => {
    const el = document.createElement('div');
    const transform = vi.fn((css: string) => `#scope{${css}}`);
    const telemetry = vi.fn();
    const handle = loader.mount(el, {
      ...hostCtx({ onFatal: (e) => fatals.push(e), telemetry }),
      source: { baseUrl: BASE, transformStylesheet: transform, importEntry: importMock },
    });
    const manifest = await handle.ready;

    expect(fatals).toEqual([]);
    expect(manifest).toEqual(MANIFEST);
    expect(fetchMock.mock.calls[0]).toEqual([`${BASE}/manifest.json`, expect.objectContaining({ cache: 'no-store', credentials: 'omit' })]);
    const style = document.head.querySelector('style[data-gw-embed-stylesheet]');
    expect(style?.textContent).toBe('#scope{.gw{color:red}}');
    expect(importMock).toHaveBeenCalledWith(`${BASE}/admin-embed-abc123.js`);
    // Set before the import, with the values mount() itself applies.
    expect((globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__).toEqual({
      VITE_SUPABASE_URL: 'https://data.example.test',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_API_URL: '/api/gw',
    });
    // The loader's own field never reaches the embed.
    const [mountedEl, mountedCtx] = innerMount.mock.calls[0] as [HTMLElement, Record<string, unknown>];
    expect(mountedEl).toBe(el);
    expect(mountedCtx).not.toHaveProperty('source');
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({ name: 'gw_embed_loaded', embed: '1.2.3', contract: EMBED_CONTRACT }));

    handle.unmount();
    expect(innerUnmount).toHaveBeenCalledTimes(1);
  });

  it('reuses an injected stylesheet across re-mounts of the same build', async () => {
    const el = document.createElement('div');
    await loader.mount(el, { ...hostCtx(), source: { baseUrl: BASE, importEntry: importMock } }).ready;
    await loader.mount(el, { ...hostCtx(), source: { baseUrl: BASE, importEntry: importMock } }).ready;
    expect(document.head.querySelectorAll('style[data-gw-embed-stylesheet]')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('.css'))).toHaveLength(1);
  });

  it('refuses a bundle built for a different host contract', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, contract: EMBED_CONTRACT + 1 }));
    const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock } });
    expect(await handle.ready).toBeNull();
    expect(fatals.map((f) => f.code)).toEqual(['gw_embed_contract_mismatch']);
    expect(fatals[0].recoverable).toBe(false);
    expect(importMock).not.toHaveBeenCalled();
  });

  it('refuses a manifest whose entry or stylesheet lives on another origin', async () => {
    for (const bad of [{ entry: 'https://evil.example.test/payload.js' }, { stylesheet: '//evil.example.test/x.css' }]) {
      fatals = [];
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, ...bad }));
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock } });
      expect(await handle.ready).toBeNull();
      expect(fatals.map((f) => f.code)).toEqual(['gw_embed_manifest_unreachable']);
    }
    expect(importMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('.css'))).toHaveLength(0);
  });

  it('reports an unreachable or malformed manifest as recoverable', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ nope: true }));
    const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock } });
    expect(await handle.ready).toBeNull();
    expect(fatals.map((f) => f.code)).toEqual(['gw_embed_manifest_unreachable']);
    expect(fatals[0].recoverable).toBe(true);
  });

  it('does not mount when unmounted before the bundle arrived', async () => {
    const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock } });
    handle.unmount();
    expect(await handle.ready).toBeNull();
    expect(innerMount).not.toHaveBeenCalled();
    expect(fatals).toEqual([]);
  });
});
