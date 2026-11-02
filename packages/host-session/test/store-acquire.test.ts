// SessionStore additions for hosts that pick their own session ID: put(),
// the single-flight acquire(), and keyPrefix. Encryption stays required.
import { describe, expect, it } from 'vitest';
import { deriveKeys } from '../src/keys.js';
import { type GwSession, type HostSessionConfig, SessionUnavailableError } from '../src/session.js';
import { CREATE_LOCK_MS, SessionStore, type SessionStoreOptions } from '../src/store.js';
import { MemoryKeyValue } from './helpers/fakes.js';

const cfg: HostSessionConfig = { supabaseUrl: 'http://x', anonKey: 'a' };
const KEYS = deriveKeys([Buffer.alloc(32, 7)], 'store');
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Narrows a value the test has just arranged to exist.
function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('expected a value');
  return v;
}
const session = (token: string, ttl = 3600): GwSession => ({
  access_token: token,
  refresh_token: `r-${token}`,
  expires_at: now() + ttl,
  user_id: 'u',
  is_admin: true,
  admin_check: 'ok',
});

function makeStore(opts: SessionStoreOptions = {}, kv = new MemoryKeyValue()) {
  return { kv, store: new SessionStore(cfg, kv, { keys: KEYS, ...opts }) };
}

describe('put', () => {
  it('stores under the caller-chosen ID and replaces what was there', async () => {
    const { store } = makeStore();
    await store.put('sid-1', session('a'));
    expect((await store.get('sid-1'))?.access_token).toBe('a');
    await store.put('sid-1', session('b'));
    expect((await store.get('sid-1'))?.access_token).toBe('b');
  });

  it('encrypts the record and binds it to the ID', async () => {
    const { kv, store } = makeStore();
    await store.put('sid-1', session('secret-token'));
    const raw = must(kv.data.get('gw:admin-bff:session:sid-1')).value;
    expect(raw.startsWith('v1:')).toBe(true);
    expect(raw).not.toContain('secret-token');
    kv.data.set('gw:admin-bff:session:sid-2', must(kv.data.get('gw:admin-bff:session:sid-1')));
    expect(await store.get('sid-2')).toBeNull();
  });

  it('brings a deleted session back (create-or-replace, unlike a refresh)', async () => {
    const { store } = makeStore();
    await store.put('sid-1', session('a'));
    await store.delete('sid-1');
    await store.put('sid-1', session('b'));
    expect((await store.get('sid-1'))?.access_token).toBe('b');
  });
});

describe('acquire', () => {
  it('mints once for concurrent callers, and every caller gets the minted session', async () => {
    const { kv, store } = makeStore();
    let mints = 0;
    const mint = async () => {
      mints++;
      await sleep(150);
      return session(`minted-${mints}`);
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => store.acquire('sid-1', mint)));
    expect(mints).toBe(1);
    expect(results.map((s) => s.access_token)).toEqual(Array(5).fill('minted-1'));
    expect((await store.get('sid-1'))?.access_token).toBe('minted-1');
    expect([...kv.data.keys()].some((k) => k.includes('create-lock'))).toBe(false);
  });

  it('single-flights across two store instances sharing a Redis', async () => {
    const kv = new MemoryKeyValue();
    const a = makeStore({}, kv).store;
    const b = makeStore({}, kv).store;
    let mints = 0;
    const mint = async () => {
      mints++;
      await sleep(100);
      return session('shared');
    };
    const [x, y] = await Promise.all([a.acquire('sid-1', mint), b.acquire('sid-1', mint)]);
    expect(mints).toBe(1);
    expect(x.access_token).toBe('shared');
    expect(y.access_token).toBe('shared');
  });

  it('returns an existing session without minting', async () => {
    const { store } = makeStore();
    await store.put('sid-1', session('existing'));
    let mints = 0;
    const s = await store.acquire('sid-1', async () => {
      mints++;
      return session('minted');
    });
    expect(s.access_token).toBe('existing');
    expect(mints).toBe(0);
  });

  it('mints again when the stored session ends on refresh', async () => {
    let refreshes = 0;
    const { store } = makeStore({
      refresh: async () => {
        refreshes++;
        throw new Error('GoTrue refused the refresh token (400)');
      },
    });
    await store.put('sid-1', session('old', 30));
    const s = await store.acquire('sid-1', async () => session('new'));
    expect(refreshes).toBe(1);
    expect(s.access_token).toBe('new');
  });

  it('releases the lock when the mint fails, and the next caller can mint', async () => {
    const { kv, store } = makeStore();
    const boom = new Error('grant refused');
    await expect(
      store.acquire('sid-1', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await kv.get('gw:admin-bff:create-lock:sid-1')).toBeNull();
    expect(await store.get('sid-1')).toBeNull();
    const s = await store.acquire('sid-1', async () => session('second'), { waitMs: 200 });
    expect(s.access_token).toBe('second');
  });

  it('a waiter takes over and mints for itself when the holder mint fails', async () => {
    const { store } = makeStore();
    const first = store.acquire('sid-1', async () => {
      await sleep(150);
      throw new Error('upstream down');
    });
    await sleep(20);
    let waiterMints = 0;
    const second = store.acquire('sid-1', async () => {
      waiterMints++;
      return session('from-waiter');
    });
    await expect(first).rejects.toThrow('upstream down');
    expect((await second).access_token).toBe('from-waiter');
    expect(waiterMints).toBe(1);
  });

  it('a waiter times out with SessionUnavailableError while another holds the lock', async () => {
    const { kv, store } = makeStore();
    await kv.setIfAbsent('gw:admin-bff:create-lock:sid-1', 'someone-else', CREATE_LOCK_MS);
    let mints = 0;
    const started = Date.now();
    const e = await store
      .acquire(
        'sid-1',
        async () => {
          mints++;
          return session('x');
        },
        { waitMs: 300 },
      )
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SessionUnavailableError);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(mints).toBe(0);
    // Not ours to release.
    expect(await kv.get('gw:admin-bff:create-lock:sid-1')).toBe('someone-else');
  });

  it('holds the create lock for CREATE_LOCK_MS while minting', async () => {
    const { kv, store } = makeStore();
    let ttlMs = 0;
    await store.acquire('sid-1', async () => {
      ttlMs = must(kv.data.get('gw:admin-bff:create-lock:sid-1')).expiresAt - Date.now();
      return session('x');
    });
    expect(ttlMs).toBeGreaterThan(CREATE_LOCK_MS - 1000);
    expect(CREATE_LOCK_MS).toBeGreaterThan(30_000);
  });
});

describe('keyPrefix', () => {
  it('namespaces the session, both locks and the sign-out channel', async () => {
    const { kv, store } = makeStore({ keyPrefix: 'lfx:hs:' });
    await store.start();
    const seen: string[] = [];
    await store.acquire('sid-1', async () => {
      seen.push(...kv.data.keys());
      return session('a', 30);
    });
    expect(seen).toContain('lfx:hs:create-lock:sid-1');
    expect([...kv.data.keys()]).toEqual(['lfx:hs:session:sid-1']);
    // A refresh takes the prefixed refresh lock.
    const refreshing = makeStore(
      {
        keyPrefix: 'lfx:hs:',
        refresh: async () => {
          seen.push(...kv.data.keys());
          return session('b');
        },
      },
      kv,
    ).store;
    await refreshing.fresh('sid-1');
    expect(seen).toContain('lfx:hs:refresh-lock:sid-1');
    const heard = new Promise<void>((r) => store.onDelete('sid-1', r));
    await store.delete('sid-1');
    await heard;
    expect([...kv.subscribers.keys()]).toEqual(['lfx:hs:logout']);
    expect([...kv.data.keys()].some((k) => k.startsWith('gw:admin-bff:'))).toBe(false);
  });

  it('keeps the admin BFF prefix by default', async () => {
    const { kv, store } = makeStore();
    await store.put('sid-1', session('a'));
    expect([...kv.data.keys()]).toEqual(['gw:admin-bff:session:sid-1']);
  });

  it('does not read a session written under another prefix', async () => {
    const kv = new MemoryKeyValue();
    await makeStore({ keyPrefix: 'lfx:hs:' }, kv).store.put('sid-1', session('a'));
    expect(await makeStore({}, kv).store.get('sid-1')).toBeNull();
  });
});

describe('encryption stays required', () => {
  it('refuses a store without keys, whatever other options are set', () => {
    expect(() => new SessionStore(cfg, new MemoryKeyValue(), { keyPrefix: 'lfx:hs:' })).toThrow(/encryption keys/);
    expect(() => new SessionStore(cfg, new MemoryKeyValue(), { keys: [] })).toThrow(/encryption keys/);
  });
});
