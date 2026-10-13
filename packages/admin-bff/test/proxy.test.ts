// The proxy end to end against fake upstreams: placeholder rewriting,
// anonymous pass-through, the expiry marker, the admin gate, the CSRF matrix,
// query token stripping and routing. Ported from poc-stack.md's admin smoke
// tests, plus the cases the approved spec adds.
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HOST_SESSION, proxyRequest } from '@gatewaze/host-session';
import { call } from './helpers/fakes.js';
import { ANON, type Harness, SITE, startHarness } from './helpers/harness.js';

let h: Harness;
let admin: { cookie: string; sid: string; session: { access_token: string; refresh_token: string } };
let nonAdmin: { cookie: string };

beforeAll(async () => {
  h = await startHarness();
  h.supabase.addUser('u-admin', 'admin@example.test', true);
  h.supabase.addUser('u-user', 'user@example.test', false);
});
afterAll(() => h.close());
beforeEach(async () => {
  h.supabase.requests.length = 0;
  h.api.requests.length = 0;
  h.supabase.restStatus = 200;
  admin = await h.signIn('u-admin');
  nonAdmin = await h.signIn('u-user');
});

const lastUpstream = () => h.supabase.requests.at(-1)!;
const sameOrigin = { origin: SITE, apikey: ANON };

describe('placeholder rewrite', () => {
  it('replaces the placeholder with the session token and sets apikey', async () => {
    const r = await call(h.base, 'POST', '/rest/v1/notes', {
      cookie: admin.cookie,
      ...sameOrigin,
      authorization: `Bearer ${HOST_SESSION}`,
      'content-type': 'application/json',
    }, '{"body":"via bff"}');
    expect(r.status).toBe(200);
    const up = lastUpstream();
    expect(up.headers.authorization).toBe(`Bearer ${admin.session.access_token}`);
    expect(up.headers.apikey).toBe(ANON);
    expect(up.body).toBe('{"body":"via bff"}');
    // Neither the browser's cookie nor its Origin reach the upstream.
    expect(up.headers.cookie).toBeUndefined();
    expect(up.headers.origin).toBeUndefined();
  });

  it('replaces any browser-sent bearer, not only the placeholder', async () => {
    await call(h.base, 'GET', '/rest/v1/notes', { cookie: admin.cookie, ...sameOrigin, authorization: 'Bearer someone-elses-token' });
    expect(lastUpstream().headers.authorization).toBe(`Bearer ${admin.session.access_token}`);
  });

  it('routes /storage/v1 and /functions/v1 to Supabase with the token', async () => {
    for (const p of ['/storage/v1/object/authenticated/media/a/b/c/very-long-file-name-0123456789-0123456789-0123456789-0123456789-0123456789.png', '/functions/v1/send-test']) {
      const r = await call(h.base, 'GET', p, { cookie: admin.cookie, ...sameOrigin });
      expect(r.status).toBe(200);
      expect(lastUpstream().url).toBe(p);
      expect(lastUpstream().headers.authorization).toBe(`Bearer ${admin.session.access_token}`);
    }
  });

  it('streams a request body upstream unchanged', async () => {
    const payload = 'x'.repeat(256 * 1024);
    const r = await call(h.base, 'POST', '/storage/v1/object/media/big.bin', {
      cookie: admin.cookie,
      ...sameOrigin,
      'content-type': 'application/octet-stream',
    }, payload);
    expect(r.status).toBe(200);
    expect(lastUpstream().body).toBe(payload);
  });

  it('drops upstream Set-Cookie and keeps other headers', async () => {
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: admin.cookie, ...sameOrigin });
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(r.headers['x-upstream']).toBe('supabase');
  });
});

describe('/api routing', () => {
  it('keeps the path, attaches the token, sends no apikey and appends X-Forwarded-For', async () => {
    const r = await call(h.base, 'POST', '/api/modules/reconcile?x=1', {
      cookie: admin.cookie,
      ...sameOrigin,
      'x-forwarded-for': '203.0.113.9',
      'content-type': 'application/json',
    }, '{}');
    expect(r.status).toBe(200);
    const up = h.api.requests.at(-1)!;
    expect(up.url).toBe('/api/modules/reconcile?x=1');
    expect(up.headers.authorization).toBe(`Bearer ${admin.session.access_token}`);
    expect(up.headers.apikey).toBeUndefined();
    expect(up.headers['x-forwarded-for']).toBe('203.0.113.9, 127.0.0.1');
  });

  it('forwards a cookieless call with no Authorization at all', async () => {
    await call(h.base, 'GET', '/api/health', { 'sec-fetch-site': 'same-origin' });
    expect(h.api.requests.at(-1)!.headers.authorization).toBeUndefined();
  });
});

describe('cookieless pass-through (decision 2)', () => {
  it('forwards a pre-sign-in read as the anon role', async () => {
    const r = await call(h.base, 'GET', '/rest/v1/platform_settings?select=*', { apikey: ANON });
    expect(r.status).toBe(200);
    expect(lastUpstream().headers.authorization).toBe(`Bearer ${ANON}`);
  });

  it('forwards a pre-sign-in RPC POST as the anon role', async () => {
    const r = await call(h.base, 'POST', '/rest/v1/rpc/public_enabled_modules', { origin: SITE, apikey: ANON }, '{}');
    expect(r.status).toBe(200);
    expect(lastUpstream().headers.authorization).toBe(`Bearer ${ANON}`);
  });

  it('forwards a public storage object without a session', async () => {
    const r = await call(h.base, 'GET', '/storage/v1/object/public/media/logo.png', {});
    expect(r.status).toBe(200);
    expect(lastUpstream().headers.authorization).toBe(`Bearer ${ANON}`);
  });

  it('still rejects a cookieless unsafe request that fails CSRF', async () => {
    const r = await call(h.base, 'POST', '/rest/v1/rpc/x', { origin: 'https://evil.example', apikey: ANON }, '{}');
    expect(r.status).toBe(403);
    expect(h.supabase.requests).toHaveLength(0);
  });
});

describe('expiry marker and admin gate', () => {
  it('401s with x-gw-session: expired when the cookie session is gone, and clears the cookie', async () => {
    await h.store.delete(admin.sid);
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: admin.cookie, ...sameOrigin });
    expect(r.status).toBe(401);
    expect(r.headers['x-gw-session']).toBe('expired');
    expect(String(r.headers['set-cookie'])).toMatch(/__Host-gw-admin-session=;.*Max-Age=0/);
    expect(h.supabase.requests).toHaveLength(0);
  });

  it('treats an undecryptable cookie as expired', async () => {
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: `${h.cookie}=garbage%3Bvalue`, ...sameOrigin });
    expect(r.status).toBe(401);
    expect(r.headers['x-gw-session']).toBe('expired');
  });

  it('passes an upstream 401 through without the marker', async () => {
    h.supabase.restStatus = 401;
    const r = await call(h.base, 'GET', '/functions/v1/strict', { cookie: admin.cookie, ...sameOrigin });
    expect(r.status).toBe(401);
    expect(r.headers['x-gw-session']).toBeUndefined();
  });

  it('never relays an x-gw-session header set by an upstream', async () => {
    h.supabase.restStatus = 401;
    const r = await call(h.base, 'GET', '/functions/v1/forge-marker', { cookie: admin.cookie, ...sameOrigin });
    expect(r.status).toBe(401);
    expect(r.headers['x-gw-session']).toBeUndefined();
  });

  it('403s a signed-in non-admin on every proxied prefix', async () => {
    for (const p of ['/rest/v1/notes', '/storage/v1/object/x', '/functions/v1/f', '/api/x']) {
      const r = await call(h.base, 'GET', p, { cookie: nonAdmin.cookie, ...sameOrigin });
      expect(r.status, p).toBe(403);
      expect(JSON.parse(r.body)).toEqual({ error: 'not_admin' });
    }
    expect(h.supabase.requests).toHaveLength(0);
    expect(h.api.requests).toHaveLength(0);
  });
});

describe('CSRF matrix through the proxy', () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    it(`${method} without apikey is 403 and never reaches the upstream`, async () => {
      const r = await call(h.base, method, '/rest/v1/notes', { cookie: admin.cookie, origin: SITE, 'sec-fetch-site': 'same-origin' }, '{}');
      expect(r.status).toBe(403);
      expect(h.supabase.requests).toHaveLength(0);
    });
    it(`${method} from another origin is 403`, async () => {
      const r = await call(h.base, method, '/rest/v1/notes', { cookie: admin.cookie, origin: 'https://evil.example', apikey: ANON }, '{}');
      expect(r.status).toBe(403);
      expect(h.supabase.requests).toHaveLength(0);
    });
  }

  it('a same-origin POST with Authorization but no apikey gets the session (amendment)', async () => {
    const r = await call(h.base, 'POST', '/functions/v1/send', {
      cookie: admin.cookie,
      origin: SITE,
      authorization: `Bearer ${HOST_SESSION}`,
      'content-type': 'application/json',
    }, '{}');
    expect(r.status).toBe(200);
    expect(lastUpstream().headers.authorization).toBe(`Bearer ${admin.session.access_token}`);
  });

  it('a cross-site POST with no custom header (a form post) is 403', async () => {
    const r = await call(h.base, 'POST', '/rest/v1/rpc/delete_everything', {
      cookie: admin.cookie,
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'content-type': 'application/x-www-form-urlencoded',
    }, 'a=1');
    expect(r.status).toBe(403);
    expect(h.supabase.requests).toHaveLength(0);
  });

  it('a cross-origin CORS preflight gets no Access-Control-Allow-* headers', async () => {
    for (const p of ['/rest/v1/notes', '/functions/v1/send', '/api/x', '/storage/v1/object/b/k', '/bff/logout']) {
      const r = await call(h.base, 'OPTIONS', p, {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,apikey,content-type',
      });
      expect(r.status, p).toBeGreaterThanOrEqual(400);
      expect(Object.keys(r.headers).filter((k) => k.startsWith('access-control-')), p).toEqual([]);
    }
    expect(h.supabase.requests).toHaveLength(0);
    expect(h.api.requests).toHaveLength(0);
  });

  it('a same-origin GET without apikey (EventSource, <img>) gets the session', async () => {
    const r = await call(h.base, 'GET', '/api/ai/stream', { cookie: admin.cookie, 'sec-fetch-site': 'same-origin' });
    expect(r.status).toBe(200);
    expect(h.api.requests.at(-1)!.headers.authorization).toBe(`Bearer ${admin.session.access_token}`);
  });

  for (const site of ['cross-site', 'same-site', undefined]) {
    it(`a GET with Sec-Fetch-Site ${site ?? '(absent)'} and no apikey is forwarded as anon, not 403`, async () => {
      const headers: Record<string, string> = { cookie: admin.cookie };
      if (site) headers['sec-fetch-site'] = site;
      const r = await call(h.base, 'GET', '/rest/v1/notes', headers);
      expect(r.status).toBe(200);
      expect(lastUpstream().headers.authorization).toBe(`Bearer ${ANON}`);
      expect(JSON.stringify(lastUpstream().headers)).not.toContain(admin.session.access_token);
    });
  }

  it('a cross-origin GET carrying apikey is still anon', async () => {
    await call(h.base, 'GET', '/rest/v1/notes', { cookie: admin.cookie, origin: 'https://evil.example', apikey: ANON });
    expect(lastUpstream().headers.authorization).toBe(`Bearer ${ANON}`);
  });

  it('a cross-site GET with a dead session cookie is anon, not 401', async () => {
    await h.store.delete(admin.sid);
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: admin.cookie, 'sec-fetch-site': 'cross-site' });
    expect(r.status).toBe(200);
  });
});

describe('query token stripping', () => {
  it('never sends access_token or the placeholder token upstream, and keeps the rest verbatim', async () => {
    await call(h.base, 'GET', `/api/ai/stream?access_token=${HOST_SESSION}&thread=1`, { cookie: admin.cookie, 'sec-fetch-site': 'same-origin' });
    const up = h.api.requests.at(-1)!;
    expect(up.url).toBe('/api/ai/stream?thread=1');
    expect(up.headers.authorization).toBe(`Bearer ${admin.session.access_token}`);

    await call(h.base, 'GET', `/rest/v1/t?select=*,a(b)&token=${HOST_SESSION}`, { cookie: admin.cookie, ...sameOrigin });
    expect(lastUpstream().url).toBe('/rest/v1/t?select=*,a(b)');
  });

  it('keeps a signed storage token', async () => {
    await call(h.base, 'GET', '/storage/v1/object/sign/media/a.png?token=signed.value', {});
    expect(lastUpstream().url).toBe('/storage/v1/object/sign/media/a.png?token=signed.value');
  });

  it('never puts the real token in an upstream URL', async () => {
    await call(h.base, 'GET', '/rest/v1/t?access_token=x', { cookie: admin.cookie, ...sameOrigin });
    expect(lastUpstream().url).not.toContain(admin.session.access_token);
  });
});

describe('path containment', () => {
  for (const p of ['/rest/v1/../../auth/v1/admin/users', '/rest/v1/%2e%2e/%2e%2e/auth/v1/user', '/api/%2e%2e/rest/v1/notes', '/api%2e%2e/rest/v1/notes', '/apix/y']) {
    it(`refuses ${p} without contacting an upstream`, async () => {
      const r = await call(h.base, 'GET', p, { cookie: admin.cookie, ...sameOrigin });
      // 400 when a proxied route matched and the normalised path left its
      // prefix; 404 when no proxied route matched at all.
      expect([400, 404]).toContain(r.status);
      expect(h.supabase.requests).toHaveLength(0);
      expect(h.api.requests).toHaveLength(0);
    });
  }

  it('does not proxy GoTrue (/auth/v1)', async () => {
    const r = await call(h.base, 'GET', '/auth/v1/user', { cookie: admin.cookie, ...sameOrigin });
    expect(r.status).toBe(404);
    expect(h.supabase.requests).toHaveLength(0);
  });
});

describe('upstream failure', () => {
  it('answers 502 when the upstream is unreachable', async () => {
    const down = await startHarness();
    await down.api.stop();
    const r = await call(down.base, 'GET', '/api/x', { 'sec-fetch-site': 'same-origin' });
    expect(r.status).toBe(502);
    await down.app.close();
    await down.supabase.stop();
  });
});

describe('upstream timeouts, aborts and transport', () => {
  it('answers 502 when the upstream goes idle past the timeout', async () => {
    const slow = await startHarness({ timeoutMs: 200 });
    slow.supabase.restDelayMs = 2000;
    try {
      const r = await call(slow.base, 'GET', '/rest/v1/notes', { apikey: ANON });
      expect(r.status).toBe(502);
    } finally {
      slow.supabase.restDelayMs = 0;
      await slow.close();
    }
  });

  it('aborts the upstream request when the browser goes away while waiting', async () => {
    h.supabase.restDelayMs = 1500;
    h.supabase.aborted.length = 0;
    try {
      const u = new URL(h.base);
      const req = http.request({ host: u.hostname, port: u.port, path: '/rest/v1/slow', headers: { apikey: ANON } });
      req.on('error', () => undefined);
      req.end();
      await new Promise((r) => setTimeout(r, 200));
      req.destroy();
      const end = Date.now() + 1000;
      while (!h.supabase.aborted.length && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
      expect(h.supabase.aborted).toEqual(['/rest/v1/slow']);
    } finally {
      h.supabase.restDelayMs = 0;
    }
  });

  it('speaks TLS to an https upstream', async () => {
    // A plain TCP server records the first byte it receives: 0x16 is a TLS
    // handshake record.
    let first: number | undefined;
    const tcp = net.createServer((sock) => sock.once('data', (d) => {
      first = d[0];
      sock.destroy();
    }));
    await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));
    const port = (tcp.address() as AddressInfo).port;
    const srv = http.createServer(async (req, res) => {
      await proxyRequest(req, { url: `https://127.0.0.1:${port}`, prefix: '/rest/v1', supabase: true }, '/rest/v1/x', {
        creds: { bearer: null, apikey: null },
        xff: '',
        timeoutMs: 2000,
      }).catch(() => undefined);
      res.end();
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    await call(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`, 'GET', '/');
    srv.close();
    tcp.close();
    expect(first).toBe(0x16);
  });
});

describe('healthz', () => {
  it('answers 200 with no-store', async () => {
    const r = await call(h.base, 'GET', '/bff/healthz');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});
