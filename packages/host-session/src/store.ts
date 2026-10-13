// Server-side session store in Redis/Valkey. The browser's cookie holds only a
// session ID (random, or chosen by the host), so HTTP requests and
// long-lived Realtime connections share one GoTrue session, and either can
// refresh it. Ported from the PoC's
// admin/server/core/store.ts, which used @valkey/valkey-glide; this uses
// ioredis (already in the monorepo, and the client the chart's Redis is
// used with) behind a small KeyValue interface so tests can supply a fake.
import crypto from 'node:crypto';
import { SEALED_PREFIX, open, seal } from './keys.js';
import { Redis } from 'ioredis';
import {
  type CoreLogger,
  type GwSession,
  type HostSessionConfig,
  RefreshUnavailableError,
  SessionEndedError,
  SessionUnavailableError,
  errorMessage,
  logout,
  needsRefresh,
  refreshSession,
} from './session.js';

// Everything this store writes lives under this prefix, so it can share the
// chart's Redis with BullMQ without colliding. It is the admin BFF's
// prefix: every other host must pass its own keyPrefix.
export const KEY_PREFIX = 'gw:admin-bff:';
// Sliding lifetime of an idle session (renewed on each refresh); GoTrue's own
// refresh token limits still apply.
export const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 3600;
// Longer than the worst case of the work it guards: a GoTrue refresh plus
// the admin_profiles check, each bounded at 10 seconds in session.ts.
export const LOCK_MS = 30_000;
// The lock acquire() holds while it mints. A mint is up to three calls (for
// example an IdP refresh, the ID token grant and the admin_profiles check),
// each bounded at 10 seconds, so acquire() gives up on a mint after
// MINT_TIMEOUT_MS, which leaves a margin before the lock expires.
export const CREATE_LOCK_MS = 35_000;
export const MINT_TIMEOUT_MS = 30_000;
// How long a sign-out blocks a mint that was already running for the same
// session ID. Longer than CREATE_LOCK_MS, so no mint can outlive it.
export const SIGNED_OUT_TTL_SECONDS = 300;
const LOCK_POLL_MS = 100;

// The sign-out channel under the default prefix only. A store with its own
// keyPrefix publishes on `${keyPrefix}logout`.
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
  // Atomically sets key (EX ttlSeconds) only while lockKey holds lockValue
  // and blockKey does not exist. Resolves 'ok' when written, 'blocked' when
  // blockKey exists, and 'lock-lost' when lockKey holds anything else.
  setIfLockHeld(
    key: string,
    value: string,
    ttlSeconds: number,
    lockKey: string,
    lockValue: string,
    blockKey: string,
  ): Promise<SetIfLockHeldResult>;
  publish(channel: string, message: string): Promise<void>;
  // Subscribes to channel; resolves once the subscription is active.
  subscribe(channel: string, onMessage: (message: string) => void): Promise<void>;
  close(): Promise<void>;
}

export type SetIfLockHeldResult = 'ok' | 'blocked' | 'lock-lost';

const RELEASE_LOCK = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
// KEYS: session key, lock key, block key. ARGV: value, lock value, TTL.
const SET_IF_LOCK_HELD = `
if redis.call('exists', KEYS[3]) == 1 then return 'blocked' end
if redis.call('get', KEYS[2]) ~= ARGV[2] then return 'lock-lost' end
redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 'ok'`;

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
  async setIfLockHeld(key: string, value: string, ttlSeconds: number, lockKey: string, lockValue: string, blockKey: string) {
    const r = await this.redis.eval(SET_IF_LOCK_HELD, 3, key, lockKey, blockKey, value, lockValue, String(ttlSeconds));
    if (r === 'ok' || r === 'blocked' || r === 'lock-lost') return r;
    throw new Error(`unexpected reply from the create script: ${String(r)}`);
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
    (s.admin_check === undefined || s.admin_check === 'ok' || s.admin_check === 'pending') &&
    (s.sub === undefined || typeof s.sub === 'string')
  );
}

export interface SessionStoreOptions {
  ttlSeconds?: number;
  // Prefix for every key and the sign-out channel. Default KEY_PREFIX, which
  // is the admin BFF's: every other host must set its own. Must not be empty.
  keyPrefix?: string;
  // Store subkeys (deriveKeys(masters, 'store')). Every record is encrypted
  // with the first and decrypted with any, so tokens are never readable in
  // Redis. Required unless insecureNoEncryptionForTests is set.
  keys?: Buffer[];
  // Test-only: store records as plain JSON. Never set outside tests.
  insecureNoEncryptionForTests?: boolean;
  log?: CoreLogger;
  onError?: (err: Error) => void;
  // Injected for tests; defaults to the GoTrue refresh in session.ts.
  refresh?: (cfg: HostSessionConfig, s: GwSession) => Promise<GwSession>;
  // Injected for tests; defaults to logout() in session.ts. Revokes a
  // minted session that acquire() could not store.
  revoke?: (cfg: HostSessionConfig, s: GwSession) => Promise<unknown>;
  // How long acquire() lets one mint run. Default MINT_TIMEOUT_MS. Must be
  // less than CREATE_LOCK_MS.
  mintTimeoutMs?: number;
}

export interface SessionMatchOptions {
  // The IdP subject of the host's signed-in user. A stored session for any
  // other subject (or with none recorded) is ended and treated as missing.
  expectedSub?: string;
}

export interface AcquireOptions extends SessionMatchOptions {
  // How long a caller waits for another caller's mint before giving up with
  // SessionUnavailableError. Default CREATE_LOCK_MS.
  waitMs?: number;
}

export class SessionStore {
  private logoutListeners = new Map<string, Set<() => void>>();
  private ttlSeconds: number;
  private keys: Buffer[] | undefined;
  private refresh: (cfg: HostSessionConfig, s: GwSession) => Promise<GwSession>;
  private revokeSession: (cfg: HostSessionConfig, s: GwSession) => Promise<unknown>;
  private mintTimeoutMs: number;
  private prefix: string;
  private logoutChannel: string;

  constructor(
    private cfg: HostSessionConfig,
    private kv: KeyValue,
    opts: SessionStoreOptions = {},
  ) {
    this.ttlSeconds = opts.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    if (opts.keyPrefix !== undefined && (typeof opts.keyPrefix !== 'string' || opts.keyPrefix === '')) {
      throw new Error('SessionStore keyPrefix must be a non-empty string');
    }
    this.prefix = opts.keyPrefix ?? KEY_PREFIX;
    this.mintTimeoutMs = opts.mintTimeoutMs ?? MINT_TIMEOUT_MS;
    if (!(this.mintTimeoutMs > 0 && this.mintTimeoutMs < CREATE_LOCK_MS)) {
      throw new Error(`SessionStore mintTimeoutMs must be between 0 and ${CREATE_LOCK_MS} ms`);
    }
    this.logoutChannel = `${this.prefix}logout`;
    this.keys = opts.keys?.length ? opts.keys : undefined;
    if (!this.keys && !opts.insecureNoEncryptionForTests) {
      throw new Error('SessionStore needs encryption keys (deriveKeys(masters, "store"))');
    }
    if (opts.log) this.cfg = { ...cfg, log: opts.log };
    this.refresh = opts.refresh ?? refreshSession;
    this.revokeSession = opts.revoke ?? logout;
  }

  // Connects to Redis/Valkey at a redis:// or rediss:// URL and starts the
  // sign-out subscription.
  static async connect(cfg: HostSessionConfig, url: string, opts: SessionStoreOptions & { keys: Buffer[] }): Promise<SessionStore> {
    if (!opts.keys?.length) throw new Error('SessionStore.connect needs encryption keys');
    const store = new SessionStore(cfg, RedisKeyValue.fromUrl(url, opts.onError), opts);
    await store.start();
    return store;
  }

  // Starts listening for sign-outs published by any instance.
  async start(): Promise<void> {
    await this.kv.subscribe(this.logoutChannel, (sid) => {
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

  private sessionKey(sid: string): string {
    return `${this.prefix}session:${sid}`;
  }

  private lockKey(sid: string): string {
    return `${this.prefix}refresh-lock:${sid}`;
  }

  private createLockKey(sid: string): string {
    return `${this.prefix}create-lock:${sid}`;
  }

  private signedOutKey(sid: string): string {
    return `${this.prefix}signed-out:${sid}`;
  }

  // Revokes a session at GoTrue that will not be stored. Never throws:
  // logout() reports its own failures.
  private async revoke(session: GwSession): Promise<void> {
    try {
      await this.revokeSession(this.cfg, session);
    } catch (e) {
      this.cfg.log?.warn({ err: errorMessage(e), user_id: session.user_id }, 'could not revoke an unstored session');
    }
  }

  // Best-effort revoke of a stored session that is being ended. GoTrue's
  // logout authenticates with the access token, so an expired or nearly
  // expired one is refreshed first; if that fails, the stored token is
  // tried as it is. Failures are logged, never thrown.
  private async revokeStored(session: GwSession): Promise<void> {
    let current = session;
    if (needsRefresh(current)) {
      try {
        current = await this.refresh(this.cfg, current);
      } catch (e) {
        this.cfg.log?.warn({ err: errorMessage(e), user_id: session.user_id }, 'could not refresh a session before revoking it');
      }
    }
    await this.revoke(current);
  }

  // Runs mint() for at most mintTimeoutMs, so it ends inside the create lock.
  // A mint that finishes after that is revoked, because nobody will store it.
  private runMint(mint: () => Promise<GwSession>): Promise<GwSession> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new SessionUnavailableError('sign-in took longer than the create lock allows'));
      }, this.mintTimeoutMs);
      Promise.resolve()
        .then(mint)
        .then(
          (session) => {
            if (settled) {
              this.cfg.log?.warn({ user_id: session.user_id }, 'a mint finished after its deadline; revoking it');
              void this.revoke(session);
              return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(session);
          },
          (e: unknown) => {
            if (settled) {
              this.cfg.log?.warn({ err: errorMessage(e) }, 'a mint failed after its deadline');
              return;
            }
            settled = true;
            clearTimeout(timer);
            reject(e);
          },
        );
    });
  }

  // Stores the session under a new random ID and returns the ID.
  async create(session: GwSession): Promise<string> {
    const sid = crypto.randomBytes(32).toString('base64url');
    await this.save(sid, session);
    return sid;
  }

  // Stores the session under an ID the host chose, replacing any session
  // already there. The ID is bound into the record's encryption, so it must
  // be the same ID later passed to get().
  async put(sid: string, session: GwSession): Promise<void> {
    await this.save(sid, session);
  }

  // Returns the session stored under sid (refreshed if needed, as fresh()
  // does), or creates it with mint() when there is none. Only one caller
  // across every instance mints for a given sid at a time: the others poll
  // and get the session it stored. The mint runs under a lock that lasts
  // CREATE_LOCK_MS, and is abandoned after mintTimeoutMs.
  //
  // With expectedSub, a stored session for another IdP subject is ended and
  // replaced, and a minted one for another subject is revoked and refused
  // with SessionEndedError.
  //
  // A sign-out wins over a mint in flight: once delete(sid) has run, the
  // minted session is revoked instead of stored, and acquire() throws
  // SessionEndedError. The same happens for any acquire() on that sid
  // until SIGNED_OUT_TTL_SECONDS have passed, so a host must use a new sid
  // after a sign-out.
  //
  // A mint that throws releases the lock and rethrows to its caller; a
  // waiter then takes the lock and mints for itself. A mint that runs past
  // mintTimeoutMs throws SessionUnavailableError, and its late result is
  // revoked. A waiter that sees no session and can't get the lock before
  // waitMs throws SessionUnavailableError. RefreshUnavailableError from
  // fresh() is passed through, as fresh() throws it.
  async acquire(sid: string, mint: () => Promise<GwSession>, opts: AcquireOptions = {}): Promise<GwSession> {
    const deadline = Date.now() + (opts.waitMs ?? CREATE_LOCK_MS);
    const owner = crypto.randomBytes(16).toString('hex');
    const lock = this.createLockKey(sid);
    const match = { expectedSub: opts.expectedSub };
    for (;;) {
      const existing = await this.fresh(sid, match);
      if (existing) return existing;
      if (await this.kv.setIfAbsent(lock, owner, CREATE_LOCK_MS)) {
        try {
          // Another caller may have stored one between the read and the lock.
          const current = await this.fresh(sid, match);
          if (current) return current;
          if ((await this.kv.get(this.signedOutKey(sid))) !== null) {
            throw new SessionEndedError('this session ID was signed out');
          }
          const minted = await this.runMint(mint);
          if (opts.expectedSub !== undefined && minted.sub !== opts.expectedSub) {
            this.cfg.log?.warn({ user_id: minted.user_id }, 'minted session is for another IdP subject; revoking it');
            await this.revoke(minted);
            throw new SessionEndedError('the minted session is for another identity');
          }
          let outcome: SetIfLockHeldResult;
          try {
            outcome = await this.kv.setIfLockHeld(
              this.sessionKey(sid),
              this.encode(sid, minted),
              this.ttlSeconds,
              lock,
              owner,
              this.signedOutKey(sid),
            );
          } catch (e) {
            // Whether it was written is unknown. Revoke it, so a session
            // nobody can find is not left valid at GoTrue; if it was
            // written, its refresh is refused later and acquire() mints
            // again.
            await this.revoke(minted);
            throw e;
          }
          if (outcome === 'ok') return minted;
          await this.revoke(minted);
          if (outcome === 'blocked') throw new SessionEndedError('signed out while the session was being created');
          throw new SessionUnavailableError('lost the create lock while minting');
        } finally {
          // A failed release must not replace the mint's own result or
          // error; the lock then expires on its own.
          try {
            await this.kv.delIfEquals(lock, owner);
          } catch (e) {
            this.cfg.log?.warn({ err: errorMessage(e) }, 'could not release the create lock; it will expire');
          }
        }
      }
      if (Date.now() >= deadline) break;
      await sleep(LOCK_POLL_MS);
    }
    throw new SessionUnavailableError('timed out waiting for a concurrent sign-in');
  }

  private encode(sid: string, session: GwSession): string {
    const json = JSON.stringify(session);
    return this.keys ? seal(this.keys, json, sid) : json;
  }

  private async save(sid: string, session: GwSession): Promise<void> {
    await this.kv.set(this.sessionKey(sid), this.encode(sid, session), this.ttlSeconds);
  }

  // Writes a refreshed session only if it still exists, so a sign-out that
  // lands during a refresh wins and the session is not brought back.
  private async update(sid: string, session: GwSession): Promise<boolean> {
    return this.kv.setIfExists(this.sessionKey(sid), this.encode(sid, session), this.ttlSeconds);
  }

  // Returns the stored session, or null. With expectedSub, a session for
  // another IdP subject is ended (revoked, deleted and announced, without a
  // sign-out tombstone) and null is returned.
  async get(sid: string, opts: SessionMatchOptions = {}): Promise<GwSession | null> {
    const stored = await this.kv.get(this.sessionKey(sid));
    if (!stored) return null;
    if (this.keys && !stored.startsWith(SEALED_PREFIX)) {
      // Never read a plaintext record when encryption is on: someone with
      // Redis access could plant one. Delete it and treat it as gone.
      this.cfg.log?.warn({}, 'stored session is not encrypted; deleting it');
      await this.kv.del(this.sessionKey(sid));
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
      this.cfg.log?.warn({ err: errorMessage(e) }, 'stored session is not JSON; treating it as gone');
      return null;
    }
    if (!isGwSession(parsed)) {
      this.cfg.log?.warn({}, 'stored session has the wrong shape; treating it as gone');
      return null;
    }
    if (opts.expectedSub !== undefined && parsed.sub !== opts.expectedSub) {
      this.cfg.log?.warn({ user_id: parsed.user_id }, 'stored session is for another IdP subject; ending it');
      await this.revokeStored(parsed);
      await this.discard(sid);
      return null;
    }
    return parsed;
  }

  // Ends the session for a sign-out: deletes it, tells every instance to
  // close its Realtime connections for it, and blocks any mint already
  // running for this sid from storing its result (see acquire()).
  async delete(sid: string): Promise<void> {
    await this.kv.set(this.signedOutKey(sid), '1', SIGNED_OUT_TTL_SECONDS);
    await this.discard(sid);
  }

  // Deletes the session and announces it, without the sign-out tombstone,
  // so acquire() may mint again on this sid.
  private async discard(sid: string): Promise<void> {
    await this.kv.del(this.sessionKey(sid));
    await this.kv.publish(this.logoutChannel, sid);
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
  // is kept) or the lock can't be had before the deadline. expectedSub is
  // applied as in get().
  async fresh(sid: string, opts: SessionMatchOptions = {}): Promise<GwSession | null> {
    const deadline = Date.now() + LOCK_MS;
    const owner = crypto.randomBytes(16).toString('hex');
    while (Date.now() < deadline) {
      const s = await this.get(sid, opts);
      if (!s) return null;
      if (!needsRefresh(s)) return s;
      if (await this.kv.setIfAbsent(this.lockKey(sid), owner, LOCK_MS)) {
        try {
          // Another caller may have refreshed between the read and the lock.
          const current = await this.get(sid, opts);
          if (!current) return null;
          if (!needsRefresh(current)) return current;
          let renewed: GwSession;
          try {
            renewed = await this.refresh(this.cfg, current);
          } catch (e) {
            if (e instanceof RefreshUnavailableError) throw e;
            this.cfg.log?.warn({ err: errorMessage(e), user_id: current.user_id }, 'refresh refused; ending the session');
            // Not a sign-out: a later acquire() may mint a new session here.
            await this.discard(sid);
            return null;
          }
          // Signed out while GoTrue was answering: stay signed out.
          if (!(await this.update(sid, renewed))) return null;
          return renewed;
        } finally {
          // Release only our own lock: if the refresh outlived LOCK_MS,
          // another caller may hold it by now. A failed release must not
          // replace the refresh's own result or error; the lock then
          // expires on its own.
          try {
            await this.kv.delIfEquals(this.lockKey(sid), owner);
          } catch (e) {
            this.cfg.log?.warn({ err: errorMessage(e) }, 'could not release the refresh lock; it will expire');
          }
        }
      }
      await sleep(LOCK_POLL_MS);
    }
    throw new RefreshUnavailableError('timed out waiting for a concurrent refresh');
  }
}
