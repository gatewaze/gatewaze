// The Realtime bridge (poc-stack.md "Admin: Realtime" and the upgrade
// checks): the token goes into every phx_join and access_token message, a
// refresh pushes the new token to joined channels, and sign-out closes the
// socket.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { HOST_SESSION } from '@gatewaze/host-session';
import { call } from './helpers/fakes.js';
import { ANON, type Harness, SITE, startHarness } from './helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  h.supabase.addUser('u-admin', 'admin@example.test', true);
  h.supabase.addUser('u-user', 'user@example.test', false);
});
afterAll(() => h.close());
beforeEach(() => {
  h.supabase.wsConnections.length = 0;
  h.supabase.refreshCalls = 0;
  h.supabase.refreshMode = 'ok';
});

const wsUrl = (base: string) => `${base.replace('http', 'ws')}/realtime/v1/websocket?apikey=${ANON}&vsn=2.0.0&access_token=${HOST_SESSION}`;

function connect(cookie: string | null, origin = SITE): Promise<{ ws: WebSocket; received: string[]; closed: Promise<number> }> {
  const headers: Record<string, string> = { origin };
  if (cookie) headers.cookie = cookie;
  const ws = new WebSocket(wsUrl(h.base), { headers });
  const received: string[] = [];
  ws.on('message', (d) => received.push(d.toString()));
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, received, closed }));
    ws.once('unexpected-response', (_req, res) => {
      lastRejection = res.headers;
      reject(new Error(`HTTP ${res.statusCode}`));
    });
    ws.once('error', reject);
  });
}

let lastRejection: Record<string, unknown> = {};

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('upgrade checks', () => {
  it('upgrades with the session cookie and the site Origin', async () => {
    const s = await h.signIn('u-admin');
    const { ws } = await connect(s.cookie);
    ws.close();
  });
  it('401s without a session, with the expiry marker', async () => {
    await expect(connect(null)).rejects.toThrow('HTTP 401');
    expect(lastRejection['x-gw-session']).toBe('expired');
  });
  it('403s from another origin', async () => {
    const s = await h.signIn('u-admin');
    await expect(connect(s.cookie, 'https://evil.example')).rejects.toThrow('HTTP 403');
  });
  it('403s a non-admin', async () => {
    const s = await h.signIn('u-user');
    await expect(connect(s.cookie)).rejects.toThrow('HTTP 403');
  });
  it('401s a cookie whose session is gone, with the expiry marker', async () => {
    const s = await h.signIn('u-admin');
    await h.store.delete(s.sid);
    await expect(connect(s.cookie)).rejects.toThrow('HTTP 401');
    expect(lastRejection['x-gw-session']).toBe('expired');
  });
  it('503s when the session cannot be refreshed at upgrade time', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.refreshMode = 503;
    await expect(connect(s.cookie)).rejects.toThrow('HTTP 503');
    expect(await h.store.get(s.sid)).not.toBeNull();
  });
  it('closes with 1009 on a message over 8 MiB', async () => {
    const s = await h.signIn('u-admin');
    const { ws, closed } = await connect(s.cookie);
    ws.send(Buffer.alloc(8 * 1024 * 1024 + 1, 0x61), { binary: false });
    expect(await closed).toBe(1009);
  });
});

describe('message rewriting', () => {
  it('opens the upstream socket with the anon key and no URL token', async () => {
    const s = await h.signIn('u-admin');
    const { ws } = await connect(s.cookie);
    await until(() => h.supabase.wsConnections.length === 1);
    const u = new URL(h.supabase.wsConnections[0].url, 'http://x');
    expect(u.searchParams.get('apikey')).toBe(ANON);
    expect(u.searchParams.has('access_token')).toBe(false);
    ws.close();
  });

  it('puts the real token into phx_join (2.0.0 arrays) and access_token messages', async () => {
    const s = await h.signIn('u-admin');
    const { ws, received } = await connect(s.cookie);
    ws.send(JSON.stringify(['1', '1', 'realtime:t', 'phx_join', { config: {}, access_token: HOST_SESSION }]));
    // realtime-js sometimes joins without a token at all.
    ws.send(JSON.stringify(['2', '2', 'realtime:u', 'phx_join', { config: {} }]));
    ws.send(JSON.stringify(['1', '3', 'realtime:t', 'access_token', { access_token: ANON }]));
    ws.send(JSON.stringify([null, '4', 'phoenix', 'heartbeat', {}]));
    await until(() => (h.supabase.wsConnections[0]?.messages.length ?? 0) === 4);
    const msgs = h.supabase.wsConnections[0].messages.map((m) => JSON.parse(m));
    expect(msgs[0][4]).toEqual({ config: {}, access_token: s.session.access_token });
    expect(msgs[1][4]).toEqual({ config: {}, access_token: s.session.access_token });
    expect(msgs[2][4]).toEqual({ access_token: s.session.access_token });
    expect(msgs[3]).toEqual([null, '4', 'phoenix', 'heartbeat', {}]);
    // The browser gets the upstream replies, never a token.
    await until(() => received.length === 4);
    expect(received.join()).not.toContain(s.session.access_token);
    ws.close();
  });

  it('handles 1.0.0 object messages', async () => {
    const s = await h.signIn('u-admin');
    const { ws } = await connect(s.cookie);
    ws.send(JSON.stringify({ join_ref: '1', ref: '1', topic: 'realtime:t', event: 'phx_join', payload: { access_token: HOST_SESSION } }));
    await until(() => (h.supabase.wsConnections[0]?.messages.length ?? 0) === 1);
    expect(JSON.parse(h.supabase.wsConnections[0].messages[0]).payload.access_token).toBe(s.session.access_token);
    ws.close();
  });
});

describe('refresh during a connection', () => {
  it('refreshes before expiry and pushes the new token to joined channels, hiding the replies', async () => {
    // 61 seconds left: the bridge's refresh timer fires after its 1-second floor.
    const s = await h.signIn('u-admin', { ttlSeconds: 61 });
    const { ws, received } = await connect(s.cookie);
    ws.send(JSON.stringify(['1', '1', 'realtime:t', 'phx_join', { access_token: HOST_SESSION }]));
    await until(() => received.length === 1);
    await until(() => h.supabase.refreshCalls === 1, 5000);
    await until(() => h.supabase.wsConnections[0].messages.some((m) => m.includes('"access_token"') && m.includes('bff-')));
    // Read after the push: the refresh is saved before the push is sent.
    const stored = (await h.store.get(s.sid))!;
    const push = JSON.parse(h.supabase.wsConnections[0].messages.find((m) => m.includes('bff-'))!);
    expect(push).toEqual(['1', 'bff-1', 'realtime:t', 'access_token', { access_token: stored.access_token }]);
    expect(stored.access_token).not.toBe(s.session.access_token);
    // The upstream's reply to the BFF's push is not relayed.
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toHaveLength(1);
    ws.close();
  });
});

describe('session end during a connection', () => {
  it('closes with 4001 when the admin is revoked at refresh', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 61 });
    const { closed } = await connect(s.cookie);
    h.supabase.users.get('u-admin')!.admin = false;
    try {
      expect(await closed).toBe(4001);
    } finally {
      h.supabase.users.get('u-admin')!.admin = true;
    }
  });

  it('closes with 4001 when GoTrue refuses the refresh', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 61 });
    const { closed } = await connect(s.cookie);
    h.supabase.refreshMode = 400;
    expect(await closed).toBe(4001);
  });
});

describe('sign-out', () => {
  it('closes the socket with 4001 when the session signs out', async () => {
    const s = await h.signIn('u-admin');
    const { closed } = await connect(s.cookie);
    const r = await call(h.base, 'POST', '/bff/logout', { cookie: s.cookie, origin: SITE });
    expect(r.status).toBe(204);
    expect(await closed).toBe(4001);
  });

  it('closes sockets on shutdown with 1001', async () => {
    const other = await startHarness();
    other.supabase.addUser('u-admin', 'a@example.test', true);
    const s = await other.signIn('u-admin');
    const ws = new WebSocket(wsUrl(other.base), { headers: { origin: SITE, cookie: s.cookie } });
    const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
    await new Promise((r) => ws.once('open', r));
    await other.close();
    expect(await closed).toBe(1001);
  });
});
