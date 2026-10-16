import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetRegistryForTests, isMountLive } from '../registry';
import type { GwHostContext } from '../types';

// embed.tsx's own logic (validation -> registry -> global config -> render)
// is what's under test here — the heavy provider/router tree (EmbedApp) and
// the real Supabase client construction are mocked out so a failure in
// either doesn't mask a bug in the orchestration this file is responsible
// for. validateContext.test.ts and registry.test.ts cover those pieces
// directly and exhaustively.
vi.mock('@/embed/compiledModules', () => ({
  getCompiledModuleIds: () => [],
  getCompiledFeatures: () => [],
}));

const configureEmbedSupabase = vi.fn();
const configureHostSession = vi.fn();
vi.mock('@/lib/supabase', () => ({
  configureEmbedSupabase: (...args: unknown[]) => configureEmbedSupabase(...args),
  configureHostSession: (...args: unknown[]) => configureHostSession(...args),
}));

vi.mock('@/embed/EmbedApp', () => ({
  EmbedApp: () => null,
}));

function makeCtx(overrides: Partial<GwHostContext> = {}): GwHostContext {
  return {
    basename: '/apps/gw',
    supabase: { url: 'https://project.supabase.co', anonKey: 'anon-key' },
    apiBaseUrl: '',
    enabled: { moduleIds: [], features: [] },
    signIn: {
      startUrl: 'https://host.example.org/auth/start',
      returnUrl: 'https://host.example.org/apps/gw',
    },
    ...overrides,
  };
}

describe('mount / unmount', () => {
  beforeEach(() => {
    configureEmbedSupabase.mockReset();
    configureHostSession.mockReset();
    delete (globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__;
  });

  afterEach(() => {
    _resetRegistryForTests();
  });

  it('rejects an invalid context without registering a mount', async () => {
    const { mount } = await import('../../embed');
    const onFatal = vi.fn();
    const el = document.createElement('div');

    const handle = mount(el, makeCtx({ basename: 'no-leading-slash', onFatal }));

    expect(onFatal).toHaveBeenCalledWith(
      expect.objectContaining({ error_type: 'config_invalid', field: 'basename' }),
    );
    expect(isMountLive()).toBe(false);
    expect(configureEmbedSupabase).not.toHaveBeenCalled();
    expect(() => handle.unmount()).not.toThrow();
  });

  it('mounts successfully with a valid context', async () => {
    const { mount } = await import('../../embed');
    const el = document.createElement('div');

    const handle = mount(el, makeCtx());

    expect(isMountLive()).toBe(true);
    expect(configureEmbedSupabase).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://project.supabase.co', anonKey: 'anon-key' }),
    );
    const config = (globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__ as Record<string, string>;
    expect(config.VITE_SUPABASE_URL).toBe('https://project.supabase.co');
    expect(config.VITE_API_URL).toBe('/api/gw'); // '' apiBaseUrl defaults to /api/gw

    handle.unmount();
    expect(isMountLive()).toBe(false);
  });

  it('hands the host navigateHost hook to the app on mount and clears it on unmount', async () => {
    const { mount } = await import('../../embed');
    const { getHostNavigate } = await import('../hostNavigate');
    const navigateHost = vi.fn();
    const handle = mount(document.createElement('div'), makeCtx({ navigateHost }));
    expect(getHostNavigate()).toBe(navigateHost);
    handle.unmount();
    expect(getHostNavigate()).toBeNull();
  });

  it('hands the host loadingIndicator to the spinner on mount and clears it on unmount', async () => {
    const { mount } = await import('../../embed');
    const { getHostLoadingIndicator } = await import('../hostLoadingIndicator');
    const loadingIndicator = () => document.createElement('i');
    const handle = mount(document.createElement('div'), makeCtx({ loadingIndicator }));
    expect(getHostLoadingIndicator()).toBe(loadingIndicator);
    handle.unmount();
    expect(getHostLoadingIndicator()).toBeNull();
  });

  it('refuses a loadingIndicator that is not a function', async () => {
    const { mount } = await import('../../embed');
    const onFatal = vi.fn();
    mount(document.createElement('div'), makeCtx({ loadingIndicator: 'x' as unknown as () => HTMLElement, onFatal }));
    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ code: 'gw_ctx_loadingIndicator_invalid' }));
    expect(isMountLive()).toBe(false);
  });

  it('arms the first-paint signal on the mount element, and disarms it on unmount', async () => {
    const { mount } = await import('../../embed');
    const { signalFirstPaint } = await import('../firstPaint');
    const { FIRST_PAINT_EVENT } = await import('../contract');
    const telemetry = vi.fn();
    const el = document.createElement('div');
    const onPaint = vi.fn();
    el.addEventListener(FIRST_PAINT_EVENT, onPaint);

    const handle = mount(el, makeCtx({ telemetry }));
    signalFirstPaint();
    await vi.waitFor(() => expect(onPaint).toHaveBeenCalledTimes(1));
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({ name: 'gw_embed_first_paint', ms: expect.any(Number) }));
    handle.unmount();

    const el2 = document.createElement('div');
    const onPaint2 = vi.fn();
    el2.addEventListener(FIRST_PAINT_EVENT, onPaint2);
    mount(el2, makeCtx()).unmount();
    signalFirstPaint();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(onPaint2).not.toHaveBeenCalled();
  });

  it('ignores a navigateHost that is not a function', async () => {
    const { mount } = await import('../../embed');
    const { getHostNavigate } = await import('../hostNavigate');
    const handle = mount(
      document.createElement('div'),
      makeCtx({ navigateHost: 'not a function' as unknown as (path: string) => void }),
    );
    expect(getHostNavigate()).toBeNull();
    handle.unmount();
  });

  it('refuses a second concurrent mount and reports gw_double_mount', async () => {
    const { mount } = await import('../../embed');
    const first = document.createElement('div');
    const second = document.createElement('div');
    const onFatal = vi.fn();

    const firstHandle = mount(first, makeCtx());
    const secondHandle = mount(second, makeCtx({ onFatal }));

    expect(onFatal).toHaveBeenCalledWith(
      expect.objectContaining({ error_type: 'mount_aborted', code: 'gw_double_mount' }),
    );
    // The refused mount's handle is an inert no-op — unmounting it must not
    // tear down the still-live first mount.
    secondHandle.unmount();
    expect(isMountLive()).toBe(true);

    firstHandle.unmount();
    expect(isMountLive()).toBe(false);
  });

  it('self-heals after a mid-mount throw so the next mount attempt succeeds', async () => {
    const { mount } = await import('../../embed');
    const el = document.createElement('div');
    const onFatal = vi.fn();

    configureEmbedSupabase.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const failedHandle = mount(el, makeCtx({ onFatal, loadingIndicator: () => document.createElement('i') }));
    expect(onFatal).toHaveBeenCalledWith(
      expect.objectContaining({ error_type: 'import_failed', code: 'gw_mount_failed' }),
    );
    expect(isMountLive()).toBe(false);
    // The failed mount's host spinner is not left behind for the next one.
    const { getHostLoadingIndicator } = await import('../hostLoadingIndicator');
    expect(getHostLoadingIndicator()).toBeNull();
    expect(() => failedHandle.unmount()).not.toThrow();

    // Second attempt (configureEmbedSupabase now behaves) must not be
    // blocked by the failed first attempt.
    const handle = mount(el, makeCtx());
    expect(isMountLive()).toBe(true);
    handle.unmount();
  });

  describe('host-session mode', () => {
    const ORIGIN = window.location.origin;
    function hostCtx(overrides: Partial<GwHostContext> = {}): GwHostContext {
      const { signIn: _signIn, ...rest } = makeCtx();
      return {
        ...rest,
        supabase: { url: `${ORIGIN}/api/gatewaze/supabase`, anonKey: 'anon-key', publicUrl: 'https://project.supabase.co' },
        session: { mode: 'host', meUrl: '/api/gatewaze/session/me', logoutUrl: '/api/gatewaze/session/logout' },
        storageKeySuffix: 'ignored_here',
        ...overrides,
      };
    }

    it('configures the host session instead of a localStorage client', async () => {
      const { mount } = await import('../../embed');
      const el = document.createElement('div');

      const handle = mount(el, hostCtx());

      expect(configureEmbedSupabase).not.toHaveBeenCalled();
      expect(configureHostSession).toHaveBeenCalledWith({
        baseUrl: `${ORIGIN}/api/gatewaze/supabase`,
        anonKey: 'anon-key',
        meUrl: '/api/gatewaze/session/me',
        logoutUrl: '/api/gatewaze/session/logout',
        onSignedOut: expect.any(Function),
      });
      const config = (globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__ as Record<string, string>;
      expect(config.VITE_AUTH_MODE).toBe('host-session');
      expect(config.VITE_SUPABASE_URL).toBe(`${ORIGIN}/api/gatewaze/supabase`);
      handle.unmount();
    });

    it('sends a lost session to signIn.startUrl when the host gave one', async () => {
      const assign = vi.fn();
      vi.stubGlobal('location', { ...window.location, origin: ORIGIN, assign });
      const { mount } = await import('../../embed');
      const handle = mount(
        document.createElement('div'),
        hostCtx({ signIn: { startUrl: 'https://host.example.org/login', returnUrl: 'https://host.example.org/x' } }),
      );

      const { onSignedOut } = configureHostSession.mock.calls[0][0] as { onSignedOut: () => void };
      onSignedOut();

      expect(assign).toHaveBeenCalledWith('https://host.example.org/login');
      handle.unmount();
      vi.unstubAllGlobals();
    });

    it('reloads on a lost session when the host gave no signIn', async () => {
      window.sessionStorage.clear();
      const reload = vi.fn();
      const assign = vi.fn();
      vi.stubGlobal('location', { ...window.location, origin: ORIGIN, reload, assign });
      const { mount } = await import('../../embed');
      const handle = mount(document.createElement('div'), hostCtx());

      const { onSignedOut } = configureHostSession.mock.calls[0][0] as { onSignedOut: () => void };
      onSignedOut();

      expect(reload).toHaveBeenCalledTimes(1);
      expect(assign).not.toHaveBeenCalled();
      handle.unmount();
      vi.unstubAllGlobals();
    });

    it('writes supabase.publicUrl into the runtime config', async () => {
      const { mount } = await import('../../embed');
      const handle = mount(
        document.createElement('div'),
        hostCtx({ supabase: { url: `${ORIGIN}/api/gatewaze/supabase`, anonKey: 'anon-key', publicUrl: 'https://project.supabase.co' } }),
      );

      const config = (globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__ as Record<string, string>;
      expect(config.VITE_SUPABASE_PUBLIC_URL).toBe('https://project.supabase.co');
      handle.unmount();
    });

    it('stops reloading after two lost sessions within 30s (no reload loop)', async () => {
      window.sessionStorage.clear();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const reload = vi.fn();
      vi.stubGlobal('location', { ...window.location, origin: ORIGIN, reload });
      const { reloadForSignIn } = await import('../../embed');

      reloadForSignIn();
      reloadForSignIn();
      reloadForSignIn();

      expect(reload).toHaveBeenCalledTimes(2);
      vi.unstubAllGlobals();
    });

    it.each([
      ['read', 'getItem'],
      ['write', 'setItem'],
    ])('fails closed: no reload when the guard cannot %s sessionStorage', async (_label, method) => {
      window.sessionStorage.clear();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(Storage.prototype, method as 'getItem' | 'setItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      const reload = vi.fn();
      vi.stubGlobal('location', { ...window.location, origin: ORIGIN, reload });
      const { reloadForSignIn } = await import('../../embed');

      reloadForSignIn();

      expect(reload).not.toHaveBeenCalled();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('reloads again once the 30s window has passed', async () => {
      window.sessionStorage.setItem('gw-embed-signed-out-reloads', JSON.stringify([Date.now() - 31_000, Date.now() - 31_000]));
      const reload = vi.fn();
      vi.stubGlobal('location', { ...window.location, origin: ORIGIN, reload });
      const { reloadForSignIn } = await import('../../embed');

      reloadForSignIn();

      expect(reload).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    it('leaves the local-mode config without VITE_AUTH_MODE', async () => {
      const { mount } = await import('../../embed');
      const handle = mount(document.createElement('div'), makeCtx());

      const config = (globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__ as Record<string, string>;
      expect(config).not.toHaveProperty('VITE_AUTH_MODE');
      expect(config).not.toHaveProperty('VITE_SUPABASE_PUBLIC_URL');
      expect(configureHostSession).not.toHaveBeenCalled();
      handle.unmount();
    });
  });
});
