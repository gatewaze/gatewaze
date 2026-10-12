// Final review pass: Location filtering, socket slot accounting, sign-out
// during an upgrade, trust proxy and rate-limit defaults, admin check and
// GoTrue /user classification, refresh details, encryption details, logout
// and callback failure paths, bridge limits, header stripping and config.
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { DEFAULT_SIGN_IN_RATE_LIMIT } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { deriveKeys, open, seal } from '../src/core/keys.js';
import { rewriteLocation, upstreamHeaders } from '../src/core/proxy.js';
import { bridgeRealtime } from '../src/core/realtime.js';
import { type GwSession, retryAfterSeconds } from '../src/core/session.js';
import { SessionStore } from '../src/core/store.js';
import { MemoryKeyValue, call } from './helpers/fakes.js';
import { ANON, type Harness, KEY, SITE, startHarness } from './helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  h.supabase.addUser('u-admin', 'admin@example.test', true);
});
afterAll(() => h.close());
beforeEach(() => {
  h.supabase.requests.length = 0;
  Object.assign(h.supabase, {
    refreshMode: 'ok',
    refreshDelayMs: 0,
    refreshRawBody: null,
    adminStatus: null,
    adminRawBody: null,
    adminDrop: false,
    userStatus: null,
    userRawBody: null,
    userDrop: false,
  });
});

const now = () => Math.floor(Date.now() / 1000);
const sameOrigin = { origin: SITE, apikey: ANON };
const UP = 'http://supabase-kong:8000';

describe('Location filtering', () => {
  for (const loc of ['//evil.example/x', '/\\evil.test', '\\\\evil.test', '/\t/evil.test', 'javascript:alert(1)', 'ftp://x', 'https://evil.example/x', '/a\nb']) {
    it(`drops ${JSON.stringify(loc)}`, () => {
      expect(rewriteLocation(loc, UP)).toBeNull();
    });
  }
  it('keeps a same-origin relative path and relativises a same-origin absolute URL', () => {
    expect(rewriteLocation('/storage/v1/object/x?y=1', UP)).toBe('/storage/v1/object/x?y=1');
    expect(rewriteLocation('x/y', UP)).toBe('x/y');
    expect(rewriteLocation(`${UP}/rest/v1/t?a=1#f`, UP)).toBe('/rest/v1/t?a=1#f');
  });
});

describe('Realtime socket slots', () => {
  const wsBase = () => h.base.replace('http', 'ws');
  const upgrade = (cookie: string) =>
    new Promise<{ status: number; ws?: WebSocket }>((resolve) => {
      const ws = new WebSocket(`${wsBase()}/realtime/v1/websocket?apikey=${ANON}`, { headers: { origin: SITE, cookie } });
      ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0 }));
      ws.on('open', () => resolve({ status: 101, ws }));
      ws.on('error', () => undefined);
    });
  const rawRequest = (cookie: string, opts: { key: boolean; fin: boolean }) =>
    new Promise<void>((resolve) => {
      const u = new URL(h.base);
      const sock = net.connect(Number(u.port), u.hostname, () => {
        const lines = [
          'GET /realtime/v1/websocket HTTP/1.1',
          `Host: ${u.host}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          ...(opts.key ? ['Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='] : []),
          `Origin: ${SITE}`,
          `Cookie: ${cookie}`,
          '',
          '',
        ];
        sock.write(lines.join('\r\n'));
        if (opts.fin) sock.end();
      });
      sock.on('error', () => undefined);
      sock.on('close', () => resolve());
      sock.resume();
      setTimeout(() => {
        sock.destroy();
        resolve();
      }, 1500);
    });

  it('a malformed upgrade (no Sec-WebSocket-Key) gives its slot back', async () => {
    const s = await h.signIn('u-admin');
    await Promise.all(Array.from({ length: 25 }, () => rawRequest(s.cookie, { key: false, fin: false })));
    const ok = await upgrade(s.cookie);
    expect(ok.status).toBe(101);
    ok.ws?.close();
  });

  it('a client that half-closes while the session loads gives its slot back', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.refreshDelayMs = 300;
    await Promise.all(Array.from({ length: 25 }, () => rawRequest(s.cookie, { key: true, fin: true })));
    h.supabase.refreshDelayMs = 0;
    const ok = await upgrade(s.cookie);
    expect(ok.status).toBe(101);
    ok.ws?.close();
  });

  it('counts closed sockets correctly: 20 open, close 5, refill 5, then the 21st is refused', async () => {
    const s = await h.signIn('u-admin');
    const first = await Promise.all(Array.from({ length: 20 }, () => upgrade(s.cookie)));
    expect(first.every((r) => r.status === 101)).toBe(true);
    for (const r of first.slice(0, 5)) r.ws?.close();
    await new Promise((r) => setTimeout(r, 200));
    const refill = await Promise.all(Array.from({ length: 5 }, () => upgrade(s.cookie)));
    expect(refill.every((r) => r.status === 101)).toBe(true);
    const extra = await upgrade(s.cookie);
    expect(extra.status).toBe(429);
    for (const r of [...first, ...refill]) r.ws?.close();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('a sign-out while the upgrade is loading the session leaves no open socket', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.refreshDelayMs = 300;
    const pending = upgrade(s.cookie);
    await new Promise((r) => setTimeout(r, 100));
    await call(h.base, 'POST', '/bff/logout', { cookie: s.cookie, origin: SITE });
    const result = await pending;
    // Either refused outright, or (if the sign-out landed just after the
    // session loaded) opened and closed with 4001 at once.
    if (result.ws) {
      const code = await new Promise<number>((r) => {
        if (result.ws!.readyState === WebSocket.CLOSED) r(4001);
        result.ws!.once('close', (c) => r(c));
      });
      expect(code).toBe(4001);
    } else {
      expect(result.status).toBe(401);
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(result.ws ? result.ws.readyState : WebSocket.CLOSED).toBe(WebSocket.CLOSED);
  });

  it('a Realtime 503 for a pending admin check carries Retry-After', async () => {
    const s = await h.signIn('u-admin');
    await h.putStored(s.sid, { ...s.session, is_admin: false, admin_check: 'pending', expires_at: now() + 70 });
    const headers = await new Promise<Record<string, unknown>>((resolve) => {
      const ws = new WebSocket(`${wsBase()}/realtime/v1/websocket`, { headers: { origin: SITE, cookie: s.cookie } });
      ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode, ...res.headers }));
      ws.on('error', () => undefined);
    });
    expect(headers.status).toBe(503);
    expect(headers['retry-after']).toBe('10');
  });
});

describe('trust proxy and rate limit defaults', () => {
  it('an untrusted peer cannot pick a budget with a spoofed X-Forwarded-For', async () => {
    const limited = await startHarness({ signInRateLimit: 2, trustProxy: '10.9.9.9' });
    try {
      const codes = [];
      for (let i = 0; i < 3; i++) codes.push((await call(limited.base, 'GET', '/bff/login', { 'x-forwarded-for': `203.0.113.${i}` })).headers.location);
      expect(codes[2]).toBe('/login?error=server_error');
      expect(codes[0]).toMatch(/^https:\/\/supabase\.example\.test\//);
    } finally {
      await limited.close();
    }
  });

  it('defaults to 30 a minute and redirects over the limit', async () => {
    expect(DEFAULT_SIGN_IN_RATE_LIMIT).toBe(30);
    const d = await startHarness({ signInRateLimit: 'default' });
    try {
      const first = await call(d.base, 'GET', '/bff/login');
      expect(first.headers['x-ratelimit-limit']).toBe('30');
      expect(Number(first.headers['x-ratelimit-reset'])).toBeGreaterThan(55);
      expect(Number(first.headers['x-ratelimit-reset'])).toBeLessThanOrEqual(60);
      for (let i = 0; i < 29; i++) await call(d.base, 'GET', '/bff/login');
      const over = await call(d.base, 'GET', '/bff/login');
      expect(over.status).toBe(302);
      expect(over.headers.location).toBe('/login?error=server_error');
    } finally {
      await d.close();
    }
  });
});

describe('admin check classification', () => {
  const refreshWith = async (setup: () => void) => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    setup();
    await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin });
    return (await h.store.get(s.sid))!;
  };
  it('a dropped connection is pending', async () => {
    expect((await refreshWith(() => (h.supabase.adminDrop = true))).admin_check).toBe('pending');
  });
  it('a non-JSON body is pending', async () => {
    expect((await refreshWith(() => (h.supabase.adminRawBody = '<html>'))).admin_check).toBe('pending');
  });
  it('a non-array body is pending', async () => {
    expect((await refreshWith(() => (h.supabase.adminRawBody = '{"is_active":true}'))).admin_check).toBe('pending');
  });
  it('is_active must be strictly true', async () => {
    const s = await refreshWith(() => (h.supabase.adminRawBody = '[{"is_active":"true"}]'));
    expect(s.admin_check).toBe('ok');
    expect(s.is_admin).toBe(false);
  });
  it('retryAfterSeconds is at least 1', () => {
    expect(retryAfterSeconds({ access_token: 'a', refresh_token: 'r', expires_at: now() - 1000, user_id: 'u', is_admin: false })).toBe(1);
  });
});

describe('GoTrue /user unavailability on /bff/me', () => {
  for (const [label, setup] of [
    ['a dropped connection', () => (h.supabase.userDrop = true)],
    ['a non-JSON 200', () => (h.supabase.userRawBody = '<html>')],
  ] as const) {
    it(`${label} is 503 session_unavailable and keeps the session`, async () => {
      const s = await h.signIn('u-admin');
      setup();
      const r = await call(h.base, 'GET', '/bff/me', { cookie: s.cookie });
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toEqual({ error: 'session_unavailable' });
      expect(await h.store.get(s.sid)).not.toBeNull();
    });
  }
});

describe('/bff/me ending a session while Redis is down', () => {
  it('answers 503 session_unavailable when the delete fails', async () => {
    const s = await h.signIn('u-admin');
    h.supabase.userStatus = 401;
    const realDel = h.kv.del.bind(h.kv);
    h.kv.del = async () => {
      throw new Error('redis down');
    };
    try {
      const r = await call(h.base, 'GET', '/bff/me', { cookie: s.cookie });
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toEqual({ error: 'session_unavailable' });
    } finally {
      h.kv.del = realDel;
      h.supabase.userStatus = null;
    }
  });
});

describe('refresh details', () => {
  it('a 500 from the token endpoint is transient', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.refreshMode = 500;
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin });
    expect(r.status).toBe(503);
    expect(await h.store.get(s.sid)).not.toBeNull();
  });

  it('uses expires_in when the token endpoint gives no expires_at', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    const t = h.supabase.issue('u-admin');
    h.supabase.refreshRawBody = JSON.stringify({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_in: 1234,
      user: { id: 'u-admin' },
    });
    await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin });
    const stored = (await h.store.get(s.sid))!;
    expect(Math.abs(stored.expires_at - (now() + 1234))).toBeLessThanOrEqual(2);
  });
});

describe('encryption details', () => {
  const cfg = { supabaseUrl: 'http://x', publicSupabaseUrl: 'http://x', anonKey: 'a', siteUrl: 'https://s', provider: 'p' };
  const rec: GwSession = { access_token: 'at', refresh_token: 'rt', expires_at: now() + 3600, user_id: 'u', is_admin: true };

  it('two seals of the same plaintext differ', () => {
    const [k] = deriveKeys([KEY], 'store');
    expect(seal([k], 'x', 'c')).not.toBe(seal([k], 'x', 'c'));
  });

  it('writes with the first key after rotation', async () => {
    const kv = new MemoryKeyValue();
    const [newer] = deriveKeys([KEY], 'store');
    const [older] = deriveKeys([Buffer.alloc(32, 9)], 'store');
    const store = new SessionStore(cfg, kv, { keys: [newer, older] });
    const sid = await store.create(rec);
    const sealed = kv.data.get(`gw:admin-bff:session:${sid}`)!.value;
    expect(open([newer], sealed, sid)).not.toBeNull();
    expect(open([older], sealed, sid)).toBeNull();
  });

  it('matches known HKDF-SHA256 outputs for each purpose', () => {
    const k = Buffer.alloc(32, 7);
    expect(deriveKeys([k], 'cookie:session')[0].toString('hex')).toBe('01594b43c87e70578ceb983f3d06b2f7ee4bbb34421f40409be32ae035c8f54b');
    expect(deriveKeys([k], 'cookie:flow')[0].toString('hex')).toBe('13655e2cdfd653c491694c4e7919c103ee1280543c64a4084e6939f334335377');
    expect(deriveKeys([k], 'store')[0].toString('hex')).toBe('228a8c80ea143a5f614533444c5736d63065b0d53594c5a1dc218b6e0d3968e3');
  });

  it('session IDs are 32 random bytes', async () => {
    const store = new SessionStore(cfg, new MemoryKeyValue(), { keys: deriveKeys([KEY], 'store') });
    const a = await store.create(rec);
    const b = await store.create(rec);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it('deletes and ignores a plaintext record when encryption is on', async () => {
    const kv = new MemoryKeyValue();
    const store = new SessionStore(cfg, kv, { keys: deriveKeys([KEY], 'store') });
    await kv.set('gw:admin-bff:session:planted', JSON.stringify(rec), 3600);
    expect(await store.get('planted')).toBeNull();
    expect(await kv.get('gw:admin-bff:session:planted')).toBeNull();
  });

  it('refuses to build a store without keys unless the test flag is set', () => {
    expect(() => new SessionStore(cfg, new MemoryKeyValue())).toThrow(/encryption keys/);
    expect(() => new SessionStore(cfg, new MemoryKeyValue(), { insecureNoEncryptionForTests: true })).not.toThrow();
  });

  it('rejects a 63-character hex secret', () => {
    expect(() =>
      loadConfig({
        SUPABASE_INTERNAL_URL: 'http://k:8000',
        SUPABASE_PUBLIC_URL: 'https://s',
        SUPABASE_ANON_KEY: 'a',
        ADMIN_URL: 'https://a',
        GATEWAZE_API_URL: 'http://api:3002',
        REDIS_URL: 'redis://r',
        ADMIN_BFF_SESSION_SECRET: 'a'.repeat(63),
      }),
    ).toThrow(/64 hex/);
  });
});

describe('logout and callback failure paths', () => {
  it('logout falls back to the stored session when the refresh fails, and still revokes', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.refreshMode = 503;
    const r = await call(h.base, 'POST', '/bff/logout', { cookie: s.cookie, origin: SITE });
    expect(r.status).toBe(204);
    expect(h.supabase.logoutCalls.at(-1)).toBe(`Bearer ${s.session.access_token}`);
    expect(await h.store.get(s.sid)).toBeNull();
  });

  it('a callback whose session cannot be stored redirects with server_error', async () => {
    const login = await call(h.base, 'GET', '/bff/login');
    h.supabase.codes.set('c-store-fail', 'u-admin');
    const realSet = h.kv.set.bind(h.kv);
    h.kv.set = async () => {
      throw new Error('redis down');
    };
    try {
      const r = await call(h.base, 'GET', '/bff/callback?code=c-store-fail', { cookie: [login.headers['set-cookie'] ?? []].flat()[0].split(';')[0] });
      expect(r.headers.location).toBe('/login?error=server_error');
    } finally {
      h.kv.set = realSet;
    }
  });

  it('a callback without a code or a flow cookie never calls GoTrue', async () => {
    await call(h.base, 'GET', '/bff/callback?code=abc');
    const login = await call(h.base, 'GET', '/bff/login');
    await call(h.base, 'GET', '/bff/callback', { cookie: [login.headers['set-cookie'] ?? []].flat()[0].split(';')[0] });
    expect(h.supabase.requests.filter((r) => r.url.startsWith('/auth/v1/token'))).toHaveLength(0);
  });
});

describe('Realtime bridge limits', () => {
  // Socket stand-ins: the bridge only needs these members.
  type FakeSocket = EventEmitter & { readyState: number; bufferedAmount: number; sent: unknown[]; send(d: unknown): void; close(code?: number): void };
  const fakeSocket = (state = WebSocket.OPEN as number, buffered = 0): FakeSocket =>
    Object.assign(new EventEmitter(), {
      readyState: state,
      bufferedAmount: buffered,
      sent: [] as unknown[],
      send(d: unknown) {
        this.sent.push(d);
      },
      close(this: FakeSocket, code?: number) {
        this.readyState = WebSocket.CLOSED;
        this.emit('closed-with', code);
      },
    });
  const live = (): GwSession => ({ access_token: 'a', refresh_token: 'r', expires_at: now() + 3600, user_id: 'u', is_admin: true });
  const closedWith = (s: EventEmitter) => new Promise<number>((r) => s.once('closed-with', r));

  it('closes with 4001 when the refresh is refused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const client = fakeSocket();
      const upstream = fakeSocket();
      const closed = closedWith(client);
      bridgeRealtime(client as unknown as WebSocket, {
        upstreamUrl: 'ws://x',
        session: { ...live(), expires_at: now() + 61 },
        fresh: async () => null,
        onSignedOut: () => () => undefined,
        connect: () => upstream as unknown as WebSocket,
      });
      await vi.advanceTimersByTimeAsync(1100);
      expect(await closed).toBe(4001);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reschedules after a successful refresh', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let calls = 0;
      bridgeRealtime(fakeSocket() as unknown as WebSocket, {
        upstreamUrl: 'ws://x',
        session: { ...live(), expires_at: now() + 61 },
        fresh: async () => {
          calls++;
          return { ...live(), access_token: `a${calls}`, expires_at: Math.floor(Date.now() / 1000) + 61 };
        },
        onSignedOut: () => () => undefined,
        connect: () => fakeSocket() as unknown as WebSocket,
      });
      await vi.advanceTimersByTimeAsync(3500);
      expect(calls).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes with 1008 past 100 joined channels', async () => {
    const client = fakeSocket();
    const closed = closedWith(client);
    bridgeRealtime(client as unknown as WebSocket, {
      upstreamUrl: 'ws://x',
      session: live(),
      fresh: async () => live(),
      onSignedOut: () => () => undefined,
      connect: () => fakeSocket() as unknown as WebSocket,
    });
    for (let i = 0; i < 101; i++) client.emit('message', Buffer.from(JSON.stringify([String(i), String(i), `realtime:t${i}`, 'phx_join', {}])), false);
    expect(await closed).toBe(1008);
  });

  it('closes with 1003 on a binary frame', async () => {
    const client = fakeSocket();
    const upstream = fakeSocket();
    const closed = closedWith(client);
    bridgeRealtime(client as unknown as WebSocket, {
      upstreamUrl: 'ws://x',
      session: live(),
      fresh: async () => live(),
      onSignedOut: () => () => undefined,
      connect: () => upstream as unknown as WebSocket,
    });
    client.emit('message', Buffer.from('{}'), true);
    expect(await closed).toBe(1003);
    expect(upstream.sent).toEqual([]);
  });

  it('closes with 1013 when Realtime has a backlog over 4 MiB', async () => {
    const client = fakeSocket();
    const upstream = fakeSocket(WebSocket.OPEN, 5 * 1024 * 1024);
    const closed = closedWith(client);
    bridgeRealtime(client as unknown as WebSocket, {
      upstreamUrl: 'ws://x',
      session: live(),
      fresh: async () => live(),
      onSignedOut: () => () => undefined,
      connect: () => upstream as unknown as WebSocket,
    });
    client.emit('message', Buffer.from(JSON.stringify([null, '1', 'phoenix', 'heartbeat', {}])), false);
    expect(await closed).toBe(1013);
    expect(upstream.sent).toEqual([]);
  });

  it('closes with 1013 when the browser has a backlog over 4 MiB', async () => {
    const client = fakeSocket(WebSocket.OPEN, 5 * 1024 * 1024);
    const upstream = fakeSocket();
    const closed = closedWith(client);
    bridgeRealtime(client as unknown as WebSocket, {
      upstreamUrl: 'ws://x',
      session: live(),
      fresh: async () => live(),
      onSignedOut: () => () => undefined,
      connect: () => upstream as unknown as WebSocket,
    });
    upstream.emit('message', Buffer.from(JSON.stringify([null, '1', 'phoenix', 'phx_reply', {}])), false);
    expect(await closed).toBe(1013);
    expect(client.sent).toEqual([]);
  });
});

describe('request header stripping', () => {
  it('drops host, referer, proxy-authorization and x-forwarded-port', () => {
    const out = upstreamHeaders(
      { host: 'admin', referer: 'https://admin/x', 'proxy-authorization': 'Basic x', 'x-forwarded-port': '443', accept: 'a' },
      { bearer: 't', apikey: null },
      '',
    );
    expect(Object.keys(out).sort()).toEqual(['accept', 'authorization']);
  });
});

describe('config wiring', () => {
  const env = {
    SUPABASE_INTERNAL_URL: 'http://k:8000',
    SUPABASE_PUBLIC_URL: 'https://s',
    SUPABASE_ANON_KEY: 'a',
    ADMIN_URL: 'https://a',
    GATEWAZE_API_URL: 'http://api:3002',
    REDIS_URL: 'redis://r',
    ADMIN_BFF_SESSION_SECRET: 'a'.repeat(64),
  };
  it('reads the trust proxy, rate limit and upstream timeout', () => {
    const c = loadConfig({ ...env, ADMIN_BFF_TRUST_PROXY: '10.0.0.0/8', ADMIN_BFF_SIGNIN_RATE_LIMIT: '7', ADMIN_BFF_UPSTREAM_TIMEOUT_MS: '1234' });
    expect(c.trustProxy).toBe('10.0.0.0/8');
    expect(c.signInRateLimit).toBe(7);
    expect(c.upstreamTimeoutMs).toBe(1234);
  });
  it('uses the defaults when they are empty', () => {
    const c = loadConfig({ ...env, ADMIN_BFF_TRUST_PROXY: '', ADMIN_BFF_SIGNIN_RATE_LIMIT: '', ADMIN_BFF_UPSTREAM_TIMEOUT_MS: '' });
    expect(c.trustProxy).toBeUndefined();
    expect(c.signInRateLimit).toBe(30);
    expect(c.upstreamTimeoutMs).toBe(300_000);
  });
});
