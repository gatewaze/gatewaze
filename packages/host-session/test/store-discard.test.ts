// discard() versus delete(): both remove the record and announce the
// sign-out, so open sockets close, but only delete() leaves the sign-out
// marker that stops acquire() minting again on the same session ID.
import { describe, expect, it } from 'vitest';
import { deriveKeys } from '../src/keys.js';
import { type GwSession, type HostSessionConfig, SessionEndedError } from '../src/session.js';
import { SessionStore } from '../src/store.js';
import { MemoryKeyValue } from './helpers/fakes.js';

const cfg: HostSessionConfig = { supabaseUrl: 'http://x', anonKey: 'a' };
const KEYS = deriveKeys([Buffer.alloc(32, 7)], 'store');
const now = () => Math.floor(Date.now() / 1000);
const session = (token: string): GwSession => ({
  access_token: token,
  refresh_token: `r-${token}`,
  expires_at: now() + 3600,
  user_id: 'u',
  is_admin: true,
  admin_check: 'ok',
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup(kv: MemoryKeyValue = new MemoryKeyValue()) {
  const revoked: GwSession[] = [];
  const store = new SessionStore(cfg, kv, {
    keys: KEYS,
    keyPrefix: 'lfx:hs:',
    revoke: async (_c, s) => {
      revoked.push(s);
    },
  });
  await store.start();
  return { kv, store, revoked };
}

describe('discard', () => {
  it('removes the record, closes open sockets, and leaves no sign-out marker', async () => {
    const { kv, store, revoked } = await setup();
    await store.put('sid-1', session('old'));
    let closed = 0;
    store.onDelete('sid-1', () => closed++);
    await store.discard('sid-1');
    expect(await store.get('sid-1')).toBeNull();
    expect(closed).toBe(1);
    expect(await kv.get('lfx:hs:signed-out:sid-1')).toBeNull();
    // It does not revoke at GoTrue.
    expect(revoked).toEqual([]);
  });

  it('lets acquire() mint again straight away on the same session ID', async () => {
    const { store } = await setup();
    await store.put('sid-1', session('old'));
    await store.discard('sid-1');
    let mints = 0;
    const s = await store.acquire('sid-1', async () => {
      mints++;
      return session('new');
    });
    expect(mints).toBe(1);
    expect(s.access_token).toBe('new');
    expect((await store.get('sid-1'))?.access_token).toBe('new');
  });
});

describe('delete, by contrast', () => {
  it('removes the record and closes open sockets too, but leaves the marker', async () => {
    const { kv, store } = await setup();
    await store.put('sid-1', session('old'));
    let closed = 0;
    store.onDelete('sid-1', () => closed++);
    await store.delete('sid-1');
    expect(await store.get('sid-1')).toBeNull();
    expect(closed).toBe(1);
    expect(await kv.get('lfx:hs:signed-out:sid-1')).not.toBeNull();
  });

  it('stops acquire() minting on the same session ID', async () => {
    const { store } = await setup();
    await store.put('sid-1', session('old'));
    await store.delete('sid-1');
    let mints = 0;
    const e = await store
      .acquire('sid-1', async () => {
        mints++;
        return session('new');
      })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SessionEndedError);
    expect(mints).toBe(0);
  });
});

describe('guarded discard (onlyIfAccessToken)', () => {
  it('removes the record and closes sockets when it still holds the refused token', async () => {
    const { store } = await setup();
    await store.put('sid-1', session('s1'));
    let closed = 0;
    store.onDelete('sid-1', () => closed++);
    expect(await store.discard('sid-1', { onlyIfAccessToken: 's1' })).toBe(true);
    expect(await store.get('sid-1')).toBeNull();
    expect(closed).toBe(1);
  });

  it('leaves a session another tab has minted since, and announces nothing', async () => {
    const { store } = await setup();
    await store.put('sid-1', session('s2'));
    let closed = 0;
    store.onDelete('sid-1', () => closed++);
    expect(await store.discard('sid-1', { onlyIfAccessToken: 's1' })).toBe(false);
    expect((await store.get('sid-1'))?.access_token).toBe('s2');
    expect(closed).toBe(0);
  });

  it('does nothing when there is no record', async () => {
    const { store } = await setup();
    expect(await store.discard('sid-1', { onlyIfAccessToken: 's1' })).toBe(false);
  });

  it('is atomic: a session written between the read and the delete survives', async () => {
    const shared = new MemoryKeyValue();
    const other = (await setup(shared)).store;
    class WriteInBetween extends MemoryKeyValue {
      data = shared.data;
      subscribers = shared.subscribers;
      async delIfEquals(key: string, value: string): Promise<boolean | void> {
        if (key.endsWith('session:sid-1')) await other.put('sid-1', session('s2'));
        return super.delIfEquals(key, value);
      }
    }
    const { store } = await setup(new WriteInBetween());
    await store.put('sid-1', session('s1'));
    let closed = 0;
    store.onDelete('sid-1', () => closed++);
    expect(await store.discard('sid-1', { onlyIfAccessToken: 's1' })).toBe(false);
    expect((await store.get('sid-1'))?.access_token).toBe('s2');
    expect(closed).toBe(0);
  });

  it('accepts a 1.0 KeyValue whose delIfEquals resolves nothing, and treats the delete as done', async () => {
    class OldKeyValue extends MemoryKeyValue {
      async delIfEquals(key: string, value: string): Promise<boolean | void> {
        await super.delIfEquals(key, value);
      }
    }
    const { store } = await setup(new OldKeyValue());
    await store.put('sid-1', session('s1'));
    let closed = 0;
    store.onDelete('sid-1', () => closed++);
    expect(await store.discard('sid-1', { onlyIfAccessToken: 's1' })).toBe(true);
    expect(closed).toBe(1);
  });
});

describe('discard caveats', () => {
  it('does not clear a sign-out marker: after delete then discard, acquire still refuses', async () => {
    const { store } = await setup();
    await store.put('sid-1', session('old'));
    await store.delete('sid-1');
    await store.discard('sid-1');
    let mints = 0;
    const e = await store
      .acquire('sid-1', async () => {
        mints++;
        return session('new');
      })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SessionEndedError);
    expect(mints).toBe(0);
  });

  it('does not stop a mint already in flight: its result is still stored', async () => {
    const { store } = await setup();
    const pending = store.acquire('sid-1', async () => {
      await sleep(200);
      return session('minted');
    });
    await sleep(50);
    await store.discard('sid-1');
    expect((await pending).access_token).toBe('minted');
    expect((await store.get('sid-1'))?.access_token).toBe('minted');
  });
});
