// The ioredis KeyValue against a real Redis or Valkey. Skipped unless
// REDIS_TEST_URL is set, e.g.:
//   docker run --rm -d -p 6390:6379 valkey/valkey:8-alpine --requirepass pw
//   REDIS_TEST_URL=redis://:pw@127.0.0.1:6390 pnpm --filter @gatewaze/admin-bff test
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { deriveKeys } from '../src/core/keys.js';
import { RedisKeyValue, SessionStore } from '../src/core/store.js';

const url = process.env.REDIS_TEST_URL;

describe.skipIf(!url)('RedisKeyValue (real Redis)', () => {
  let kv: RedisKeyValue;
  beforeAll(() => {
    kv = RedisKeyValue.fromUrl(url!);
  });
  afterAll(() => kv.close());

  it('sets with a TTL, locks with NX and releases only its own lock', async () => {
    await kv.set('gw:admin-bff:test:a', 'v', 60);
    expect(await kv.get('gw:admin-bff:test:a')).toBe('v');
    const raw = new Redis(url!);
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

  it('delivers a sign-out to another instance', async () => {
    const cfg = { supabaseUrl: 'http://x', publicSupabaseUrl: 'http://x', anonKey: 'a', siteUrl: 'https://s', provider: 'p' };
    const keys = deriveKeys([Buffer.alloc(32, 1)], 'store');
    const a = await SessionStore.connect(cfg, url!, { keys });
    const b = await SessionStore.connect(cfg, url!, { keys });
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
});
