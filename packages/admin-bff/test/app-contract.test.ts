// The browser-facing contract of the Fastify adapter and the session rules
// behind it: the placeholder-without-cookie marker, the sliding cookie, fixed
// sign-in error codes, the admin check failing closed, public reads for a
// signed-in non-admin, and the failure paths of /bff/me, /bff/logout and the
// refresh.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HOST_SESSION } from '../src/core/host-session.js';
import { ADMIN_RECHECK_SECONDS, REFRESH_SKEW_SECONDS, RefreshUnavailableError, refreshSession } from '../src/core/session.js';
import { call, type Response } from './helpers/fakes.js';
import { ANON, type Harness, SITE, startHarness } from './helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  h.supabase.addUser('u-admin', 'admin@example.test', true);
  h.supabase.addUser('u-user', 'user@example.test', false);
  h.supabase.addUser('u-inactive', 'gone@example.test', false);
  h.supabase.users.get('u-inactive')!.inactive = true;
});
afterAll(() => h.close());
beforeEach(() => {
  h.supabase.requests.length = 0;
  h.api.requests.length = 0;
  h.supabase.adminStatus = null;
  h.supabase.userStatus = null;
  h.supabase.refreshRawBody = null;
  h.supabase.refreshMode = 'ok';
  h.supabase.refreshCalls = 0;
});

const sameOrigin = { origin: SITE, apikey: ANON };
const setCookies = (r: Response): string[] => {
  const v = r.headers['set-cookie'];
  return Array.isArray(v) ? v : v ? [v] : [];
};
const now = () => Math.floor(Date.now() / 1000);

describe('placeholder without a session cookie (shim contract)', () => {
  const expectMarker = (r: Response) => {
    expect(r.status).toBe(401);
    expect(r.headers['x-gw-session']).toBe('expired');
  };

  it('401s with the marker for Authorization: Bearer host-session', async () => {
    expectMarker(await call(h.base, 'GET', '/rest/v1/notes', { ...sameOrigin, authorization: `Bearer ${HOST_SESSION}` }));
    expectMarker(await call(h.base, 'POST', '/functions/v1/f', { origin: SITE, authorization: `Bearer ${HOST_SESSION}` }, '{}'));
  });

  it('401s with the marker for ?access_token= and ?token= placeholders', async () => {
    expectMarker(await call(h.base, 'GET', `/api/stream?access_token=${HOST_SESSION}`, { 'sec-fetch-site': 'same-origin' }));
    expectMarker(await call(h.base, 'GET', `/storage/v1/object/authenticated/b/k?token=${HOST_SESSION}`, { 'sec-fetch-site': 'same-origin' }));
  });

  it('never forwards such a request upstream', async () => {
    await call(h.base, 'GET', '/rest/v1/notes', { ...sameOrigin, authorization: `Bearer ${HOST_SESSION}` });
    expect(h.supabase.requests).toHaveLength(0);
  });

  it('still forwards a cookieless request without the placeholder as anon', async () => {
    const r = await call(h.base, 'GET', '/rest/v1/platform_settings', { apikey: ANON });
    expect(r.status).toBe(200);
    expect(h.supabase.requests.at(-1)!.headers.authorization).toBe(`Bearer ${ANON}`);
  });

  it('forwards a cookieless /api GET with a non-placeholder bearer with no Authorization at all', async () => {
    const r = await call(h.base, 'GET', '/api/x', { 'sec-fetch-site': 'same-origin', authorization: 'Bearer some-real-looking-token' });
    expect(r.status).toBe(200);
    expect(h.api.requests.at(-1)!.headers.authorization).toBeUndefined();
  });
});

describe('session cookie', () => {
  it('is set with Max-Age equal to the session lifetime', async () => {
    const login = await call(h.base, 'GET', '/bff/login');
    h.supabase.codes.set('c-maxage', 'u-admin');
    const cb = await call(h.base, 'GET', '/bff/callback?code=c-maxage', { cookie: setCookies(login)[0].split(';')[0] });
    const session = setCookies(cb).find((c) => c.startsWith('__Host-gw-admin-session=') && !c.startsWith('__Host-gw-admin-session=;'))!;
    expect(session).toMatch(/Max-Age=3600(;|$)/);
  });

  it('treats a cookie past its encoded lifetime as expired', async () => {
    const s = await h.signIn('u-admin');
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: h.cookieFor(s.sid, now() - 3601), ...sameOrigin });
    expect(r.status).toBe(401);
    expect(r.headers['x-gw-session']).toBe('expired');
  });

  it('is re-sent once less than half its lifetime is left', async () => {
    const s = await h.signIn('u-admin');
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: h.cookieFor(s.sid, now() - 1801), ...sameOrigin });
    expect(r.status).toBe(200);
    const sent = setCookies(r).find((c) => c.startsWith('__Host-gw-admin-session='));
    expect(sent).toMatch(/Max-Age=3600/);
    // The new cookie works and carries the same session.
    const again = await call(h.base, 'GET', '/rest/v1/notes', { cookie: sent!.split(';')[0], ...sameOrigin });
    expect(again.status).toBe(200);
  });

  it('is not re-sent while more than half its lifetime is left', async () => {
    const s = await h.signIn('u-admin');
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: h.cookieFor(s.sid, now() - 1700), ...sameOrigin });
    expect(r.status).toBe(200);
    expect(setCookies(r)).toEqual([]);
  });
});

describe('sign-in failures', () => {
  it('redirects to /login?error=login_failed when the sign-in cannot start', async () => {
    const broken = await startHarness({ cfg: { supabaseUrl: 'ftp://not-http' } });
    try {
      const r = await call(broken.base, 'GET', '/bff/login');
      expect(r.status).toBe(302);
      expect(r.headers.location).toBe('/login?error=login_failed');
    } finally {
      await broken.close();
    }
  });
});

describe('admin check', () => {
  it('403s a user whose admin_profiles row is inactive, on /bff/me and the proxy', async () => {
    const s = await h.signIn('u-inactive');
    const me = await call(h.base, 'GET', '/bff/me', { cookie: s.cookie });
    expect(me.status).toBe(403);
    expect(JSON.parse(me.body).error).toBe('not_admin');
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin });
    expect(r.status).toBe(403);
  });

  it('fails closed at sign-in when admin_profiles errors, and keeps the session for a retry', async () => {
    h.supabase.adminStatus = 500;
    const login = await call(h.base, 'GET', '/bff/login');
    h.supabase.codes.set('c-admin-500', 'u-admin');
    const cb = await call(h.base, 'GET', '/bff/callback?code=c-admin-500', { cookie: setCookies(login)[0].split(';')[0] });
    expect(cb.headers.location).toBe('/');
    const cookie = setCookies(cb).find((c) => c.startsWith('__Host-gw-admin-session=') && !c.startsWith('__Host-gw-admin-session=;'))!.split(';')[0];
    const me = await call(h.base, 'GET', '/bff/me', { cookie });
    expect(me.status).toBe(503);
    expect(JSON.parse(me.body)).toEqual({ error: 'admin_check_pending' });
  });

  for (const status of [500, 404]) {
    it(`fails closed on a ${status} during refresh, keeps the tokens, and recovers`, async () => {
      const s = await h.signIn('u-admin', { ttlSeconds: 30 });
      h.supabase.adminStatus = status;
      const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin });
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toEqual({ error: 'admin_check_pending' });
      const retryAfter = Number(r.headers['retry-after']);
      expect(retryAfter).toBeGreaterThanOrEqual(ADMIN_RECHECK_SECONDS - 2);
      expect(retryAfter).toBeLessThanOrEqual(ADMIN_RECHECK_SECONDS);
      const stored = (await h.store.get(s.sid))!;
      expect(stored).not.toBeNull();
      expect(stored.is_admin).toBe(false);
      expect(stored.admin_check).toBe('pending');
      expect(stored.refresh_token).not.toBe(s.session.refresh_token);
      expect(Math.abs(stored.expires_at - (now() + REFRESH_SKEW_SECONDS + ADMIN_RECHECK_SECONDS))).toBeLessThanOrEqual(2);

      // ADMIN_RECHECK_SECONDS later (simulated by moving the expiry), with
      // admin_profiles back, the next request refreshes and is an admin again.
      h.supabase.adminStatus = null;
      await h.putStored(s.sid, { ...stored, expires_at: now() + 10 });
      const calls = h.supabase.refreshCalls;
      const again = await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin });
      expect(again.status).toBe(200);
      expect(h.supabase.refreshCalls).toBe(calls + 1);
      expect((await h.store.get(s.sid))!.is_admin).toBe(true);
      expect((await h.store.get(s.sid))!.admin_check).toBe('ok');
    });
  }
});

describe('public reads for a signed-in non-admin', () => {
  it('forwards the sign-in page reads as anon', async () => {
    const s = await h.signIn('u-user');
    for (const [method, path] of [
      ['GET', '/storage/v1/object/public/brand/logo.png'],
      ['GET', '/rest/v1/platform_settings?select=*'],
      ['POST', '/rest/v1/rpc/public_enabled_modules'],
      ['POST', '/rest/v1/rpc/lfid_sign_in_mode'],
    ]) {
      const r = await call(h.base, method, path, { cookie: s.cookie, ...sameOrigin }, method === 'POST' ? '{}' : undefined);
      expect(r.status, path).toBe(200);
      expect(h.supabase.requests.at(-1)!.headers.authorization, path).toBe(`Bearer ${ANON}`);
    }
  });

  it('still 403s everything else, including writes to those paths', async () => {
    const s = await h.signIn('u-user');
    for (const [method, path] of [
      ['GET', '/rest/v1/platform_settings_secret'],
      ['PATCH', '/rest/v1/platform_settings'],
      ['GET', '/storage/v1/object/authenticated/brand/logo.png'],
      ['POST', '/rest/v1/rpc/other'],
      ['GET', '/api/x'],
    ]) {
      const r = await call(h.base, method, path, { cookie: s.cookie, ...sameOrigin }, method === 'GET' ? undefined : '{}');
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });
});

describe('/bff/me and /bff/logout failure paths', () => {
  for (const status of [500, 408, 429]) {
    it(`/bff/me answers 503 session_unavailable and keeps the session when GoTrue /user answers ${status}`, async () => {
      const s = await h.signIn('u-admin');
      h.supabase.userStatus = status;
      const r = await call(h.base, 'GET', '/bff/me', { cookie: s.cookie });
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toEqual({ error: 'session_unavailable' });
      expect(await h.store.get(s.sid)).not.toBeNull();
    });
  }

  for (const status of [401, 403, 404]) {
    it(`/bff/me ends the session when GoTrue /user answers ${status}`, async () => {
      const s = await h.signIn('u-admin');
      h.supabase.userStatus = status;
      const r = await call(h.base, 'GET', '/bff/me', { cookie: s.cookie });
      expect(r.status).toBe(401);
      expect(r.headers['x-gw-session']).toBe('expired');
      expect(await h.store.get(s.sid)).toBeNull();
    });
  }

  it('logout without an Origin header is accepted', async () => {
    const s = await h.signIn('u-admin');
    const r = await call(h.base, 'POST', '/bff/logout', { cookie: s.cookie });
    expect(r.status).toBe(204);
    expect(await h.store.get(s.sid)).toBeNull();
  });

  it('logout still ends the session when GoTrue is down', async () => {
    const down = await startHarness();
    down.supabase.addUser('u-admin', 'a@example.test', true);
    const s = await down.signIn('u-admin');
    await down.supabase.stop();
    const r = await call(down.base, 'POST', '/bff/logout', { cookie: s.cookie, origin: SITE });
    expect(r.status).toBe(204);
    expect(await down.store.get(s.sid)).toBeNull();
    await down.app.close();
    await down.api.stop();
  });
});

describe('refresh failures', () => {
  it('answers 503 and keeps the session when the token endpoint returns 200 with a non-JSON body', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.refreshRawBody = '<html>gateway</html>';
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin });
    expect(r.status).toBe(503);
    expect(await h.store.get(s.sid)).not.toBeNull();
  });

  it('answers 503 and keeps the session when the token endpoint returns 200 {}', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.refreshRawBody = '{}';
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin });
    expect(r.status).toBe(503);
    expect(await h.store.get(s.sid)).not.toBeNull();
  });

  it('throws RefreshUnavailableError when GoTrue refuses the connection', async () => {
    const server = http.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    await new Promise((r) => server.close(r));
    const cfg = { ...h.cfg, supabaseUrl: `http://127.0.0.1:${port}` };
    await expect(
      refreshSession(cfg, { access_token: 'a', refresh_token: 'r', expires_at: now(), user_id: 'u', is_admin: true }),
    ).rejects.toBeInstanceOf(RefreshUnavailableError);
  });
});

describe('upgrade routing', () => {
  it('404s a WebSocket upgrade outside /realtime/v1', async () => {
    const r = await new Promise<number>((resolve) => {
      const u = new URL(h.base);
      const req = http.request({
        host: u.hostname,
        port: u.port,
        path: '/rest/v1/x',
        headers: { connection: 'Upgrade', upgrade: 'websocket', origin: SITE, 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
      });
      req.on('response', (res) => resolve(res.statusCode ?? 0));
      req.on('upgrade', () => resolve(101));
      req.end();
    });
    expect(r).toBe(404);
  });
});
