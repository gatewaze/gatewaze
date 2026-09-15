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
vi.mock('@/lib/supabase', () => ({
  configureEmbedSupabase: (...args: unknown[]) => configureEmbedSupabase(...args),
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
      lfidStartUrl: 'https://host.example.org/auth/lfid/start',
      returnUrl: 'https://host.example.org/apps/gw',
    },
    ...overrides,
  };
}

describe('mount / unmount', () => {
  beforeEach(() => {
    configureEmbedSupabase.mockReset();
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

    const failedHandle = mount(el, makeCtx({ onFatal }));
    expect(onFatal).toHaveBeenCalledWith(
      expect.objectContaining({ error_type: 'import_failed', code: 'gw_mount_failed' }),
    );
    expect(isMountLive()).toBe(false);
    expect(() => failedHandle.unmount()).not.toThrow();

    // Second attempt (configureEmbedSupabase now behaves) must not be
    // blocked by the failed first attempt.
    const handle = mount(el, makeCtx());
    expect(isMountLive()).toBe(true);
    handle.unmount();
  });
});
