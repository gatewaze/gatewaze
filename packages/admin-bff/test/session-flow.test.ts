// Sign-in, /bff/me and sign-out end to end against a fake GoTrue, including
// cookie attributes and the invariant that no token ever reaches the browser.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, type Response } from './helpers/fakes.js';
import { ANON, type Harness, SITE, startHarness } from './helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  h.supabase.addUser('u-admin', 'admin@example.test', true);
  h.supabase.addUser('u-user', 'user@example.test', false);
});
afterAll(() => h.close());
beforeEach(() => {
  h.supabase.requests.length = 0;
});

const setCookies = (r: Response): string[] => {
  const v = r.headers['set-cookie'];
  return Array.isArray(v) ? v : v ? [v] : [];
};
const cookiePair = (header: string) => header.split(';')[0];
const attrs = (header: string) => header.split(';').slice(1).map((a) => a.trim().toLowerCase());

// Runs /bff/login then /bff/callback the way a browser would, and returns
// every response plus the session cookie.
async function signInViaBrowser(userId: string, returnTo = '/events/42') {
  const login = await call(h.base, 'GET', `/bff/login?return_to=${encodeURIComponent(returnTo)}`);
  const flowCookie = cookiePair(setCookies(login)[0]);
  const code = `code-${userId}-${Date.now()}`;
  h.supabase.codes.set(code, userId);
  const callback = await call(h.base, 'GET', `/bff/callback?code=${code}`, { cookie: flowCookie });
  const sessionHeader = setCookies(callback).find((c) => c.startsWith('__Host-gw-admin-session='))!;
  return { login, callback, flowCookie, sessionCookie: cookiePair(sessionHeader), sessionHeader };
}

describe('/bff/login', () => {
  it('redirects to the public GoTrue authorize URL for the configured provider', async () => {
    const r = await call(h.base, 'GET', '/bff/login?return_to=/events');
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.location!);
    expect(loc.origin).toBe('https://supabase.example.test');
    expect(loc.pathname).toBe('/auth/v1/authorize');
    expect(loc.searchParams.get('provider')).toBe('custom:lfid');
    expect(loc.searchParams.get('redirect_to')).toBe(`${SITE}/bff/callback`);
    expect(loc.searchParams.get('code_challenge')).toBeTruthy();
    expect(loc.searchParams.get('code_challenge_method')).toBe('s256');
  });

  it('sets a __Host- flow cookie: Path=/, Secure, HttpOnly, SameSite=Lax, 10 minutes, no Domain', async () => {
    const r = await call(h.base, 'GET', '/bff/login');
    const [flow] = setCookies(r);
    expect(flow.startsWith('__Host-gw-admin-flow=')).toBe(true);
    const a = attrs(flow);
    expect(a).toEqual(expect.arrayContaining(['path=/', 'secure', 'httponly', 'samesite=lax', 'max-age=600']));
    expect(a.some((x) => x.startsWith('domain='))).toBe(false);
  });
});

describe('/bff/callback', () => {
  it('creates a session, sets a __Host- session cookie and returns to the deep link', async () => {
    const { callback, sessionHeader } = await signInViaBrowser('u-admin');
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe('/events/42');
    const a = attrs(sessionHeader);
    expect(a).toEqual(expect.arrayContaining(['path=/', 'secure', 'httponly', 'samesite=lax']));
    expect(a.some((x) => x.startsWith('domain='))).toBe(false);
    // The flow cookie is cleared.
    expect(setCookies(callback).some((c) => c.startsWith('__Host-gw-admin-flow=;'))).toBe(true);
  });

  it('checks admin_profiles with the user own token', async () => {
    await signInViaBrowser('u-admin');
    const check = h.supabase.requests.find((r) => r.url.startsWith('/rest/v1/admin_profiles'))!;
    expect(check.url).toBe('/rest/v1/admin_profiles?select=is_active&user_id=eq.u-admin');
    expect(check.headers.authorization).toMatch(/^Bearer ey/);
    expect(check.headers.apikey).toBe(ANON);
  });

  it('maps an IdP access_denied to the fixed code, never the free text', async () => {
    const r = await call(h.base, 'GET', '/bff/callback?error=access_denied&error_description=%3Cscript%3Ex%3C%2Fscript%3E');
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/login?error=access_denied');
  });

  it('maps a GoTrue server_error to server_error and anything else to callback_invalid', async () => {
    expect((await call(h.base, 'GET', '/bff/callback?error=server_error&error_description=db%20down')).headers.location).toBe('/login?error=server_error');
    expect((await call(h.base, 'GET', '/bff/callback?error=invalid_request&error_description=bad%20state')).headers.location).toBe('/login?error=callback_invalid');
  });

  it('refuses a callback without the flow cookie', async () => {
    const r = await call(h.base, 'GET', '/bff/callback?code=abc');
    expect(r.headers.location).toBe('/login?error=callback_invalid');
  });

  it('refuses a callback without a code', async () => {
    const login = await call(h.base, 'GET', '/bff/login');
    const r = await call(h.base, 'GET', '/bff/callback', { cookie: cookiePair(setCookies(login)[0]) });
    expect(r.headers.location).toBe('/login?error=callback_invalid');
  });

  it('reports a failed code exchange on the sign-in page', async () => {
    const login = await call(h.base, 'GET', '/bff/login');
    const r = await call(h.base, 'GET', '/bff/callback?code=unknown', { cookie: cookiePair(setCookies(login)[0]) });
    expect(r.headers.location).toBe('/login?error=callback_invalid');
    expect(setCookies(r).some((c) => c.startsWith('__Host-gw-admin-session=') && !c.startsWith('__Host-gw-admin-session=;'))).toBe(false);
  });

  it('never redirects off-site, whatever return_to says', async () => {
    const { callback } = await signInViaBrowser('u-admin', '//evil.example/x');
    expect(callback.headers.location).toBe('/');
  });

  it('ends the previous session when signing in again', async () => {
    const first = await signInViaBrowser('u-admin');
    const login = await call(h.base, 'GET', '/bff/login', { cookie: first.sessionCookie });
    const code = 'code-again';
    h.supabase.codes.set(code, 'u-admin');
    const second = await call(h.base, 'GET', `/bff/callback?code=${code}`, {
      cookie: `${first.sessionCookie}; ${cookiePair(setCookies(login)[0])}`,
    });
    expect(second.status).toBe(302);
    const old = await call(h.base, 'GET', '/bff/me', { cookie: first.sessionCookie });
    expect(old.status).toBe(401);
    expect(old.headers['x-gw-session']).toBe('expired');
  });
});

describe('/bff/me', () => {
  it('401s without a cookie, with no expiry marker', async () => {
    const r = await call(h.base, 'GET', '/bff/me');
    expect(r.status).toBe(401);
    expect(r.headers['x-gw-session']).toBeUndefined();
  });

  it('returns the user for an admin', async () => {
    const { sessionCookie } = await signInViaBrowser('u-admin');
    const r = await call(h.base, 'GET', '/bff/me', { cookie: sessionCookie });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).user).toMatchObject({ id: 'u-admin', email: 'admin@example.test' });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('403s a non-admin with their email', async () => {
    const { sessionCookie } = await signInViaBrowser('u-user');
    const r = await call(h.base, 'GET', '/bff/me', { cookie: sessionCookie });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body)).toEqual({ error: 'not_admin', email: 'user@example.test' });
  });

  it('401s with the expiry marker once the session is gone', async () => {
    const s = await h.signIn('u-admin');
    await h.store.delete(s.sid);
    const r = await call(h.base, 'GET', '/bff/me', { cookie: s.cookie });
    expect(r.status).toBe(401);
    expect(r.headers['x-gw-session']).toBe('expired');
  });
});

describe('/bff/logout', () => {
  it('revokes at GoTrue, deletes the session and clears the cookie', async () => {
    const s = await h.signIn('u-admin');
    const r = await call(h.base, 'POST', '/bff/logout', { cookie: s.cookie, origin: SITE });
    expect(r.status).toBe(204);
    expect(h.supabase.logoutCalls.at(-1)).toBe(`Bearer ${s.session.access_token}`);
    expect(await h.store.get(s.sid)).toBeNull();
    expect(setCookies(r).some((c) => /^__Host-gw-admin-session=;.*Max-Age=0/.test(c))).toBe(true);
  });

  it('refuses a cross-site sign-out', async () => {
    const s = await h.signIn('u-admin');
    const r = await call(h.base, 'POST', '/bff/logout', { cookie: s.cookie, origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(await h.store.get(s.sid)).not.toBeNull();
  });
});

describe('no token reaches the browser', () => {
  it('in any response of a full sign-in, use and sign-out', async () => {
    const { login, callback, sessionCookie } = await signInViaBrowser('u-admin');
    const sid = h.app.decodeSecureSession(decodeURIComponent(sessionCookie.split('=').slice(1).join('=')), undefined, 'session')!.get('sid')!;
    const stored = (await h.store.get(sid))!;
    const responses: Response[] = [login, callback];
    responses.push(await call(h.base, 'GET', '/bff/me', { cookie: sessionCookie }));
    responses.push(await call(h.base, 'GET', '/rest/v1/notes', { cookie: sessionCookie, origin: SITE, apikey: ANON }));
    responses.push(await call(h.base, 'GET', '/api/x?access_token=host-session', { cookie: sessionCookie, 'sec-fetch-site': 'same-origin' }));
    responses.push(await call(h.base, 'POST', '/bff/logout', { cookie: sessionCookie, origin: SITE }));
    for (const r of responses) {
      const all = JSON.stringify(r.headers) + r.body;
      expect(all).not.toContain(stored.access_token);
      expect(all).not.toContain(stored.refresh_token);
      expect(all).not.toContain(sid);
    }
    // The cookie itself is encrypted: neither the ID nor a token is readable in it.
    expect(decodeURIComponent(sessionCookie)).not.toContain(sid);
  });
});
