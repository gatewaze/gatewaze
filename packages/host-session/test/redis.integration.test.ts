// The ioredis KeyValue against a real Redis or Valkey. Skipped unless
// REDIS_TEST_URL is set, e.g.:
//   docker run --rm -d -p 6390:6379 valkey/valkey:8-alpine --requirepass pw
//   REDIS_TEST_URL=redis://:pw@127.0.0.1:6390 pnpm --filter @gatewaze/host-session test
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { deriveKeys } from '../src/keys.js';
import { SessionEndedError } from '../src/session.js';
import { RedisKeyValue, SessionStore } from '../src/store.js';

const url = process.env.REDIS_TEST_URL ?? '';

describe.skipIf(!url)('RedisKeyValue (real Redis)', () => {
  let kv: RedisKeyValue;
  beforeAll(() => {
    kv = RedisKeyValue.fromUrl(url);
  });
  afterAll(() => kv.close());

  it('sets with a TTL, locks with NX and releases only its own lock', async () => {
    await kv.set('gw:admin-bff:test:a', 'v', 60);
    expect(await kv.get('gw:admin-bff:test:a')).toBe('v');
    const raw = new Redis(url);
    try {
      const ttl = await raw.ttl('gw:admin-bff:test:a');
      expect(ttl).toBeGreaterThan(55);
      expect(ttl).toBeLessThanOrEqual(60);
      expect(await raw.pttl('gw:admin-bff:test:lock')).toBe(-2);
      await kv.setIfAbsent('gw:admin-bff:test:lock', 'me', 5000);
      expect(await raw.pttl('gw:admin-bff:test:lock')).toBeGreaterThan(4000);
      await kv.del('gw:admin-bff:test:lock');
    } finally {
      raw.disconnect();
    }
    expect(await kv.setIfAbsent('gw:admin-bff:test:lock', 'me', 5000)).toBe(true);
    expect(await kv.setIfAbsent('gw:admin-bff:test:lock', 'other', 5000)).toBe(false);
    await kv.delIfEquals('gw:admin-bff:test:lock', 'other');
    expect(await kv.get('gw:admin-bff:test:lock')).toBe('me');
    await kv.delIfEquals('gw:admin-bff:test:lock', 'me');
    expect(await kv.get('gw:admin-bff:test:lock')).toBeNull();
    await kv.del('gw:admin-bff:test:a');
  });

  it('writes with SET XX only when the key exists', async () => {
    await kv.del('gw:admin-bff:test:xx');
    expect(await kv.setIfExists('gw:admin-bff:test:xx', 'v', 60)).toBe(false);
    expect(await kv.get('gw:admin-bff:test:xx')).toBeNull();
    await kv.set('gw:admin-bff:test:xx', 'old', 60);
    expect(await kv.setIfExists('gw:admin-bff:test:xx', 'new', 60)).toBe(true);
    expect(await kv.get('gw:admin-bff:test:xx')).toBe('new');
    await kv.del('gw:admin-bff:test:xx');
  });

  it('sets a key from the create script only while the lock is held and nothing blocks it', async () => {
    const k = `gw:admin-bff:test:cs:${Date.now()}:`;
    try {
      await kv.set(`${k}lock`, 'me', 60);
      expect(await kv.setIfLockHeld(`${k}v`, 'one', 60, `${k}lock`, 'me', `${k}block`)).toBe('ok');
      expect(await kv.get(`${k}v`)).toBe('one');
      expect(await kv.setIfLockHeld(`${k}v`, 'two', 60, `${k}lock`, 'other', `${k}block`)).toBe('lock-lost');
      await kv.set(`${k}block`, '1', 60);
      expect(await kv.setIfLockHeld(`${k}v`, 'three', 60, `${k}lock`, 'me', `${k}block`)).toBe('blocked');
      expect(await kv.get(`${k}v`)).toBe('one');
    } finally {
      for (const x of ['lock', 'v', 'block']) await kv.del(`${k}${x}`);
    }
  });

  it('a sign-out on one instance wins over a mint in flight on another', async () => {
    const cfg = { supabaseUrl: 'http://x', anonKey: 'a' };
    const keys = deriveKeys([Buffer.alloc(32, 1)], 'store');
    const prefix = `lfx:hs-test:${Date.now()}:signout:`;
    const revoked: string[] = [];
    const revoke = async (_c: unknown, s: { refresh_token: string }) => {
      revoked.push(s.refresh_token);
    };
    const a = await SessionStore.connect(cfg, url, { keys, keyPrefix: prefix, revoke });
    const b = await SessionStore.connect(cfg, url, { keys, keyPrefix: prefix, revoke });
    try {
      const pending = a.acquire('sid-1', async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { access_token: 'at', refresh_token: 'rt-minted', expires_at: Math.floor(Date.now() / 1000) + 3600, user_id: 'u', is_admin: true };
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(await b.get('sid-1')).toBeNull();
      await b.delete('sid-1');
      await expect(pending).rejects.toBeInstanceOf(SessionEndedError);
      expect(revoked).toEqual(['rt-minted']);
      expect(await a.get('sid-1')).toBeNull();
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('delIfEquals reports whether it deleted', async () => {
    const k = `gw:admin-bff:test:die:${Date.now()}`;
    await kv.set(k, 'v', 60);
    expect(await kv.delIfEquals(k, 'other')).toBe(false);
    expect(await kv.delIfEquals(k, 'v')).toBe(true);
    expect(await kv.get(k)).toBeNull();
  });

  it('a guarded discard removes only the session holding the refused token', async () => {
    const cfg = { supabaseUrl: 'http://x', anonKey: 'a' };
    const keys = deriveKeys([Buffer.alloc(32, 1)], 'store');
    const prefix = `lfx:hs-test:${Date.now()}:discard:`;
    const a = await SessionStore.connect(cfg, url, { keys, keyPrefix: prefix });
    const b = await SessionStore.connect(cfg, url, { keys, keyPrefix: prefix });
    const rec = (t: string) => ({ access_token: t, refresh_token: `r-${t}`, expires_at: Math.floor(Date.now() / 1000) + 3600, user_id: 'u', is_admin: true });
    try {
      await a.put('sid-1', rec('s2'));
      expect(await b.discard('sid-1', { onlyIfAccessToken: 's1' })).toBe(false);
      expect((await a.get('sid-1'))?.access_token).toBe('s2');
      const heard = new Promise<void>((r) => a.onDelete('sid-1', r));
      expect(await b.discard('sid-1', { onlyIfAccessToken: 's2' })).toBe(true);
      await heard;
      expect(await a.get('sid-1')).toBeNull();
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('delivers a sign-out to another instance', async () => {
    const cfg = { supabaseUrl: 'http://x', publicSupabaseUrl: 'http://x', anonKey: 'a', siteUrl: 'https://s', provider: 'p' };
    const keys = deriveKeys([Buffer.alloc(32, 1)], 'store');
    const a = await SessionStore.connect(cfg, url, { keys });
    const b = await SessionStore.connect(cfg, url, { keys });
    try {
      const sid = await a.create({ access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user_id: 'u', is_admin: true });
      const heard = new Promise<void>((r) => b.onDelete(sid, r));
      await a.delete(sid);
      await heard;
      expect(await b.get(sid)).toBeNull();
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('single-flights acquire() across two instances, under a host key prefix', async () => {
    const cfg = { supabaseUrl: 'http://x', anonKey: 'a' };
    const keys = deriveKeys([Buffer.alloc(32, 1)], 'store');
    const prefix = `lfx:hs-test:${Date.now()}:`;
    const a = await SessionStore.connect(cfg, url, { keys, keyPrefix: prefix });
    const b = await SessionStore.connect(cfg, url, { keys, keyPrefix: prefix });
    const raw = new Redis(url);
    try {
      let mints = 0;
      let lockTtl = 0;
      const mint = async () => {
        mints++;
        lockTtl = await raw.pttl(`${prefix}create-lock:sid-1`);
        await new Promise((r) => setTimeout(r, 150));
        return { access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user_id: 'u', is_admin: true };
      };
      const results = await Promise.all([a.acquire('sid-1', mint), b.acquire('sid-1', mint), a.acquire('sid-1', mint)]);
      expect(mints).toBe(1);
      expect(results.map((s) => s.access_token)).toEqual(['t', 't', 't']);
      expect(lockTtl).toBeGreaterThan(30_000);
      expect(await raw.exists(`${prefix}create-lock:sid-1`)).toBe(0);
      expect(await raw.exists(`${prefix}session:sid-1`)).toBe(1);
      const heard = new Promise<void>((r) => b.onDelete('sid-1', r));
      await a.delete('sid-1');
      await heard;
    } finally {
      raw.disconnect();
      await a.close();
      await b.close();
    }
  });
});
