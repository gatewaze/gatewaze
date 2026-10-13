// Round-2 review: the pending admin check contract, socket slot accounting,
// Redis failures, logout robustness, cookie subkeys, the sign-in rate limit,
// and the upgrade path surviving a reset connection. Encryption at rest moved
// to @gatewaze/host-session (test/core.test.ts).
import net from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { bridgeRealtime, type GwSession, isGwSession } from '@gatewaze/host-session';
import { FakeSupabase, call } from './helpers/fakes.js';
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
  h.supabase.refreshMode = 'ok';
  h.supabase.refreshDelayMs = 0;
  h.supabase.adminStatus = null;
});

const now = () => Math.floor(Date.now() / 1000);
const sameOrigin = { origin: SITE, apikey: ANON };
const pending = (s: GwSession): GwSession => ({ ...s, is_admin: false, admin_check: 'pending', expires_at: now() + 70 });

describe('pending admin check', () => {
  it('/bff/me answers 503 admin_check_pending with Retry-After, not 403', async () => {
    const s = await h.signIn('u-admin');
    await h.putStored(s.sid, pending(s.session));
    const r = await call(h.base, 'GET', '/bff/me', { cookie: s.cookie });
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ error: 'admin_check_pending' });
    expect(Number(r.headers['retry-after'])).toBe(10);
  });

  it('a real non-admin still gets 403 with the email', async () => {
    const s = await h.signIn('u-user');
    const r = await call(h.base, 'GET', '/bff/me', { cookie: s.cookie });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body)).toEqual({ error: 'not_admin', email: 'user@example.test' });
  });

  it('the proxy answers 503 for a non-public path, and still lets public reads through as anon', async () => {
    const s = await h.signIn('u-admin');
    await h.putStored(s.sid, pending(s.session));
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin });
    expect(r.status).toBe(503);
    expect(r.headers['retry-after']).toBe('10');
    expect(h.supabase.requests).toHaveLength(0);
    const pub = await call(h.base, 'GET', '/rest/v1/platform_settings', { cookie: s.cookie, ...sameOrigin });
    expect(pub.status).toBe(200);
    expect(h.supabase.requests.at(-1)!.headers.authorization).toBe(`Bearer ${ANON}`);
  });

  it('a Realtime upgrade answers 503', async () => {
    const s = await h.signIn('u-admin');
    await h.putStored(s.sid, pending(s.session));
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${h.base.replace('http', 'ws')}/realtime/v1/websocket`, { headers: { origin: SITE, cookie: s.cookie } });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve(101));
      ws.on('error', () => undefined);
    });
    expect(status).toBe(503);
  });

  it('the bridge keeps the socket when a refresh comes back pending, and moves to the new token', async () => {
    const sb = await new FakeSupabase().start();
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => wss.once('listening', r));
    const session: GwSession = { access_token: 'a1', refresh_token: 'r', expires_at: now() + 61, user_id: 'u', is_admin: true, admin_check: 'ok' };
    const next: GwSession = { ...session, access_token: 'a2', is_admin: false, admin_check: 'pending' };
    wss.on('connection', (server) =>
      bridgeRealtime(server, { upstreamUrl: `${sb.url.replace('http', 'ws')}/realtime/v1/websocket`, session, fresh: async () => next, onSignedOut: () => () => undefined }),
    );
    const client = new WebSocket(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`);
    let closedWith: number | null = null;
    client.on('close', (c) => (closedWith = c));
    await new Promise((r) => client.once('open', r));
    client.send(JSON.stringify(['1', '1', 'realtime:t', 'phx_join', {}]));
    await new Promise((r) => setTimeout(r, 1500));
    expect(closedWith).toBeNull();
    expect(sb.wsConnections[0].messages.some((m) => m.includes('"a2"'))).toBe(true);
    client.terminate();
    await new Promise((r) => wss.close(r));
    await sb.stop();
  });

  it('accepts a stored record without admin_check (written before the field) and rejects an unknown value', () => {
    const base = { access_token: 'a', refresh_token: 'r', expires_at: 1, user_id: 'u', is_admin: true };
    expect(isGwSession(base)).toBe(true);
    expect(isGwSession({ ...base, admin_check: 'pending' })).toBe(true);
    expect(isGwSession({ ...base, admin_check: 'maybe' })).toBe(false);
  });
});

describe('Realtime socket slots', () => {
  const upgrade = (cookie: string) =>
    new Promise<{ status: number; ws?: WebSocket }>((resolve) => {
      const ws = new WebSocket(`${h.base.replace('http', 'ws')}/realtime/v1/websocket?apikey=${ANON}`, { headers: { origin: SITE, cookie } });
      ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0 }));
      ws.on('open', () => resolve({ status: 101, ws }));
      ws.on('error', () => undefined);
    });

  it('admits at most 20 concurrent upgrades per session, and frees the slots again', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    // Every upgrade waits on the refresh, so all 25 are in flight together.
    h.supabase.refreshDelayMs = 300;
    const results = await Promise.all(Array.from({ length: 25 }, () => upgrade(s.cookie)));
    expect(results.filter((r) => r.status === 101)).toHaveLength(20);
    expect(results.filter((r) => r.status === 429)).toHaveLength(5);
    for (const r of results) r.ws?.close();
    await new Promise((r) => setTimeout(r, 200));
    const again = await upgrade(s.cookie);
    expect(again.status).toBe(101);
    again.ws?.close();
  });

  it('releases the slot when an upgrade is rejected after the reservation', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.refreshMode = 503;
    const rejected = await Promise.all(Array.from({ length: 20 }, () => upgrade(s.cookie)));
    expect(rejected.every((r) => r.status === 503)).toBe(true);
    h.supabase.refreshMode = 'ok';
    const ok = await upgrade(s.cookie);
    expect(ok.status).toBe(101);
    ok.ws?.close();
  });
});

describe('Redis failures', () => {
  it('a store read failure answers 503 session_unavailable, not 500', async () => {
    const s = await h.signIn('u-admin');
    const realGet = h.kv.get.bind(h.kv);
    h.kv.get = async () => {
      throw new Error('ECONNREFUSED redis');
    };
    try {
      const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin });
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toEqual({ error: 'session_unavailable' });
      const me = await call(h.base, 'GET', '/bff/me', { cookie: s.cookie });
      expect(me.status).toBe(503);
    } finally {
      h.kv.get = realGet;
    }
  });

  it('logout clears the cookie even when Redis fails', async () => {
    const s = await h.signIn('u-admin');
    const realGet = h.kv.get.bind(h.kv);
    const realDel = h.kv.del.bind(h.kv);
    h.kv.get = async () => {
      throw new Error('redis down');
    };
    h.kv.del = async () => {
      throw new Error('redis down');
    };
    try {
      const r = await call(h.base, 'POST', '/bff/logout', { cookie: s.cookie, origin: SITE });
      expect(r.status).toBe(204);
      const cleared = [r.headers['set-cookie'] ?? []].flat();
      expect(cleared.some((c) => /^__Host-gw-admin-session=;.*Max-Age=0/.test(c))).toBe(true);
    } finally {
      h.kv.get = realGet;
      h.kv.del = realDel;
    }
  });
});

describe('cookie subkeys', () => {
  it('a flow cookie carrying a session ID is not accepted as the session cookie', async () => {
    const s = await h.signIn('u-admin');
    // A well-formed flow cookie whose payload names a live session.
    const asFlow = encodeURIComponent(h.app.encodeSecureSession(h.app.createSecureSession({ sid: s.sid }), 'flow'));
    const r = await call(h.base, 'GET', '/rest/v1/notes', { cookie: `${h.cookie}=${asFlow}`, ...sameOrigin });
    expect(r.status).toBe(401);
    expect(r.headers['x-gw-session']).toBe('expired');
    // The same payload under the session subkey works.
    expect((await call(h.base, 'GET', '/rest/v1/notes', { cookie: s.cookie, ...sameOrigin })).status).toBe(200);
  });

  it('a session-key ciphertext carrying a login flow is not accepted as the flow cookie', async () => {
    const login = await call(h.base, 'GET', '/bff/login');
    const [name, ...rest] = [login.headers['set-cookie'] ?? []].flat()[0].split(';')[0].split('=');
    const flow = h.app.decodeSecureSession(decodeURIComponent(rest.join('=')), undefined, 'flow')!.get('pkce');
    // The same login flow, encrypted under the session cookie's subkey.
    const asSession = encodeURIComponent(h.app.encodeSecureSession(h.app.createSecureSession({ pkce: flow }), 'session'));
    h.supabase.codes.set('c-swap', 'u-admin');
    const swapped = await call(h.base, 'GET', '/bff/callback?code=c-swap', { cookie: `${name}=${asSession}` });
    expect(swapped.headers.location).toBe('/login?error=callback_invalid');
    // The genuine flow cookie completes the sign-in.
    h.supabase.codes.set('c-real', 'u-admin');
    const real = await call(h.base, 'GET', '/bff/callback?code=c-real', { cookie: `${name}=${rest.join('=')}` });
    expect(real.headers.location).toBe('/');
  });
});

describe('sign-in rate limit', () => {
  it('redirects with server_error after the per-address limit on /bff/login and /bff/callback', async () => {
    const limited = await startHarness({ signInRateLimit: 3 });
    try {
      const codes: number[] = [];
      // Over the limit is a redirect to the sign-in page with server_error.
      const loc = async (p: string) => (await call(limited.base, 'GET', p)).headers.location ?? '';
      for (let i = 0; i < 3; i++) codes.push(Number((await loc('/bff/login')).startsWith('https://')));
      expect(codes).toEqual([1, 1, 1]);
      expect(await loc('/bff/login')).toBe('/login?error=server_error');
      // /bff/callback has its own count per address (callback_invalid while under it).
      for (let i = 0; i < 3; i++) expect(await loc('/bff/callback?code=x')).toBe('/login?error=callback_invalid');
      expect(await loc('/bff/callback?code=x')).toBe('/login?error=server_error');
      // Other routes are not limited.
      expect((await call(limited.base, 'GET', '/bff/healthz')).status).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it('counts by the X-Forwarded-For client only when the peer is a trusted proxy', async () => {
    const limited = await startHarness({ signInRateLimit: 2 });
    try {
      // 127.0.0.1 is loopback, which is trusted by default: each forwarded
      // client gets its own budget.
      const a = [];
      for (let i = 0; i < 3; i++) a.push((await call(limited.base, 'GET', '/bff/login', { 'x-forwarded-for': `203.0.113.${i}` })).status);
      expect(a).toEqual([302, 302, 302]);
    } finally {
      await limited.close();
    }
  });
});

describe('upgrade path survives a reset connection', () => {
  const rawUpgrade = (cookie: string) =>
    new Promise<void>((resolve) => {
      const u = new URL(h.base);
      const sock = net.connect(Number(u.port), u.hostname, () => {
        sock.write(
          [
            'GET /realtime/v1/websocket HTTP/1.1',
            `Host: ${u.host}`,
            'Connection: Upgrade',
            'Upgrade: websocket',
            'Sec-WebSocket-Version: 13',
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
            `Origin: ${SITE}`,
            `Cookie: ${cookie}`,
            '',
            '',
          ].join('\r\n'),
        );
        sock.resetAndDestroy();
        resolve();
      });
      sock.on('error', () => undefined);
    });

  it('keeps serving after clients reset immediately and while the session loads', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.refreshDelayMs = 200;
    for (let i = 0; i < 10; i++) await rawUpgrade(s.cookie);
    // Also a reset on an early reject (no cookie).
    for (let i = 0; i < 10; i++) await rawUpgrade('');
    await new Promise((r) => setTimeout(r, 500));
    const r = await call(h.base, 'GET', '/bff/healthz');
    expect(r.status).toBe(200);
  });
});
