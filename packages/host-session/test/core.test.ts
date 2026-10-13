// Core behaviour that needs no HTTP framework: Location filtering, record
// encryption, Realtime bridge limits and request header stripping. Moved
// from the admin BFF's review-round suites (final.test.ts, round2.test.ts).
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { deriveKeys, open, seal } from '../src/keys.js';
import { rewriteLocation, upstreamHeaders } from '../src/proxy.js';
import { bridgeRealtime } from '../src/realtime.js';
import type { GwSession } from '../src/session.js';
import { SessionStore } from '../src/store.js';
import { MemoryKeyValue } from './helpers/fakes.js';

const KEY = Buffer.alloc(32, 7);
const now = () => Math.floor(Date.now() / 1000);
const UP = 'http://supabase-kong:8000';

describe('Location filtering', () => {
  const SITE_ORIGIN = 'https://admin.example.test';
  for (const loc of [
    '//evil.example/x',
    '/\\evil.test',
    '\\\\evil.test',
    '/\t/evil.test',
    'javascript:alert(1)',
    'data:text/html,x',
    'ftp://x',
    'http://evil.example/x',
    '/a\nb',
    `${UP}//evil.example/x`,
    `${UP}/a/..//evil.example`,
    `${SITE_ORIGIN}//evil.example/x`,
  ]) {
    it(`drops ${JSON.stringify(loc)}`, () => {
      expect(rewriteLocation(loc, UP, SITE_ORIGIN)).toBeNull();
    });
  }
  it('passes other https hosts and local http through unchanged', () => {
    expect(rewriteLocation('https://accounts.google.com/o/oauth2/v2/auth?x=1', UP, SITE_ORIGIN)).toBe('https://accounts.google.com/o/oauth2/v2/auth?x=1');
    expect(rewriteLocation('http://localhost:5274/x', UP, SITE_ORIGIN)).toBe('http://localhost:5274/x');
    expect(rewriteLocation('http://admin.gatewaze.localhost/x', UP, SITE_ORIGIN)).toBe('http://admin.gatewaze.localhost/x');
  });
  it('makes the admin origin relative', () => {
    expect(rewriteLocation(`${SITE_ORIGIN}/settings?x=1`, UP, SITE_ORIGIN)).toBe('/settings?x=1');
  });
  it('keeps a same-origin relative path and relativises a same-origin absolute URL', () => {
    expect(rewriteLocation('/storage/v1/object/x?y=1', UP)).toBe('/storage/v1/object/x?y=1');
    expect(rewriteLocation('x/y', UP)).toBe('x/y');
    expect(rewriteLocation(`${UP}/rest/v1/t?a=1#f`, UP)).toBe('/rest/v1/t?a=1#f');
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

describe('session records are encrypted at rest', () => {
  const cfg = { supabaseUrl: 'http://x', publicSupabaseUrl: 'http://x', anonKey: 'a', siteUrl: 'https://s', provider: 'p' };
  const rec: GwSession = { access_token: 'AT-secret-value', refresh_token: 'RT-secret-value', expires_at: now() + 3600, user_id: 'u', is_admin: true };

  it('stores no token in readable form', async () => {
    const kv = new MemoryKeyValue();
    const store = new SessionStore(cfg, kv, { keys: deriveKeys([KEY], 'store') });
    const sid = await store.create(rec);
    const raw = [...kv.data.values()].map((v) => v.value).join();
    expect(raw).not.toContain('AT-secret-value');
    expect(raw).not.toContain('RT-secret-value');
    expect(raw).not.toContain('"is_admin"');
    expect((await store.get(sid))!.access_token).toBe('AT-secret-value');
  });

  it('reads a record written with an older key after rotation', async () => {
    const kv = new MemoryKeyValue();
    const oldKey = Buffer.alloc(32, 9);
    const before = new SessionStore(cfg, kv, { keys: deriveKeys([oldKey], 'store') });
    const sid = await before.create(rec);
    const after = new SessionStore(cfg, kv, { keys: deriveKeys([KEY, oldKey], 'store') });
    expect((await after.get(sid))!.refresh_token).toBe('RT-secret-value');
    const without = new SessionStore(cfg, kv, { keys: deriveKeys([KEY], 'store') });
    expect(await without.get(sid)).toBeNull();
  });

  it('treats a tampered record, or one moved to another session ID, as missing', async () => {
    const kv = new MemoryKeyValue();
    const store = new SessionStore(cfg, kv, { keys: deriveKeys([KEY], 'store') });
    const sid = await store.create(rec);
    const key = `gw:admin-bff:session:${sid}`;
    const sealed = kv.data.get(key)!.value;
    const bytes = Buffer.from(sealed.slice(3), 'base64url');
    bytes[bytes.length - 1] ^= 1;
    kv.data.get(key)!.value = `v1:${bytes.toString('base64url')}`;
    expect(await store.get(sid)).toBeNull();
    const other = await store.create(rec);
    kv.data.get(`gw:admin-bff:session:${other}`)!.value = sealed;
    expect(await store.get(other)).toBeNull();
  });

  it('derives different subkeys per purpose', () => {
    const [session] = deriveKeys([KEY], 'cookie:session');
    const [flow] = deriveKeys([KEY], 'cookie:flow');
    const [store] = deriveKeys([KEY], 'store');
    expect(new Set([session.toString('hex'), flow.toString('hex'), store.toString('hex'), KEY.toString('hex')]).size).toBe(4);
    expect(open([flow], seal([session], 'x', 'c'), 'c')).toBeNull();
  });
});
