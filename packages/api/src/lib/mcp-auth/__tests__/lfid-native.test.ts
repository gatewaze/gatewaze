import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const warn = vi.fn();
vi.mock('../../logger.js', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), error: vi.fn(), info: vi.fn() } }));

const { finishNativeLfid, nativeLfidConfig, NativeLfidRefused, startNativeLfid } = await import('../lfid-native.js');
type NativeLfidConfig = import('../lfid-native.js').NativeLfidConfig;

const cfg: NativeLfidConfig = {
  supabaseUrl: 'http://kong:8000',
  publicSupabaseUrl: 'https://sb.example.test',
  anonKey: 'anon',
};
const REDIRECT = 'https://api.example.test/api/mcp-auth/lfid/callback/req123';

function session(user: Record<string, unknown>) {
  return {
    access_token: 'h.eyJzdWIiOiJ1MSJ9.s',
    refresh_token: 'rt',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: 'u1',
      aud: 'authenticated',
      email: 'ada@example.test',
      email_confirmed_at: '2026-10-01T00:00:00Z',
      user_metadata: { full_name: 'Ada Lovelace' },
      app_metadata: {},
      created_at: '2026-10-01T00:00:00Z',
      identities: [
        { id: 'i0', provider: 'email', identity_data: { sub: 'u1' } },
        { id: 'i1', provider: 'custom:lfid', identity_data: { sub: 'auth0|ada' } },
      ],
      ...user,
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Stubs fetch: GoTrue's PKCE token exchange and logout. */
function stubGoTrue(
  user: Record<string, unknown> = {},
  opts: { logout?: 'ok' | 'throws' | 500; token?: Response } = {},
) {
  const calls: { url: string; body: unknown; signal?: AbortSignal | null }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, signal: init?.signal });
    if (url.includes('/auth/v1/token?grant_type=pkce')) return opts.token ?? json(session(user));
    if (url.includes('/auth/v1/logout')) {
      if (opts.logout === 'throws') throw new Error('network down');
      if (opts.logout === 500) return json({ code: 500, msg: 'boom' }, 500);
      return new Response(null, { status: 204 });
    }
    return json({}, 404);
  }));
  return calls;
}

// supabase-js keeps the verifier JSON-encoded, optionally suffixed with '/<flow>'.
function storedVerifier(stored: string): string {
  return String(JSON.parse(stored)).split('/')[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockReset();
});

describe('nativeLfidConfig', () => {
  it('needs SUPABASE_URL and an anon key', () => {
    expect(nativeLfidConfig({})).toBeNull();
    expect(nativeLfidConfig({ SUPABASE_URL: 'https://x' })).toBeNull();
    expect(nativeLfidConfig({ SUPABASE_ANON_KEY: 'a' })).toBeNull();
  });

  it('defaults the public URL to SUPABASE_URL and trims trailing slashes', () => {
    expect(nativeLfidConfig({ SUPABASE_URL: 'https://x/', VITE_SUPABASE_ANON_KEY: 'a' }))
      .toEqual({ supabaseUrl: 'https://x', publicSupabaseUrl: 'https://x', anonKey: 'a' });
    expect(nativeLfidConfig({ SUPABASE_URL: 'http://kong:8000', SUPABASE_PUBLIC_URL: 'https://sb/', SUPABASE_ANON_KEY: 'a' }))
      .toEqual({ supabaseUrl: 'http://kong:8000', publicSupabaseUrl: 'https://sb', anonKey: 'a' });
  });
});

describe('startNativeLfid', () => {
  it('builds a public GoTrue authorize URL for custom:lfid with an S256 challenge of the kept verifier', async () => {
    const { url, pkce } = await startNativeLfid(cfg, REDIRECT);
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe('https://sb.example.test/auth/v1/authorize');
    expect(u.searchParams.get('provider')).toBe('custom:lfid');
    expect(u.searchParams.get('redirect_to')).toBe(REDIRECT);
    expect(u.searchParams.get('code_challenge_method')).toBe('s256');

    const [key, stored] = Object.entries(pkce).find(([k]) => k.endsWith('-code-verifier'))!;
    expect(key).toBeTruthy();
    const verifier = storedVerifier(stored);
    expect(u.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('makes a new verifier every time', async () => {
    const a = await startNativeLfid(cfg, REDIRECT);
    const b = await startNativeLfid(cfg, REDIRECT);
    expect(a.pkce).not.toEqual(b.pkce);
  });
});

describe('finishNativeLfid', () => {
  it('exchanges the code with the stored verifier and returns the LFID identity', async () => {
    const { pkce } = await startNativeLfid(cfg, REDIRECT);
    const calls = stubGoTrue();
    const who = await finishNativeLfid(cfg, 'the-code', pkce);
    expect(who).toEqual({ authUserId: 'u1', email: 'ada@example.test', lfidSub: 'auth0|ada', displayName: 'Ada Lovelace' });

    const exchange = calls.find((c) => c.url.includes('grant_type=pkce'))!;
    expect(exchange.url.startsWith('http://kong:8000/auth/v1/token')).toBe(true);
    const verifier = storedVerifier(Object.values(pkce)[0]);
    expect(exchange.body).toEqual({ auth_code: 'the-code', code_verifier: verifier });
    // The GoTrue session is only used to identify the user.
    expect(calls.some((c) => c.url.includes('/auth/v1/logout'))).toBe(true);
  });

  it.each([['throws', 'throws' as const], ['answers 500', 500 as const]])(
    'still succeeds, and logs it, when revoking the GoTrue session %s',
    async (_label, logout) => {
      const { pkce } = await startNativeLfid(cfg, REDIRECT);
      stubGoTrue({}, { logout });
      await expect(finishNativeLfid(cfg, 'c', pkce)).resolves.toMatchObject({ authUserId: 'u1' });
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), '[mcp-auth] could not revoke the native LFID GoTrue session');
    },
  );

  it('does not log when the revoke succeeds', async () => {
    const { pkce } = await startNativeLfid(cfg, REDIRECT);
    stubGoTrue();
    await finishNativeLfid(cfg, 'c', pkce);
    expect(warn).not.toHaveBeenCalled();
  });

  it('bounds every GoTrue call with a timeout signal', async () => {
    const { pkce } = await startNativeLfid(cfg, REDIRECT);
    const calls = stubGoTrue();
    await finishNativeLfid(cfg, 'c', pkce);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.signal).toBeInstanceOf(AbortSignal);
  });

  it('treats a GoTrue 4xx on the exchange as a refusal', async () => {
    const { pkce } = await startNativeLfid(cfg, REDIRECT);
    stubGoTrue({}, { token: json({ code: 400, error_code: 'flow_state_not_found', msg: 'invalid flow state, no valid flow state found' }, 400) });
    await expect(finishNativeLfid(cfg, 'c', pkce)).rejects.toBeInstanceOf(NativeLfidRefused);
  });

  it.each([429, 500, 503])('treats a GoTrue %i on the exchange as an upstream failure, not a refusal', async (status) => {
    const { pkce } = await startNativeLfid(cfg, REDIRECT);
    stubGoTrue({}, { token: json({ code: status, msg: 'down' }, status) });
    const err = await finishNativeLfid(cfg, 'c', pkce).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NativeLfidRefused);
  });

  it('leaves lfidSub unset when the user has no custom:lfid identity', async () => {
    const { pkce } = await startNativeLfid(cfg, REDIRECT);
    stubGoTrue({ identities: [{ id: 'i0', provider: 'email', identity_data: { sub: 'u1' } }], user_metadata: { name: 'Ada' } });
    const who = await finishNativeLfid(cfg, 'c', pkce);
    expect(who.lfidSub).toBeUndefined();
    expect(who.displayName).toBe('Ada');
  });

  it('refuses a user whose email is not verified', async () => {
    const { pkce } = await startNativeLfid(cfg, REDIRECT);
    stubGoTrue({ email_confirmed_at: null });
    await expect(finishNativeLfid(cfg, 'c', pkce)).rejects.toThrow(NativeLfidRefused);
    await expect(finishNativeLfid(cfg, 'c', pkce)).rejects.toThrow(/not verified/);
  });

  it('refuses a user with no email', async () => {
    const { pkce } = await startNativeLfid(cfg, REDIRECT);
    stubGoTrue({ email: '' });
    await expect(finishNativeLfid(cfg, 'c', pkce)).rejects.toThrow(NativeLfidRefused);
  });

  it('fails without the verifier, before calling GoTrue', async () => {
    const calls = stubGoTrue();
    await expect(finishNativeLfid(cfg, 'c', {})).rejects.toThrow(/code verifier/i);
    expect(calls).toHaveLength(0);
  });
});
