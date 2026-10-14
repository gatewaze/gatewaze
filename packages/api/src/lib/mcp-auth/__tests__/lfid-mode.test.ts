import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const warn = vi.fn();
vi.mock('../../logger.js', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), error: vi.fn(), info: vi.fn() } }));

const { LFID_SIGN_IN_MODE_TIMEOUT_MS, resolveLfidLogin } = await import('../lfid-mode.js');

type Row = { status: string; config: Record<string, string> } | null;

function fake(row: Row, rpcResult: unknown = { data: 'bridge', error: null }, lookupError: unknown = null) {
  const rpc = vi.fn();
  const abortSignal = vi.fn(async (signal: AbortSignal) => {
    rpc(signal);
    if (rpcResult instanceof Error) throw rpcResult;
    return rpcResult;
  });
  const client = {
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: lookupError }) }) }) })),
    rpc: vi.fn(() => ({ abortSignal })),
  };
  return { client: client as unknown as SupabaseClient, rpc: client.rpc, abortSignal };
}

const auth0 = { AUTH0_DOMAIN: 'd', AUTH0_CLIENT_ID: 'c' };
const env = { SUPABASE_PUBLIC_URL: 'https://sb.example.test/' };

beforeEach(() => warn.mockReset());

describe('resolveLfidLogin', () => {
  it('returns null (magic link) when the module is missing, disabled, or the lookup fails', async () => {
    expect(await resolveLfidLogin(fake(null).client, env)).toBeNull();
    const disabled = fake({ status: 'disabled', config: auth0 });
    expect(await resolveLfidLogin(disabled.client, { ...env, LFID_SIGN_IN_MODE: 'native' })).toBeNull();
    expect(disabled.rpc).not.toHaveBeenCalled();
    expect(await resolveLfidLogin(fake(null, undefined, { message: 'boom' }).client, env)).toBeNull();
  });

  it('is native on a native-deploy install without calling the rpc', async () => {
    const f = fake({ status: 'enabled', config: {} });
    expect(await resolveLfidLogin(f.client, { LFID_SIGN_IN_MODE: 'native' })).toEqual({ mode: 'native' });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it('only treats the exact env value native as native', async () => {
    const f = fake({ status: 'enabled', config: auth0 });
    expect(await resolveLfidLogin(f.client, { ...env, LFID_SIGN_IN_MODE: 'Native' })).toMatchObject({ mode: 'bridge' });
    expect(f.rpc).toHaveBeenCalledWith('lfid_sign_in_mode');
  });

  it('is native when lfid_sign_in_mode() returns native', async () => {
    const f = fake({ status: 'enabled', config: {} }, { data: 'native', error: null });
    expect(await resolveLfidLogin(f.client, env)).toEqual({ mode: 'native' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('gives up on a lookup that hangs and keeps the bridge', async () => {
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: 'enabled', config: auth0 }, error: null }) }) }) }),
      // Settles only when the signal aborts, as PostgREST does.
      rpc: () => ({
        abortSignal: (signal: AbortSignal) =>
          new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
      }),
    } as unknown as SupabaseClient;
    const started = Date.now();
    expect(await resolveLfidLogin(client, env)).toMatchObject({ mode: 'bridge' });
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(LFID_SIGN_IN_MODE_TIMEOUT_MS - 100);
    expect(took).toBeLessThan(LFID_SIGN_IN_MODE_TIMEOUT_MS + 2000);
    expect(warn).toHaveBeenCalledWith(expect.anything(), '[mcp-auth] lfid_sign_in_mode() threw; using bridge');
  }, 10_000);

  it('logs an unexpected value from lfid_sign_in_mode()', async () => {
    const f = fake({ status: 'enabled', config: auth0 }, { data: 'nativ', error: null });
    await resolveLfidLogin(f.client, env);
    expect(warn).toHaveBeenCalledWith({ value: 'nativ' }, '[mcp-auth] lfid_sign_in_mode() returned an unexpected value; using bridge');
  });

  it.each([
    ['bridge', { data: 'bridge', error: null }],
    ['an rpc error', { data: null, error: { code: '42883', message: 'missing' } }],
    ['an unexpected value', { data: { mode: 'native' }, error: null }],
    ['a thrown error', new Error('aborted')],
  ])('keeps the bridge for %s', async (_label, result) => {
    const f = fake({ status: 'enabled', config: auth0 }, result);
    expect(await resolveLfidLogin(f.client, env)).toEqual({
      mode: 'bridge',
      startUrl: 'https://sb.example.test/functions/v1/integrations-lfid-callback',
    });
  });

  it('returns null in bridge mode without the Auth0 keys or SUPABASE_PUBLIC_URL, as before', async () => {
    expect(await resolveLfidLogin(fake({ status: 'enabled', config: { AUTH0_DOMAIN: 'd' } }).client, env)).toBeNull();
    expect(await resolveLfidLogin(fake({ status: 'enabled', config: { AUTH0_CLIENT_ID: 'c' } }).client, env)).toBeNull();
    expect(await resolveLfidLogin(fake({ status: 'enabled', config: auth0 }).client, {})).toBeNull();
  });
});
