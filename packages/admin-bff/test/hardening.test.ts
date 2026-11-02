// Hardening from the round-1 security review: Bearer-only proof, cache
// privacy, header and redirect hygiene, refresh status handling, logout
// ordering, query validation and stored-session shape.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_CHECK_TIMEOUT_MS, type GwSession, LOCK_MS, REFRESH_TIMEOUT_MS, SessionStore } from '@gatewaze/host-session';
import { MemoryKeyValue, call, type Response } from './helpers/fakes.js';
import { ANON, type Harness, SITE, startHarness } from './helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  h.supabase.addUser('u-admin', 'admin@example.test', true);
});
afterAll(() => h.close());
beforeEach(() => {
  h.supabase.requests.length = 0;
  h.supabase.refreshMode = 'ok';
  h.supabase.refreshCalls = 0;
});

const sameOrigin = { origin: SITE, apikey: ANON };
const last = () => h.supabase.requests.at(-1)!;
const setCookies = (r: Response): string[] => {
  const v = r.headers['set-cookie'];
  return Array.isArray(v) ? v : v ? [v] : [];
};

describe('only a Bearer Authorization header is CSRF proof', () => {
  it('a GET with Basic credentials and no Origin gets no session', async () => {
    const s = await h.signIn('u-admin');
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, authorization: 'Basic dXNlcjpwYXNz' });
    expect(r.status).toBe(200);
    expect(last().headers.authorization).toBe(`Bearer ${ANON}`);
  });

  it('a POST with Basic credentials and no Origin is rejected', async () => {
    const s = await h.signIn('u-admin');
    for (const scheme of ['Basic dXNlcjpwYXNz', 'Negotiate abc', 'Digest username="u"']) {
      const r = await call(h.base, 'POST', '/rest/v1/notes', { cookie: s.cookie, authorization: scheme }, '{}');
      expect(r.status, scheme).toBe(403);
    }
    expect(h.supabase.requests).toHaveLength(0);
  });

  it('a same-origin POST with a Bearer header gets the session', async () => {
    const s = await h.signIn('u-admin');
    const r = await call(h.base, 'POST', '/rest/v1/notes', { cookie: s.cookie, origin: SITE, authorization: 'Bearer host-session' }, '{}');
    expect(r.status).toBe(200);
    expect(last().headers.authorization).toBe(`Bearer ${s.session.access_token}`);
  });
});

describe('cache privacy', () => {
  it('marks a response made with the session private and varying on Cookie', async () => {
    const s = await h.signIn('u-admin');
    const r = await call(h.base, 'GET', '/storage/v1/object/authenticated/b/cacheable', { cookie: s.cookie, ...sameOrigin });
    expect(r.headers['cache-control']).toBe('private, max-age=60');
    expect(r.headers.vary).toBe('Accept-Encoding, Cookie');
  });

  it('leaves an anonymous response as the upstream sent it', async () => {
    const r = await call(h.base, 'GET', '/storage/v1/object/public/b/cacheable', {});
    expect(r.headers['cache-control']).toBe('public, max-age=60, s-maxage=600');
    expect(r.headers.vary).toBe('Accept-Encoding');
  });
});

describe('header and redirect hygiene', () => {
  it('drops browser X-Forwarded-Host/-Proto/Forwarded and headers named in Connection', async () => {
    const s = await h.signIn('u-admin');
    await call(h.base, 'GET', '/rest/v1/notes', {
      cookie: s.cookie,
      ...sameOrigin,
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'http',
      forwarded: 'host=evil.example',
      connection: 'keep-alive, x-secret-hop',
      'x-secret-hop': 'leak',
      'x-kept': 'yes',
    });
    const hd = last().headers;
    expect(hd['x-forwarded-host']).toBeUndefined();
    expect(hd['x-forwarded-proto']).toBeUndefined();
    expect(hd.forwarded).toBeUndefined();
    expect(hd['x-secret-hop']).toBeUndefined();
    expect(hd['x-kept']).toBe('yes');
  });

  it('makes an upstream redirect to its internal origin relative', async () => {
    const internal = await call(h.base, 'GET', '/storage/v1/object/x/redirect-internal', {});
    expect(internal.headers.location).toBe('/storage/v1/object/public/b/k.png?v=1');
  });

  const redirectTo = (to: string) => {
    h.supabase.redirectLocation = to;
    return call(h.base, 'GET', '/functions/v1/f/redirect-to', {});
  };

  it('passes an https redirect to another host through (module OAuth)', async () => {
    const google = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=y';
    expect((await redirectTo(google)).headers.location).toBe(google);
    expect((await call(h.base, 'GET', '/storage/v1/object/x/redirect-external', {})).headers.location).toBe('https://cdn.example.test/k.png');
  });

  it('makes a redirect to the admin origin relative', async () => {
    expect((await redirectTo(`${SITE}/settings/integrations?slack=ok`)).headers.location).toBe('/settings/integrations?slack=ok');
  });

  it('drops javascript:, data:, plain http to another host, and // paths on the internal origin', async () => {
    for (const to of ['javascript:alert(1)', 'data:text/html,x', 'http://evil.example/x', `${h.supabase.url}//evil.example/x`, `${h.supabase.url}/a/..//evil.example`]) {
      const r = await redirectTo(to);
      expect(r.status, to).toBe(302);
      expect(r.headers.location, to).toBeUndefined();
    }
  });
});

describe('refresh status handling', () => {
  for (const status of [408, 429]) {
    it(`treats a ${status} from the token endpoint as unavailable: 503, session kept`, async () => {
      const s = await h.signIn('u-admin', { ttlSeconds: 30 });
      h.supabase.refreshMode = status;
      const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin });
      expect(r.status).toBe(503);
      expect(await h.store.get(s.sid)).not.toBeNull();
    });
  }

  it('holds the refresh lock longer than the refresh work it guards', () => {
    expect(LOCK_MS).toBeGreaterThan(REFRESH_TIMEOUT_MS + ADMIN_CHECK_TIMEOUT_MS);
  });
});

describe('logout', () => {
  it('refreshes an expired access token first, so GoTrue revokes with a valid one', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    const r = await call(h.base, 'POST', '/bff/logout', { cookie: s.cookie, origin: SITE });
    expect(r.status).toBe(204);
    expect(h.supabase.refreshCalls).toBe(1);
    const revoked = h.supabase.logoutCalls.at(-1)!;
    expect(revoked).not.toBe(`Bearer ${s.session.access_token}`);
    expect(h.supabase.accessTokens.has(revoked.replace('Bearer ', ''))).toBe(true);
    expect(await h.store.get(s.sid)).toBeNull();
  });

  it('wins over a refresh that is in flight: the session stays deleted', async () => {
    const cfg = { supabaseUrl: 'http://x', publicSupabaseUrl: 'http://x', anonKey: 'a', siteUrl: 'https://s', provider: 'p' };
    const kv = new MemoryKeyValue();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store = new SessionStore(cfg, kv, {
      insecureNoEncryptionForTests: true,
      refresh: async (_c, s) => {
        await gate;
        return { ...s, access_token: 'a2', refresh_token: 'r2', expires_at: Math.floor(Date.now() / 1000) + 3600 };
      },
    });
    const old: GwSession = { access_token: 'a1', refresh_token: 'r1', expires_at: Math.floor(Date.now() / 1000) + 10, user_id: 'u', is_admin: true };
    const sid = await store.create(old);
    const inFlight = store.fresh(sid);
    await new Promise((r) => setTimeout(r, 20));
    await store.delete(sid);
    release();
    expect(await inFlight).toBeNull();
    expect(await store.get(sid)).toBeNull();
  });
});

describe('query validation', () => {
  it('400s a repeated callback parameter', async () => {
    const r = await call(h.base, 'GET', '/bff/callback?code=a&code=b');
    expect(r.status).toBe(400);
  });
  it('400s a repeated return_to', async () => {
    const r = await call(h.base, 'GET', '/bff/login?return_to=/a&return_to=/b');
    expect(r.status).toBe(400);
  });
  it('encodes a non-ASCII return_to instead of failing', async () => {
    const login = await call(h.base, 'GET', `/bff/login?return_to=${encodeURIComponent('/événements/1')}`);
    expect(login.status).toBe(302);
    h.supabase.codes.set('c-utf8', 'u-admin');
    const cb = await call(h.base, 'GET', '/bff/callback?code=c-utf8', { cookie: setCookies(login)[0].split(';')[0] });
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/%C3%A9v%C3%A9nements/1');
  });
});

describe('stored session shape', () => {
  it('treats a stored value with the wrong shape as an ended session', async () => {
    const s = await h.signIn('u-admin');
    await h.putStored(s.sid, { access_token: 1 });
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin });
    expect(r.status).toBe(401);
    expect(r.headers['x-gw-session']).toBe('expired');
  });
});
