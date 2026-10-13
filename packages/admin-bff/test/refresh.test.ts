// Server-side refresh: one GoTrue refresh under the lock however many
// requests arrive at once (poc-stack.md "Concurrent refresh"), the
// admin_profiles re-check, and what happens when GoTrue says no or is down.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type GwSession, RefreshUnavailableError, SessionStore } from '@gatewaze/host-session';
import { MemoryKeyValue, call } from './helpers/fakes.js';
import { ANON, type Harness, SITE, startHarness } from './helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  h.supabase.addUser('u-admin', 'admin@example.test', true);
});
afterAll(() => h.close());
beforeEach(() => {
  h.supabase.requests.length = 0;
  h.supabase.refreshCalls = 0;
  h.supabase.refreshMode = 'ok';
  h.supabase.refreshDelayMs = 0;
});

const hdr = (cookie: string) => ({ cookie, origin: SITE, apikey: ANON });

describe('refresh', () => {
  it('refreshes once for four concurrent requests on an expiring session', async () => {
    // 30 seconds left: inside the 60-second refresh skew.
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.refreshDelayMs = 150;
    const results = await Promise.all([1, 2, 3, 4].map(() => call(h.base, 'GET', '/rest/v1/notes', hdr(s.cookie))));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(h.supabase.refreshCalls).toBe(1);
    const stored = (await h.store.get(s.sid))!;
    expect(stored.refresh_token).not.toBe(s.session.refresh_token);
    expect(stored.expires_at).toBeGreaterThan(s.session.expires_at);
    expect(stored.is_admin).toBe(true);
    // Every proxied call carried the new token, none the old one.
    const proxied = h.supabase.requests.filter((r) => r.url === '/rest/v1/notes');
    expect(proxied).toHaveLength(4);
    for (const r of proxied) expect(r.headers.authorization).toBe(`Bearer ${stored.access_token}`);
    // The lock is released.
    expect([...h.kv.data.keys()].some((k) => k.includes('refresh-lock'))).toBe(false);
  });

  it('re-checks admin_profiles on refresh and drops a revoked admin to 403', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.users.get('u-admin')!.admin = false;
    try {
      const r = await call(h.base, 'GET', '/rest/v1/notes', hdr(s.cookie));
      expect(r.status).toBe(403);
      expect(h.supabase.requests.some((x) => x.url.startsWith('/rest/v1/admin_profiles'))).toBe(true);
    } finally {
      h.supabase.users.get('u-admin')!.admin = true;
    }
  });

  it('ends the session when GoTrue refuses the refresh token', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.refreshMode = 400;
    const r = await call(h.base, 'GET', '/rest/v1/notes', hdr(s.cookie));
    expect(r.status).toBe(401);
    expect(r.headers['x-gw-session']).toBe('expired');
    expect(await h.store.get(s.sid)).toBeNull();
  });

  it('keeps the session and answers 503 when GoTrue is unavailable', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 30 });
    h.supabase.refreshMode = 503;
    const r = await call(h.base, 'GET', '/rest/v1/notes', hdr(s.cookie));
    expect(r.status).toBe(503);
    expect(r.headers['x-gw-session']).toBeUndefined();
    expect(await h.store.get(s.sid)).not.toBeNull();
    // And recovers on the next request once GoTrue is back.
    h.supabase.refreshMode = 'ok';
    expect((await call(h.base, 'GET', '/rest/v1/notes', hdr(s.cookie))).status).toBe(200);
  });

  it('does not refresh a session outside the skew', async () => {
    const s = await h.signIn('u-admin', { ttlSeconds: 3600 });
    await call(h.base, 'GET', '/rest/v1/notes', hdr(s.cookie));
    expect(h.supabase.refreshCalls).toBe(0);
  });
});

describe('SessionStore lock', () => {
  const cfg = { supabaseUrl: 'http://x', publicSupabaseUrl: 'http://x', anonKey: 'a', siteUrl: 'https://s', provider: 'p' };
  const expiring = (): GwSession => ({ access_token: 'a1', refresh_token: 'r1', expires_at: Math.floor(Date.now() / 1000) + 10, user_id: 'u', is_admin: true });

  it('releases only its own lock', async () => {
    const kv = new MemoryKeyValue();
    const store = new SessionStore(cfg, kv, {
      insecureNoEncryptionForTests: true,
      refresh: async (_c, s) => {
        // Simulate the lock expiring mid-refresh and another caller taking it.
        const lockKey = [...kv.data.keys()].find((k) => k.includes('refresh-lock'))!;
        kv.data.set(lockKey, { value: 'someone-else', expiresAt: Date.now() + 10_000 });
        return { ...s, access_token: 'a2', refresh_token: 'r2', expires_at: Math.floor(Date.now() / 1000) + 3600 };
      },
    });
    const sid = await store.create(expiring());
    await store.fresh(sid);
    const lock = [...kv.data.entries()].find(([k]) => k.includes('refresh-lock'));
    expect(lock?.[1].value).toBe('someone-else');
  });

  it('throws RefreshUnavailableError rather than signing out when a refresh stays locked', async () => {
    const kv = new MemoryKeyValue();
    const store = new SessionStore(cfg, kv, {
      insecureNoEncryptionForTests: true, refresh: async () => expiring() });
    const sid = await store.create(expiring());
    await kv.setIfAbsent(`gw:admin-bff:refresh-lock:${sid}`, 'other', 60_000);
    const origNow = Date.now;
    let t = origNow();
    Date.now = () => (t += 1000);
    try {
      await expect(store.fresh(sid)).rejects.toBeInstanceOf(RefreshUnavailableError);
    } finally {
      Date.now = origNow;
    }
    expect(await store.get(sid)).not.toBeNull();
  });

  it('re-checks inside the lock and skips the refresh another caller already did', async () => {
    const kv = new MemoryKeyValue();
    let refreshes = 0;
    const fresh = { access_token: 'a2', refresh_token: 'r2', expires_at: Math.floor(Date.now() / 1000) + 3600, user_id: 'u', is_admin: true };
    const store = new SessionStore(cfg, kv, {
      insecureNoEncryptionForTests: true,
      refresh: async () => {
        refreshes++;
        return fresh;
      },
    });
    const sid = await store.create(expiring());
    // Another caller refreshes between this caller's first read and its lock.
    const realSetIfAbsent = kv.setIfAbsent.bind(kv);
    kv.setIfAbsent = async (key, value, ttl) => {
      await kv.set(`gw:admin-bff:session:${sid}`, JSON.stringify(fresh), 3600);
      return realSetIfAbsent(key, value, ttl);
    };
    const got = await store.fresh(sid);
    expect(refreshes).toBe(0);
    expect(got).toEqual(fresh);
  });

  it('uses a different lock owner per call', async () => {
    const kv = new MemoryKeyValue();
    const owners: string[] = [];
    const realSetIfAbsent = kv.setIfAbsent.bind(kv);
    kv.setIfAbsent = async (key, value, ttl) => {
      owners.push(value);
      return realSetIfAbsent(key, value, ttl);
    };
    const store = new SessionStore(cfg, kv, {
      insecureNoEncryptionForTests: true, refresh: async (_c, s) => ({ ...s, expires_at: Math.floor(Date.now() / 1000) + 10 }) });
    const sid = await store.create(expiring());
    await store.fresh(sid);
    await store.fresh(sid);
    expect(owners).toHaveLength(2);
    expect(owners[0]).not.toBe(owners[1]);
  });

  it('stores sessions with the configured TTL, renewed on refresh', async () => {
    const kv = new MemoryKeyValue();
    const store = new SessionStore(cfg, kv, {
      insecureNoEncryptionForTests: true,
      ttlSeconds: 1234,
      refresh: async (_c, s) => ({ ...s, expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    });
    const sid = await store.create(expiring());
    const key = `gw:admin-bff:session:${sid}`;
    expect(Math.round((kv.data.get(key)!.expiresAt - Date.now()) / 1000)).toBe(1234);
    kv.data.get(key)!.expiresAt = Date.now() + 5000;
    await store.fresh(sid);
    expect(Math.round((kv.data.get(key)!.expiresAt - Date.now()) / 1000)).toBe(1234);
  });

  it('keys everything under gw:admin-bff:', async () => {
    const kv = new MemoryKeyValue();
    const store = new SessionStore(cfg, kv, {
      insecureNoEncryptionForTests: true, refresh: async (_c, s) => s });
    await store.create(expiring());
    expect([...kv.data.keys()].every((k) => k.startsWith('gw:admin-bff:'))).toBe(true);
  });
});
