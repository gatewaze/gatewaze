// Server-side session store in Redis/Valkey. The browser's cookie holds only a
// random session ID, so HTTP requests and long-lived Realtime connections
// share one GoTrue session, and either can refresh it. Ported from the PoC's
// admin/server/core/store.ts, which used @valkey/valkey-glide; this uses
// ioredis (already in the monorepo, and the client the chart's Redis is
// used with) behind a small KeyValue interface so tests can supply a fake.
import crypto from 'node:crypto';
import { SEALED_PREFIX, open, seal } from './keys.js';
import { Redis } from 'ioredis';
import {
  type BffConfig,
  type CoreLogger,
  type GwSession,
  RefreshUnavailableError,
  needsRefresh,
  refreshSession,
} from './session.js';

// Everything this store writes lives under this prefix, so it can share the
// chart's Redis with BullMQ without colliding.
export const KEY_PREFIX = 'gw:admin-bff:';
// Sliding lifetime of an idle session (renewed on each refresh); GoTrue's own
// refresh token limits still apply.
export const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 3600;
// Longer than the worst case of the work it guards: a GoTrue refresh plus
// the admin_profiles check, each bounded at 10 seconds in session.ts.
export const LOCK_MS = 30_000;
const LOCK_POLL_MS = 100;

const sessionKey = (sid: string) => `${KEY_PREFIX}session:${sid}`;
const lockKey = (sid: string) => `${KEY_PREFIX}refresh-lock:${sid}`;
export const LOGOUT_CHANNEL = `${KEY_PREFIX}logout`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The few Redis operations the store needs.
export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  // SET XX EX: writes only if the key still exists. Resolves true when written.
  setIfExists(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  // SET NX PX. Resolves true when the key was set.
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  del(key: string): Promise<void>;
  // Deletes key only while it still holds value (lock release).
  delIfEquals(key: string, value: string): Promise<void>;
  publish(channel: string, message: string): Promise<void>;
  // Subscribes to channel; resolves once the subscription is active.
  subscribe(channel: string, onMessage: (message: string) => void): Promise<void>;
  close(): Promise<void>;
}

const RELEASE_LOCK = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

// ioredis implementation. A second connection carries the sign-out
// subscription, because a subscribed Redis connection can't run commands.
export class RedisKeyValue implements KeyValue {
  private sub: Redis | null = null;

  constructor(
    private redis: Redis,
    private onError?: (err: Error) => void,
  ) {}

  // url is redis://:password@host:6379 or rediss://... (the chart's
  // REDIS_URL). onError receives connection errors, which ioredis otherwise
  // reports only as an unhandled 'error' event; it retries on its own.
  static fromUrl(url: string, onError?: (err: Error) => void): RedisKeyValue {
    const redis = new Redis(url, { maxRetriesPerRequest: 3 });
    if (onError) redis.on('error', onError);
    return new RedisKeyValue(redis, onError);
  }

  async get(key: string) {
    return this.redis.get(key);
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }
  async setIfAbsent(key: string, value: string, ttlMs: number) {
    return (await this.redis.set(key, value, 'PX', ttlMs, 'NX')) === 'OK';
  }
  async setIfExists(key: string, value: string, ttlSeconds: number) {
    return (await this.redis.set(key, value, 'EX', ttlSeconds, 'XX')) === 'OK';
  }
  async del(key: string) {
    await this.redis.del(key);
  }
  async delIfEquals(key: string, value: string) {
    await this.redis.eval(RELEASE_LOCK, 1, key, value);
  }
  async publish(channel: string, message: string) {
    await this.redis.publish(channel, message);
  }
  async subscribe(channel: string, onMessage: (message: string) => void) {
    if (!this.sub) {
      this.sub = this.redis.duplicate();
      if (this.onError) this.sub.on('error', this.onError);
    }
    this.sub.on('message', (ch: string, msg: string) => {
      if (ch === channel) onMessage(msg);
    });
    await this.sub.subscribe(channel);
  }
  async close() {
    await Promise.allSettled([this.sub?.quit(), this.redis.quit()]);
  }
}

// Checks the shape of a stored session, so a corrupt or foreign value is
// treated as no session rather than used.
export function isGwSession(v: unknown): v is GwSession {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.access_token === 'string' &&
    typeof s.refresh_token === 'string' &&
    typeof s.expires_at === 'number' &&
    typeof s.user_id === 'string' &&
    typeof s.is_admin === 'boolean' &&
    (s.admin_check === undefined || s.admin_check === 'ok' || s.admin_check === 'pending')
  );
}

export interface SessionStoreOptions {
  ttlSeconds?: number;
  // Store subkeys (deriveKeys(masters, 'store')). Every record is encrypted
  // with the first and decrypted with any, so tokens are never readable in
  // Redis. Required unless insecureNoEncryptionForTests is set.
  keys?: Buffer[];
  // Test-only: store records as plain JSON. Never set outside tests.
  insecureNoEncryptionForTests?: boolean;
  log?: CoreLogger;
  onError?: (err: Error) => void;
  // Injected for tests; defaults to the GoTrue refresh in session.ts.
  refresh?: (cfg: BffConfig, s: GwSession) => Promise<GwSession>;
}

export class SessionStore {
  private logoutListeners = new Map<string, Set<() => void>>();
  private ttlSeconds: number;
  private keys: Buffer[] | undefined;
  private refresh: (cfg: BffConfig, s: GwSession) => Promise<GwSession>;

  constructor(
    private cfg: BffConfig,
    private kv: KeyValue,
    opts: SessionStoreOptions = {},
  ) {
    this.ttlSeconds = opts.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    this.keys = opts.keys?.length ? opts.keys : undefined;
    if (!this.keys && !opts.insecureNoEncryptionForTests) {
      throw new Error('SessionStore needs encryption keys (deriveKeys(masters, "store"))');
    }
    if (opts.log) this.cfg = { ...cfg, log: opts.log };
    this.refresh = opts.refresh ?? refreshSession;
  }

  // Connects to Redis/Valkey at a redis:// or rediss:// URL and starts the
  // sign-out subscription.
  static async connect(cfg: BffConfig, url: string, opts: SessionStoreOptions & { keys: Buffer[] }): Promise<SessionStore> {
    if (!opts.keys?.length) throw new Error('SessionStore.connect needs encryption keys');
    const store = new SessionStore(cfg, RedisKeyValue.fromUrl(url, opts.onError), opts);
    await store.start();
    return store;
  }

  // Starts listening for sign-outs published by any instance.
  async start(): Promise<void> {
    await this.kv.subscribe(LOGOUT_CHANNEL, (sid) => {
      for (const fn of [...(this.logoutListeners.get(sid) ?? [])]) fn();
    });
  }

  async close(): Promise<void> {
    await this.kv.close();
  }

  // Sets where the store (and the refreshes it runs) report failures.
  setLogger(log: CoreLogger): void {
    this.cfg = { ...this.cfg, log };
  }

  async create(session: GwSession): Promise<string> {
    const sid = crypto.randomBytes(32).toString('base64url');
    await this.save(sid, session);
    return sid;
  }

  private encode(sid: string, session: GwSession): string {
    const json = JSON.stringify(session);
    return this.keys ? seal(this.keys, json, sid) : json;
  }

  private async save(sid: string, session: GwSession): Promise<void> {
    await this.kv.set(sessionKey(sid), this.encode(sid, session), this.ttlSeconds);
  }

  // Writes a refreshed session only if it still exists, so a sign-out that
  // lands during a refresh wins and the session is not brought back.
  private async update(sid: string, session: GwSession): Promise<boolean> {
    return this.kv.setIfExists(sessionKey(sid), this.encode(sid, session), this.ttlSeconds);
  }

  async get(sid: string): Promise<GwSession | null> {
    const stored = await this.kv.get(sessionKey(sid));
    if (!stored) return null;
    if (this.keys && !stored.startsWith(SEALED_PREFIX)) {
      // Never read a plaintext record when encryption is on: someone with
      // Redis access could plant one. Delete it and treat it as gone.
      this.cfg.log?.warn({}, 'stored session is not encrypted; deleting it');
      await this.kv.del(sessionKey(sid));
      return null;
    }
    const raw = this.keys ? open(this.keys, stored, sid) : stored;
    if (raw === null) {
      this.cfg.log?.warn({}, 'stored session does not decrypt (key removed or record altered); treating it as gone');
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      this.cfg.log?.warn({ err: (e as Error).message }, 'stored session is not JSON; treating it as gone');
      return null;
    }
    if (isGwSession(parsed)) return parsed;
    this.cfg.log?.warn({}, 'stored session has the wrong shape; treating it as gone');
    return null;
  }

  // Deletes the session and tells every BFF instance to close its Realtime
  // connections for it.
  async delete(sid: string): Promise<void> {
    await this.kv.del(sessionKey(sid));
    await this.kv.publish(LOGOUT_CHANNEL, sid);
  }

  // Calls fn when the session is deleted on any instance.
  onDelete(sid: string, fn: () => void): () => void {
    const set = this.logoutListeners.get(sid) ?? new Set();
    set.add(fn);
    this.logoutListeners.set(sid, set);
    return () => {
      set.delete(fn);
      if (!set.size) this.logoutListeners.delete(sid);
    };
  }

  // Returns the session with an access token valid for at least the refresh
  // skew, refreshing it first if needed. Refresh tokens rotate, so a lock
  // makes one caller refresh while the others wait for its result.
  // Returns null, and deletes the session, if GoTrue refuses the refresh.
  // Throws RefreshUnavailableError when GoTrue can't be reached (the session
  // is kept) or the lock can't be had before the deadline.
  async fresh(sid: string): Promise<GwSession | null> {
    const deadline = Date.now() + LOCK_MS;
    const owner = crypto.randomBytes(16).toString('hex');
    while (Date.now() < deadline) {
      const s = await this.get(sid);
      if (!s) return null;
      if (!needsRefresh(s)) return s;
      if (await this.kv.setIfAbsent(lockKey(sid), owner, LOCK_MS)) {
        try {
          // Another caller may have refreshed between the read and the lock.
          const current = await this.get(sid);
          if (!current) return null;
          if (!needsRefresh(current)) return current;
          let renewed: GwSession;
          try {
            renewed = await this.refresh(this.cfg, current);
          } catch (e) {
            if (e instanceof RefreshUnavailableError) throw e;
            this.cfg.log?.warn({ err: (e as Error).message, user_id: current.user_id }, 'refresh refused; ending the session');
            await this.delete(sid);
            return null;
          }
          // Signed out while GoTrue was answering: stay signed out.
          if (!(await this.update(sid, renewed))) return null;
          return renewed;
        } finally {
          // Release only our own lock: if the refresh outlived LOCK_MS,
          // another caller may hold it by now.
          await this.kv.delIfEquals(lockKey(sid), owner);
        }
      }
      await sleep(LOCK_POLL_MS);
    }
    throw new RefreshUnavailableError('timed out waiting for a concurrent refresh');
  }
}
