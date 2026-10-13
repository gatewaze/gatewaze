// acquire() safety: a stored or minted session is bound to the host's IdP
// subject, a mint can't outlive its create lock, a sign-out wins over a mint
// in flight, and the lock release never hides the mint's own outcome.
import { describe, expect, it } from 'vitest';
import { deriveKeys } from '../src/keys.js';
import { type CoreLogger, type GwSession, type HostSessionConfig, RefreshUnavailableError, SessionEndedError, SessionUnavailableError } from '../src/session.js';
import type { Redis } from 'ioredis';
import {
  CREATE_LOCK_MS,
  MINT_TIMEOUT_MS,
  RedisKeyValue,
  SIGNED_OUT_TTL_SECONDS,
  SessionStore,
  type SessionStoreOptions,
  isGwSession,
} from '../src/store.js';
import { MemoryKeyValue } from './helpers/fakes.js';

const cfg: HostSessionConfig = { supabaseUrl: 'http://x', anonKey: 'a' };
const KEYS = deriveKeys([Buffer.alloc(32, 7)], 'store');
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const session = (token: string, sub?: string, ttl = 3600): GwSession => ({
  access_token: token,
  refresh_token: `r-${token}`,
  expires_at: now() + ttl,
  user_id: 'u',
  is_admin: true,
  admin_check: 'ok',
  ...(sub === undefined ? {} : { sub }),
});

function setup(opts: SessionStoreOptions = {}, kv = new MemoryKeyValue()) {
  const revoked: GwSession[] = [];
  const warnings: string[] = [];
  const log: CoreLogger = { warn: (_o, msg) => warnings.push(msg) };
  const store = new SessionStore(cfg, kv, {
    keys: KEYS,
    log,
    revoke: async (_c, s) => {
      revoked.push(s);
    },
    ...opts,
  });
  return { kv, store, revoked, warnings };
}

describe('identity binding', () => {
  it('ends a stored session for another subject, revokes it, and mints for the expected one', async () => {
    const { store, revoked, kv } = setup();
    await store.start();
    await store.put('sid-1', session('alice-token', 'alice'));
    const announced = new Promise<void>((r) => store.onDelete('sid-1', r));
    let mints = 0;
    const s = await store.acquire(
      'sid-1',
      async () => {
        mints++;
        return session('bob-token', 'bob');
      },
      { expectedSub: 'bob' },
    );
    await announced;
    expect(mints).toBe(1);
    expect(s.access_token).toBe('bob-token');
    expect(revoked.map((r) => r.access_token)).toEqual(['alice-token']);
    expect((await store.get('sid-1'))?.sub).toBe('bob');
    // Not a sign-out: no tombstone.
    expect(await kv.get('gw:admin-bff:signed-out:sid-1')).toBeNull();
  });

  it('get() returns a matching session and treats a mismatched one, or one without a subject, as missing', async () => {
    const { store } = setup();
    await store.put('sid-1', session('t', 'alice'));
    expect((await store.get('sid-1', { expectedSub: 'alice' }))?.access_token).toBe('t');
    expect(await store.get('sid-1', { expectedSub: 'mallory' })).toBeNull();
    expect(await store.get('sid-1')).toBeNull();
    await store.put('sid-2', session('t2'));
    expect(await store.get('sid-2', { expectedSub: 'alice' })).toBeNull();
  });

  it('fresh() applies expectedSub too', async () => {
    const { store } = setup();
    await store.put('sid-1', session('t', 'alice'));
    expect(await store.fresh('sid-1', { expectedSub: 'bob' })).toBeNull();
  });

  it('revokes and refuses a minted session for another subject, storing nothing', async () => {
    const { store, revoked } = setup();
    const e = await store.acquire('sid-1', async () => session('x', 'mallory'), { expectedSub: 'alice' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SessionEndedError);
    expect(revoked.map((r) => r.access_token)).toEqual(['x']);
    expect(await store.get('sid-1')).toBeNull();
  });

  it('accepts a sub field only as a string', () => {
    const base = { access_token: 'a', refresh_token: 'r', expires_at: 1, user_id: 'u', is_admin: true };
    expect(isGwSession({ ...base, sub: 'idp|1' })).toBe(true);
    expect(isGwSession({ ...base, sub: 42 })).toBe(false);
  });
});

describe('mint deadline', () => {
  it('gives up on a mint that outruns its deadline, and revokes the late result instead of storing it', async () => {
    const { kv, store, revoked } = setup({ mintTimeoutMs: 150 });
    const started = Date.now();
    const e = await store
      .acquire('sid-1', async () => {
        await sleep(400);
        return session('late');
      })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SessionUnavailableError);
    expect(Date.now() - started).toBeLessThan(380);
    expect(await kv.get('gw:admin-bff:create-lock:sid-1')).toBeNull();
    await sleep(350);
    expect(revoked.map((r) => r.access_token)).toEqual(['late']);
    expect(await store.get('sid-1')).toBeNull();
  });

  it('keeps the default mint deadline inside the create lock, and refuses one that is not', () => {
    expect(MINT_TIMEOUT_MS).toBeLessThan(CREATE_LOCK_MS);
    expect(() => setup({ mintTimeoutMs: CREATE_LOCK_MS })).toThrow(/mintTimeoutMs/);
    expect(() => setup({ mintTimeoutMs: 0 })).toThrow(/mintTimeoutMs/);
  });
});

describe('sign-out during a mint', () => {
  it('revokes the minted session and stores nothing when delete() lands mid-mint', async () => {
    const { store, revoked } = setup();
    const pending = store.acquire('sid-1', async () => {
      await sleep(250);
      return session('minted');
    });
    await sleep(80);
    // The host's sign-out route: nothing to revoke yet, then delete.
    expect(await store.get('sid-1')).toBeNull();
    await store.delete('sid-1');
    const e = await pending.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SessionEndedError);
    expect(revoked.map((r) => r.access_token)).toEqual(['minted']);
    expect(await store.get('sid-1')).toBeNull();
  });

  it('refuses to mint on a signed-out session ID until the tombstone expires', async () => {
    const { kv, store } = setup();
    await store.delete('sid-1');
    const tomb = kv.data.get('gw:admin-bff:signed-out:sid-1');
    expect(tomb).toBeDefined();
    expect((tomb?.expiresAt ?? 0) - Date.now()).toBeGreaterThan(CREATE_LOCK_MS);
    expect(SIGNED_OUT_TTL_SECONDS * 1000).toBeGreaterThan(CREATE_LOCK_MS);
    let mints = 0;
    const e = await store
      .acquire('sid-1', async () => {
        mints++;
        return session('x');
      })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SessionEndedError);
    expect(mints).toBe(0);
  });
});

describe('create lock handling', () => {
  it('revokes the mint and leaves the lock alone when another owner holds it by the time the mint ends', async () => {
    const { kv, store, revoked } = setup();
    const e = await store
      .acquire('sid-1', async () => {
        // The lock expired and someone else took it.
        await kv.set('gw:admin-bff:create-lock:sid-1', 'someone-else', 60);
        return session('mine');
      })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SessionUnavailableError);
    expect(revoked.map((r) => r.access_token)).toEqual(['mine']);
    expect(await store.get('sid-1')).toBeNull();
    // Released only if still ours (delIfEquals, not del).
    expect(await kv.get('gw:admin-bff:create-lock:sid-1')).toBe('someone-else');
  });

  it('a failed lock release does not replace the mint error', async () => {
    class FailingRelease extends MemoryKeyValue {
      async delIfEquals(): Promise<void> {
        throw new Error('redis gone');
      }
    }
    const { store, warnings } = setup({}, new FailingRelease());
    const boom = new Error('grant refused');
    await expect(
      store.acquire('sid-1', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(warnings).toContain('could not release the create lock; it will expire');
  });

  it('a failed lock release does not replace a successful mint', async () => {
    class FailingRelease extends MemoryKeyValue {
      async delIfEquals(): Promise<void> {
        throw new Error('redis gone');
      }
    }
    const { store } = setup({}, new FailingRelease());
    expect((await store.acquire('sid-1', async () => session('ok'))).access_token).toBe('ok');
  });

  it('re-checks under the lock: a session stored while it waited for the lock is returned, not minted again', async () => {
    const shared = new MemoryKeyValue();
    const other = setup({}, shared).store;
    let otherMints = 0;
    let ourMints = 0;
    // Our store's KeyValue: before it takes the create lock, another
    // instance mints and stores the session (after our first read).
    class LateLock extends MemoryKeyValue {
      data = shared.data;
      subscribers = shared.subscribers;
      private first = true;
      async setIfAbsent(key: string, value: string, ttlMs: number) {
        if (this.first && key.includes('create-lock')) {
          this.first = false;
          await other.acquire('sid-1', async () => {
            otherMints++;
            return session('from-other');
          });
        }
        return super.setIfAbsent(key, value, ttlMs);
      }
    }
    const ours = setup({}, new LateLock()).store;
    const s = await ours.acquire('sid-1', async () => {
      ourMints++;
      return session('from-us');
    });
    expect(s.access_token).toBe('from-other');
    expect(otherMints + ourMints).toBe(1);
  });
});

describe('keyPrefix validation', () => {
  it('rejects an empty prefix', () => {
    expect(() => setup({ keyPrefix: '' })).toThrow(/keyPrefix/);
  });
});

describe('round-2 hardening', () => {
  it('re-reads under the create lock with expectedSub: a session for another subject stored in the race window is ended', async () => {
    const shared = new MemoryKeyValue();
    const other = setup({}, shared).store;
    class RaceWindow extends MemoryKeyValue {
      data = shared.data;
      subscribers = shared.subscribers;
      private first = true;
      async setIfAbsent(key: string, value: string, ttlMs: number) {
        if (this.first && key.includes('create-lock')) {
          this.first = false;
          await other.put('sid-1', session('mallory-token', 'mallory'));
        }
        return super.setIfAbsent(key, value, ttlMs);
      }
    }
    const { store, revoked } = setup({}, new RaceWindow());
    const s = await store.acquire('sid-1', async () => session('bob-token', 'bob'), { expectedSub: 'bob' });
    expect(s.access_token).toBe('bob-token');
    expect(revoked.map((r) => r.access_token)).toEqual(['mallory-token']);
  });

  it('re-reads under the refresh lock with expectedSub: a session for another subject stored in the race window is not refreshed or returned', async () => {
    const shared = new MemoryKeyValue();
    const other = setup({}, shared).store;
    class RaceWindow extends MemoryKeyValue {
      data = shared.data;
      subscribers = shared.subscribers;
      private first = true;
      async setIfAbsent(key: string, value: string, ttlMs: number) {
        if (this.first && key.includes('refresh-lock')) {
          this.first = false;
          await other.put('sid-1', session('mallory-token', 'mallory', 30));
        }
        return super.setIfAbsent(key, value, ttlMs);
      }
    }
    let refreshes = 0;
    const { store } = setup(
      {
        refresh: async (_c, cur) => {
          refreshes++;
          return { ...cur, access_token: `${cur.access_token}-renewed`, expires_at: now() + 3600 };
        },
      },
      new RaceWindow(),
    );
    await store.put('sid-1', session('alice-token', 'alice', 30));
    const result = await store.fresh('sid-1', { expectedSub: 'alice' });
    expect(result).toBeNull();
    // Only the best-effort refresh before revoking mallory's session ran;
    // nothing was refreshed for the caller.
    expect(refreshes).toBe(1);
    expect(await store.get('sid-1')).toBeNull();
  });

  it('refreshes an expiring mismatched session before revoking it, so GoTrue accepts the logout', async () => {
    const { store, revoked } = setup({
      refresh: async (_c, cur) => ({ ...cur, access_token: 'renewed-token', expires_at: now() + 3600 }),
    });
    await store.put('sid-1', session('old-token', 'mallory', 30));
    expect(await store.get('sid-1', { expectedSub: 'alice' })).toBeNull();
    expect(revoked.map((r) => r.access_token)).toEqual(['renewed-token']);
  });

  it('revokes with the stored token, and logs, when that refresh fails', async () => {
    const { store, revoked, warnings } = setup({
      refresh: async () => {
        throw new RefreshUnavailableError('down');
      },
    });
    await store.put('sid-1', session('old-token', 'mallory', 30));
    expect(await store.get('sid-1', { expectedSub: 'alice' })).toBeNull();
    expect(revoked.map((r) => r.access_token)).toEqual(['old-token']);
    expect(warnings).toContain('could not refresh a session before revoking it');
  });

  it('does not refresh a mismatched session whose token is still good', async () => {
    let refreshes = 0;
    const { store, revoked } = setup({
      refresh: async (_c, cur) => {
        refreshes++;
        return cur;
      },
    });
    await store.put('sid-1', session('good-token', 'mallory'));
    expect(await store.get('sid-1', { expectedSub: 'alice' })).toBeNull();
    expect(refreshes).toBe(0);
    expect(revoked.map((r) => r.access_token)).toEqual(['good-token']);
  });

  it('revokes the minted session when the create script fails, and rethrows its error', async () => {
    const blip = new Error('redis blip');
    class FailingScript extends MemoryKeyValue {
      async setIfLockHeld(): Promise<never> {
        throw blip;
      }
    }
    const { store, revoked } = setup({}, new FailingScript());
    await expect(store.acquire('sid-1', async () => session('minted'))).rejects.toBe(blip);
    expect(revoked.map((r) => r.access_token)).toEqual(['minted']);
  });

  it('throws on an unexpected reply from the create script instead of accepting it', async () => {
    for (const reply of [1, 'OK', null]) {
      const fake = { eval: async () => reply } as unknown as Redis;
      const kv = new RedisKeyValue(fake);
      await expect(kv.setIfLockHeld('k', 'v', 60, 'l', 'o', 'b')).rejects.toThrow(/unexpected reply/);
    }
  });

  it('a failed refresh-lock release does not replace a successful refresh', async () => {
    class FailingRelease extends MemoryKeyValue {
      async delIfEquals(): Promise<void> {
        throw new Error('redis gone');
      }
    }
    const { store, warnings } = setup(
      { refresh: async (_c, cur) => ({ ...cur, access_token: 'renewed', expires_at: now() + 3600 }) },
      new FailingRelease(),
    );
    await store.put('sid-1', session('old', undefined, 30));
    expect((await store.fresh('sid-1'))?.access_token).toBe('renewed');
    expect(warnings).toContain('could not release the refresh lock; it will expire');
  });

  it('a failed refresh-lock release does not replace the refresh error', async () => {
    class FailingRelease extends MemoryKeyValue {
      async delIfEquals(): Promise<void> {
        throw new Error('redis gone');
      }
    }
    const down = new RefreshUnavailableError('GoTrue down');
    const { store } = setup(
      {
        refresh: async () => {
          throw down;
        },
      },
      new FailingRelease(),
    );
    await store.put('sid-1', session('old', undefined, 30));
    await expect(store.fresh('sid-1')).rejects.toBe(down);
  });

  it('logs the error of a mint that fails after its deadline', async () => {
    const { store, warnings } = setup({ mintTimeoutMs: 100 });
    await expect(
      store.acquire('sid-1', async () => {
        await sleep(250);
        throw new Error('late failure');
      }),
    ).rejects.toBeInstanceOf(SessionUnavailableError);
    await sleep(250);
    expect(warnings).toContain('a mint failed after its deadline');
  });
});
