import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Under vitest, vite.config.ts leaves import.meta.env on Vite's own
// resolution (the runtime-config define only applies to `vite build`), so
// vi.stubEnv drives VITE_SUPABASE_FLOW_TYPE here exactly as the pod env
// drives it in production.
const createClient = vi.fn((..._args: unknown[]) => ({}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

async function freshModule() {
  vi.resetModules();
  return import('../supabase');
}

function authOptionsOfLastCall(): Record<string, unknown> {
  const call = createClient.mock.calls.at(-1) as unknown[] | undefined;
  if (!call) throw new Error('createClient was not called');
  const options = call[2] as { auth: Record<string, unknown> };
  return options.auth;
}

describe('admin Supabase client flow type', () => {
  beforeEach(() => {
    createClient.mockClear();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubEnv('VITE_SUPABASE_FLOW_TYPE', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to the implicit flow, silently, when VITE_SUPABASE_FLOW_TYPE is unset', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await freshModule();
    mod.getSupabase();
    expect(authOptionsOfLastCall().flowType).toBe('implicit');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('uses PKCE when VITE_SUPABASE_FLOW_TYPE is exactly "pkce"', async () => {
    vi.stubEnv('VITE_SUPABASE_FLOW_TYPE', 'pkce');
    const mod = await freshModule();
    mod.getSupabase();
    expect(authOptionsOfLastCall().flowType).toBe('pkce');
  });

  it('falls back to implicit for any other value, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VITE_SUPABASE_FLOW_TYPE', 'PKCE');
    const mod = await freshModule();
    mod.getSupabase();
    expect(authOptionsOfLastCall().flowType).toBe('implicit');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"PKCE"'));
    warn.mockRestore();
  });

  it('stays quiet for an explicit implicit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VITE_SUPABASE_FLOW_TYPE', 'implicit');
    const mod = await freshModule();
    mod.getSupabase();
    expect(authOptionsOfLastCall().flowType).toBe('implicit');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps the embed on implicit even when the env asks for PKCE', async () => {
    vi.stubEnv('VITE_SUPABASE_FLOW_TYPE', 'pkce');
    const mod = await freshModule();
    mod.configureEmbedSupabase({
      url: 'https://embed-project.supabase.co',
      anonKey: 'embed-anon-key',
      storageKeySuffix: 'host',
    });
    mod.getSupabase();
    expect(authOptionsOfLastCall().flowType).toBe('implicit');
  });
});
