/**
 * @gatewaze/admin-embed is the loader a host installs; the bundle it loads is
 * the embed built from this package. Testing it from here keeps the two in
 * one CI run, and lets the test build a real GwHostContext from the shared
 * types.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GwEmbedFatalError, GwHostContext } from '../types';
import { EMBED_CONTRACT, FIRST_PAINT_EVENT } from '../contract';

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
    document.head.querySelectorAll('style[data-gw-embed-stylesheet], link[data-gw-embed-preload]').forEach((s) => s.remove());
    vi.useRealTimers();
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

  it('fetches the stylesheet from the URL the host resolves, keyed by the hashed name', async () => {
    const el = document.createElement('div');
    const resolve = vi.fn((url: string) => `/api/gw/embed/stylesheet/${url.split('/').pop()}`);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return jsonResponse(MANIFEST);
      if (url === '/api/gw/embed/stylesheet/admin-embed-def456.css') return new Response('#scoped{}', { status: 200 });
      return new Response('not found', { status: 404 });
    });
    const handle = loader.mount(el, { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock, resolveStylesheetUrl: resolve } });
    expect(await handle.ready).toEqual(MANIFEST);
    expect(resolve).toHaveBeenCalledWith(`${BASE}/admin-embed-def456.css`);
    expect(document.head.querySelector('style[data-gw-embed-stylesheet]')?.textContent).toBe('#scoped{}');
    expect(fetchMock.mock.calls.some(([u]) => String(u) === `${BASE}/admin-embed-def456.css`)).toBe(false);
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

  describe('source.baseUrl scheme rule', () => {
    it('accepts http on a *.localhost dev host', async () => {
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: 'http://admin.gatewaze.localhost/embed', importEntry: importMock } });
      await handle.ready;
      expect(fatals.map((f) => f.code)).not.toContain('gw_ctx_source_invalid');
    });

    it.each(['http://evil.example/embed', 'http://localhost.evil.example/embed'])('rejects %s', async (baseUrl) => {
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl, importEntry: importMock } });
      expect(await handle.ready).toBeNull();
      expect(fatals.map((f) => f.code)).toEqual(['gw_ctx_source_invalid']);
    });

    it('seeds a *.localhost publicUrl', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: ['host-session'] }));
      const { signIn: _signIn, ...rest } = hostCtx();
      const ctx = {
        ...rest,
        supabase: { url: `${window.location.origin}/p`, anonKey: 'anon', publicUrl: 'http://supabase.gatewaze.localhost' },
        session: { mode: 'host' as const, meUrl: '/me', logoutUrl: '/logout' },
      };
      await loader.mount(document.createElement('div'), { ...ctx, source: { baseUrl: BASE, importEntry: importMock } }).ready;
      const config = (globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__ as Record<string, string>;
      expect(config.VITE_SUPABASE_PUBLIC_URL).toBe('http://supabase.gatewaze.localhost');
    });
  });

  describe('host-session capability', () => {
    const ORIGIN = window.location.origin;
    const hostSessionCtx = (): GwHostContext => {
      const { signIn: _signIn, ...rest } = hostCtx({ onFatal: (e) => fatals.push(e) });
      return {
        ...rest,
        supabase: { url: `${ORIGIN}/api/gatewaze/supabase`, anonKey: 'anon' },
        session: { mode: 'host', meUrl: '/api/gatewaze/session/me', logoutUrl: '/api/gatewaze/session/logout' },
      };
    };

    it('refuses a host-session context against a manifest without capabilities', async () => {
      // MANIFEST has no `capabilities`, like every bundle built before the field existed.
      const handle = loader.mount(document.createElement('div'), { ...hostSessionCtx(), source: { baseUrl: BASE, importEntry: importMock } });
      expect(await handle.ready).toBeNull();
      expect(fatals.map((f) => f.code)).toEqual(['gw_embed_capability_missing']);
      expect(fatals[0]).toMatchObject({ error_type: 'import_failed', recoverable: false });
      expect(importMock).not.toHaveBeenCalled();
      expect(innerMount).not.toHaveBeenCalled();
    });

    it('refuses a host-session context when the capabilities list lacks host-session', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: ['something-else'] }));
      const handle = loader.mount(document.createElement('div'), { ...hostSessionCtx(), source: { baseUrl: BASE, importEntry: importMock } });
      expect(await handle.ready).toBeNull();
      expect(fatals.map((f) => f.code)).toEqual(['gw_embed_capability_missing']);
    });

    it('mounts a local-mode context against a manifest without capabilities', async () => {
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock } });
      expect(await handle.ready).not.toBeNull();
      expect(fatals).toEqual([]);
      expect(innerMount).toHaveBeenCalled();
    });

    it('mounts a host-session context against a manifest that lists host-session', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: ['host-session'] }));
      const handle = loader.mount(document.createElement('div'), { ...hostSessionCtx(), source: { baseUrl: BASE, importEntry: importMock } });
      expect(await handle.ready).not.toBeNull();
      expect(fatals).toEqual([]);
      expect(innerMount).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ session: expect.objectContaining({ mode: 'host' }) }));
      const config = (globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__ as Record<string, string>;
      expect(config.VITE_AUTH_MODE).toBe('host-session');
    });

    it('rejects a manifest whose capabilities is not a string array', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: 'host-session' }));
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock } });
      expect(await handle.ready).toBeNull();
      expect(fatals.map((f) => f.code)).toEqual(['gw_embed_manifest_unreachable']);
    });

    it('refuses a malformed session (any session at all) against a manifest without the capability', async () => {
      const ctx = { ...hostSessionCtx(), session: { mode: 'HOST', meUrl: '/me', logoutUrl: '/logout' } } as unknown as GwHostContext;
      const handle = loader.mount(document.createElement('div'), { ...ctx, source: { baseUrl: BASE, importEntry: importMock } });
      expect(await handle.ready).toBeNull();
      expect(fatals.map((f) => f.code)).toEqual(['gw_embed_capability_missing']);
      expect(importMock).not.toHaveBeenCalled();
    });

    it('refuses session: null against a manifest without the capability', async () => {
      const ctx = { ...hostSessionCtx(), session: null } as unknown as GwHostContext;
      const handle = loader.mount(document.createElement('div'), { ...ctx, source: { baseUrl: BASE, importEntry: importMock } });
      expect(await handle.ready).toBeNull();
      expect(fatals.map((f) => f.code)).toEqual(['gw_embed_capability_missing']);
    });

    it('rejects a manifest whose capabilities hold non-strings', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: [1] }));
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock } });
      expect(await handle.ready).toBeNull();
      expect(fatals.map((f) => f.code)).toEqual(['gw_embed_manifest_unreachable']);
    });

    it('does not seed a publicUrl that fails the https/localhost rule', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: ['host-session'] }));
      const ctx = hostSessionCtx();
      ctx.supabase.publicUrl = 'javascript:alert(1)';
      await loader.mount(document.createElement('div'), { ...ctx, source: { baseUrl: BASE, importEntry: importMock } }).ready;
      const config = (globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__ as Record<string, string>;
      expect(config).not.toHaveProperty('VITE_SUPABASE_PUBLIC_URL');
    });

    it('passes supabase.publicUrl through to the seeded runtime config', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: ['host-session'] }));
      const ctx = hostSessionCtx();
      ctx.supabase.publicUrl = 'https://project.supabase.co';
      const handle = loader.mount(document.createElement('div'), { ...ctx, source: { baseUrl: BASE, importEntry: importMock } });
      expect(await handle.ready).not.toBeNull();
      const config = (globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__ as Record<string, string>;
      expect(config.VITE_SUPABASE_PUBLIC_URL).toBe('https://project.supabase.co');
      expect(innerMount).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ supabase: expect.objectContaining({ publicUrl: 'https://project.supabase.co' }) }));
    });
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

  describe('loader 1.2.0: parallel load, preload, rendered', () => {
    function deferred<T>() {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    it('uses the same first-paint event name as the bundle', () => {
      expect(loader.FIRST_PAINT_EVENT).toBe(FIRST_PAINT_EVENT);
    });

    it('starts importing the entry while the stylesheet is still downloading, and mounts only after both', async () => {
      const css = deferred<Response>();
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/manifest.json')) return jsonResponse(MANIFEST);
        if (url.endsWith('.css')) return css.promise;
        return new Response('not found', { status: 404 });
      });
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock } });
      await vi.waitFor(() => expect(importMock).toHaveBeenCalledWith(`${BASE}/admin-embed-abc123.js`));
      expect(innerMount).not.toHaveBeenCalled();
      css.resolve(new Response('.gw{}', { status: 200 }));
      expect(await handle.ready).toEqual(MANIFEST);
      expect(innerMount).toHaveBeenCalledTimes(1);
      expect(document.head.querySelector('style[data-gw-embed-stylesheet]')?.textContent).toBe('.gw{}');
      expect(fatals).toEqual([]);
    });

    it('does not mount when the stylesheet fails, even though the entry imported', async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/manifest.json')) return jsonResponse(MANIFEST);
        return new Response('gone', { status: 500 });
      });
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock } });
      expect(await handle.ready).toBeNull();
      expect(fatals.map((f) => f.code)).toEqual(['gw_embed_import_failed']);
      expect(fatals[0].message).toContain('stylesheet responded 500');
      expect(innerMount).not.toHaveBeenCalled();
      await handle.rendered;
    });

    it('reports an entry that fails to import while the stylesheet is still in flight', async () => {
      const css = deferred<Response>();
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/manifest.json')) return jsonResponse(MANIFEST);
        return css.promise;
      });
      importMock.mockImplementationOnce(async () => {
        throw new Error('network');
      });
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock } });
      await vi.waitFor(() => expect(importMock).toHaveBeenCalled());
      css.resolve(new Response('.gw{}', { status: 200 }));
      expect(await handle.ready).toBeNull();
      expect(fatals.map((f) => f.code)).toEqual(['gw_embed_import_failed']);
      expect(innerMount).not.toHaveBeenCalled();
    });

    it('adds a modulepreload link for each preload file when it imports the entry itself', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, preload: ['chunks/react-a.js', 'chunks/ui-b.js'] }));
      // No importEntry: the native import() of an https URL cannot run under
      // vitest, so this load fails after the links are in place.
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE } });
      await handle.ready;
      const links = [...document.head.querySelectorAll<HTMLLinkElement>('link[data-gw-embed-preload]')];
      expect(links.map((l) => [l.rel, l.href, l.crossOrigin])).toEqual([
        ['modulepreload', `${BASE}/chunks/react-a.js`, 'anonymous'],
        ['modulepreload', `${BASE}/chunks/ui-b.js`, 'anonymous'],
      ]);
    });

    it('does not duplicate preload links across mounts', async () => {
      for (let i = 0; i < 2; i++) {
        fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, preload: ['chunks/react-a.js'] }));
        await loader.mount(document.createElement('div'), { ...hostCtx(), source: { baseUrl: BASE } }).ready;
      }
      expect(document.head.querySelectorAll('link[data-gw-embed-preload]')).toHaveLength(1);
    });

    it('caps the number of preload links', async () => {
      const preload = Array.from({ length: loader.MAX_PRELOADS + 5 }, (_, i) => `chunks/c${i}.js`);
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, preload }));
      await loader.mount(document.createElement('div'), { ...hostCtx(), source: { baseUrl: BASE } }).ready;
      expect(document.head.querySelectorAll('link[data-gw-embed-preload]')).toHaveLength(loader.MAX_PRELOADS);
    });

    it('adds no preload links when the host imports the entry its own way', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, preload: ['chunks/react-a.js'] }));
      expect(await loader.mount(document.createElement('div'), { ...hostCtx(), source: { baseUrl: BASE, importEntry: importMock } }).ready).not.toBeNull();
      expect(document.head.querySelectorAll('link[data-gw-embed-preload]')).toHaveLength(0);
    });

    it.each([
      [{ preload: ['https://evil.example.test/x.js'] }],
      [{ preload: ['//evil.example.test/x.js'] }],
      [{ preload: 'chunks/a.js' }],
      [{ preload: [''] }],
      [{ preload: [1] }],
    ])('refuses a manifest with a bad preload list (%j) before fetching anything else', async (bad) => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, ...bad }));
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE } });
      expect(await handle.ready).toBeNull();
      expect(fatals.map((f) => f.code)).toEqual(['gw_embed_manifest_unreachable']);
      expect(document.head.querySelectorAll('link[data-gw-embed-preload]')).toHaveLength(0);
      expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('.css'))).toHaveLength(0);
    });

    it('refuses a manifest listing more than MAX_MANIFEST_PRELOADS preloads', async () => {
      const preload = Array.from({ length: loader.MAX_MANIFEST_PRELOADS + 1 }, (_, i) => `chunks/c${i}.js`);
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, preload }));
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE } });
      expect(await handle.ready).toBeNull();
      expect(fatals.map((f) => f.code)).toEqual(['gw_embed_manifest_unreachable']);
    });

    it('imports natively without trouble when the manifest has no preload list', async () => {
      // The native import() cannot load under vitest; the point is that the
      // missing list itself never causes the failure.
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE } });
      await handle.ready;
      expect(document.head.querySelectorAll('link[data-gw-embed-preload]')).toHaveLength(0);
      expect(fatals.every((f) => !/slice|undefined/.test(f.message))).toBe(true);
    });

    it('reports a bundle whose mount() throws, and never rejects ready', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: ['first-paint'] }));
      innerMount.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock } });
      expect(await handle.ready).toBeNull();
      expect(fatals).toEqual([expect.objectContaining({ code: 'gw_embed_mount_failed', error_type: 'render_crash' })]);
      await handle.rendered;
    });

    it('accepts a manifest carrying fields it does not know (forward compatibility)', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, someFutureField: { x: 1 } }));
      expect(await loader.mount(document.createElement('div'), { ...hostCtx(), source: { baseUrl: BASE, importEntry: importMock } }).ready).not.toBeNull();
    });

    it('resolves rendered with ready for a bundle without the first-paint capability', async () => {
      const handle = loader.mount(document.createElement('div'), { ...hostCtx(), source: { baseUrl: BASE, importEntry: importMock } });
      let renderedDone = false;
      void handle.rendered.then(() => {
        renderedDone = true;
      });
      expect(await handle.ready).not.toBeNull();
      await handle.rendered;
      expect(renderedDone).toBe(true);
    });

    it('waits for the bundle\'s first-paint event when the manifest lists first-paint', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: ['first-paint'] }));
      const el = document.createElement('div');
      const handle = loader.mount(el, { ...hostCtx(), source: { baseUrl: BASE, importEntry: importMock } });
      let renderedDone = false;
      void handle.rendered.then(() => {
        renderedDone = true;
      });
      await handle.ready;
      await new Promise((r) => setTimeout(r, 0));
      expect(renderedDone).toBe(false);
      el.dispatchEvent(new CustomEvent(FIRST_PAINT_EVENT));
      await handle.rendered;
      expect(renderedDone).toBe(true);
    });

    it('resolves rendered when a first-paint bundle reports a fatal error after mount', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: ['first-paint'] }));
      const handle = loader.mount(document.createElement('div'), { ...hostCtx({ onFatal: (e) => fatals.push(e) }), source: { baseUrl: BASE, importEntry: importMock } });
      await handle.ready;
      const mountedCtx = innerMount.mock.calls[0][1] as GwHostContext;
      const crash: GwEmbedFatalError = { error_type: 'render_crash', code: 'gw_render_crash', message: 'x', recoverable: false };
      mountedCtx.onFatal?.(crash);
      await handle.rendered;
      // The host's own hook still hears about it.
      expect(fatals).toEqual([crash]);
    });

    it('resolves rendered on unmount, and when loading fails', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: ['first-paint'] }));
      const handle = loader.mount(document.createElement('div'), { ...hostCtx(), source: { baseUrl: BASE, importEntry: importMock } });
      await handle.ready;
      handle.unmount();
      await handle.rendered;

      fetchMock.mockImplementationOnce(async () => new Response('down', { status: 503 }));
      const failed = loader.mount(document.createElement('div'), { ...hostCtx(), source: { baseUrl: BASE, importEntry: importMock } });
      expect(await failed.ready).toBeNull();
      await failed.rendered;

      const invalid = loader.mount(document.createElement('div'), { ...hostCtx(), source: { baseUrl: 'ftp://x' } });
      await invalid.rendered;
    });

    it('resolves rendered after FIRST_PAINT_TIMEOUT_MS when a first-paint bundle never signals', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: ['first-paint'] }));
      const handle = loader.mount(document.createElement('div'), { ...hostCtx(), source: { baseUrl: BASE, importEntry: importMock } });
      let renderedDone = false;
      void handle.rendered.then(() => {
        renderedDone = true;
      });
      expect(await handle.ready).not.toBeNull();
      expect(innerMount).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(loader.FIRST_PAINT_TIMEOUT_MS - 1);
      expect(renderedDone).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(renderedDone).toBe(true);
    });

    it('passes loadingIndicator through only to a bundle that lists host-loading-indicator', async () => {
      const loadingIndicator = () => document.createElement('i');

      await loader.mount(document.createElement('div'), { ...hostCtx({ loadingIndicator }), source: { baseUrl: BASE, importEntry: importMock } }).ready;
      expect(innerMount.mock.calls[0][1]).not.toHaveProperty('loadingIndicator');

      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: ['host-loading-indicator'] }));
      await loader.mount(document.createElement('div'), { ...hostCtx({ loadingIndicator }), source: { baseUrl: BASE, importEntry: importMock } }).ready;
      expect((innerMount.mock.calls[1][1] as GwHostContext).loadingIndicator).toBe(loadingIndicator);
    });

    it('never writes into the host\'s own context object', async () => {
      fetchMock.mockImplementationOnce(async () => jsonResponse({ ...MANIFEST, capabilities: ['first-paint'] }));
      const onFatal = vi.fn();
      const ctx = { ...hostCtx({ onFatal }), source: { baseUrl: BASE, importEntry: importMock } };
      await loader.mount(document.createElement('div'), ctx).ready;
      expect(ctx.onFatal).toBe(onFatal);
    });
  });
});
