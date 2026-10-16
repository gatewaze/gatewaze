// getAdminContext: the optional `admin` field of a session holder's /me.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_CONTEXT_TIMEOUT_MS, ADMIN_PROFILE_COLUMNS, type HostSessionConfig, getAdminContext } from '../src/session.js';

const UP = 'http://supabase-kong:8000';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE = {
  id: 'prof-1',
  user_id: USER_ID,
  email: 'admin@example.org',
  name: 'Ada Admin',
  role: 'admin',
  avatar_url: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('getAdminContext', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.fn<(obj: Record<string, unknown>, msg: string) => void>>;
  let cfg: HostSessionConfig;

  beforeEach(() => {
    warn = vi.fn<(obj: Record<string, unknown>, msg: string) => void>();
    cfg = { supabaseUrl: UP, anonKey: 'anon', log: { warn } };
    fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/rest/v1/admin_profiles')) return json(200, [PROFILE]);
      if (url.endsWith('/rest/v1/rpc/admin_get_features')) return json(200, [{ feature: 'newsletters' }, { feature: 'broadcasts' }, { feature: 'newsletters' }]);
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the active profile and the granted features with the user\'s own token', async () => {
    const ctx = await getAdminContext(cfg, 'user-jwt', USER_ID);
    expect(ctx).toEqual({ profile: PROFILE, features: ['newsletters', 'broadcasts'] });

    const [profileCall, featuresCall] = [
      fetchMock.mock.calls.find(([u]) => String(u).includes('admin_profiles'))!,
      fetchMock.mock.calls.find(([u]) => String(u).includes('admin_get_features'))!,
    ];
    const profileUrl = new URL(String(profileCall[0]));
    expect(profileUrl.searchParams.get('select')).toBe(ADMIN_PROFILE_COLUMNS);
    expect(profileUrl.searchParams.get('user_id')).toBe(`eq.${USER_ID}`);
    expect(profileUrl.searchParams.get('is_active')).toBe('eq.true');
    expect(profileCall[1].headers).toEqual({ apikey: 'anon', authorization: 'Bearer user-jwt' });
    expect(featuresCall[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ p_admin_id: USER_ID }) });
    expect(featuresCall[1].headers).toMatchObject({ apikey: 'anon', authorization: 'Bearer user-jwt' });
  });

  it('never selects first_name or last_name, or the whole row', () => {
    expect(ADMIN_PROFILE_COLUMNS.split(',')).not.toContain('*');
    expect(ADMIN_PROFILE_COLUMNS).not.toMatch(/first_name|last_name/);
  });

  it('encodes the user id into the filter', async () => {
    await getAdminContext(cfg, 't', 'a&b=c');
    const url = String(fetchMock.mock.calls.find(([u]) => String(u).includes('admin_profiles'))![0]);
    expect(url).toContain('user_id=eq.a%26b%3Dc');
  });

  it.each([
    ['no active row', () => json(200, [])],
    ['a non-array body', () => json(200, { nope: true })],
    ['a 401', () => json(401, {})],
    ['a 500', () => json(500, {})],
    ['a row for another user', () => json(200, [{ ...PROFILE, user_id: 'someone-else' }])],
    ['an inactive row', () => json(200, [{ ...PROFILE, is_active: false }])],
    ['a row missing its id', () => json(200, [{ ...PROFILE, id: undefined }])],
    ['a body that is not JSON', () => new Response('<html>', { status: 200 })],
  ])('resolves null (and never throws) on %s for the profile', async (_label, answer) => {
    fetchMock.mockImplementation(async (input: string | URL) =>
      String(input).includes('admin_profiles') ? answer() : json(200, []),
    );
    await expect(getAdminContext(cfg, 't', USER_ID)).resolves.toBeNull();
  });

  it.each([
    ['a 404 (no such function)', () => json(404, {})],
    ['a non-array body', () => json(200, 'newsletters')],
    ['rows without a feature string', () => json(200, [{ feature: 3 }])],
  ])('resolves null on %s for the features', async (_label, answer) => {
    fetchMock.mockImplementation(async (input: string | URL) =>
      String(input).includes('admin_profiles') ? json(200, [PROFILE]) : answer(),
    );
    await expect(getAdminContext(cfg, 't', USER_ID)).resolves.toBeNull();
  });

  it('resolves null and logs (without the token) when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getAdminContext(cfg, 'secret-token', USER_ID)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ err: 'ECONNREFUSED', user_id: USER_ID }), expect.any(String));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-token');
  });

  it('gives up after ADMIN_CONTEXT_TIMEOUT_MS', async () => {
    fetchMock.mockImplementation(
      (_input: string | URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    await expect(getAdminContext(cfg, 't', USER_ID)).resolves.toBeNull();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(ADMIN_CONTEXT_TIMEOUT_MS - 50);
    expect(elapsed).toBeLessThan(ADMIN_CONTEXT_TIMEOUT_MS + 2_000);
  }, ADMIN_CONTEXT_TIMEOUT_MS + 5_000);
});
