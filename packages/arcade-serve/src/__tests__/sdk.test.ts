import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

// The SDK is plain browser JS with no build step. It is loaded here into a fake
// `globalThis` (shadowed by a function parameter) so it runs in this realm with
// a stubbed window, localStorage, fetch and timers.

const SDK_SOURCE = readFileSync(fileURLToPath(new URL('../../sdk/gatewaze-arcade.js', import.meta.url)), 'utf8');
/** Source with comments stripped, so assertions look at code and not prose. */
const SDK_CODE = SDK_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/[^\n]*$/gm, '');

/** Let every queued microtask (and any `then` chain behind fetch) settle. */
function drain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface Posted {
  message: Record<string, unknown>;
  targetOrigin: string;
}

interface FakeRoot {
  root: Record<string, unknown>;
  store: Map<string, string>;
  listeners: Map<string, Array<(event: unknown) => void>>;
  posted: Posted[];
  fetches: Array<{ url: string; init: Record<string, unknown> }>;
  tick(ms: number): void;
  emit(type: string, event?: unknown): void;
  warnings: string[];
  setFetch(fn: (url: string, init: Record<string, unknown>) => unknown): void;
}

function makeRoot(options: { framed?: boolean; protocol?: string } = {}): FakeRoot {
  const store = new Map<string, string>();
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const posted: Posted[] = [];
  const fetches: Array<{ url: string; init: Record<string, unknown> }> = [];
  const warnings: string[] = [];

  let clock = 0;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();

  let fetchImpl: ((url: string, init: Record<string, unknown>) => unknown) | null = null;

  const parent = options.framed
    ? { postMessage: (message: Record<string, unknown>, targetOrigin: string) => posted.push({ message, targetOrigin }) }
    : null;

  const root: Record<string, unknown> = {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
    },
    console: { warn: (message: string) => warnings.push(message) },
    location: { protocol: options.protocol ?? 'file:' },
    document: { visibilityState: 'visible' },
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextTimer++;
      timers.set(id, { at: clock + (ms ?? 0), fn });
      return id;
    },
    clearTimeout: (id: number) => void timers.delete(id),
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(fn);
    },
    fetch: (url: string, init: Record<string, unknown>) => {
      fetches.push({ url, init });
      if (!fetchImpl) return Promise.reject(new Error('no network'));
      return Promise.resolve(fetchImpl(url, init));
    },
  };
  // A top-level window has `window.parent === window`.
  root.parent = parent ?? root;

  return {
    root,
    store,
    listeners,
    posted,
    fetches,
    warnings,
    setFetch(fn) {
      fetchImpl = fn;
    },
    tick(ms: number) {
      clock += ms;
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.at <= clock) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    emit(type: string, event?: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
}

function loadSdk(root: Record<string, unknown>) {
  // `globalThis` is shadowed by the parameter, so the SDK binds to our stub.
  const factory = new Function('globalThis', `${SDK_SOURCE}\nreturn globalThis.GatewazeArcade;`);
  return factory(root) as { init: (options: { game: string }) => Promise<Arcade>; version: string };
}

interface Arcade {
  mode: string;
  signedIn: boolean;
  user: { profileName: string | null; avatarUrl: string | null } | null;
  load(): Promise<Record<string, unknown>>;
  save(state: unknown): Promise<unknown>;
  submitScore(score: unknown): Promise<{ bestScore: number; rank: number | null }>;
  setDisplayName(name: unknown): Promise<string | null>;
  leaderboard(): Promise<Array<{ rank: number; displayName: string; score: number }>>;
  requestSignIn(): void;
  on(event: string, fn: (payload: unknown) => void): () => void;
  flush(): Promise<unknown>;
}

const HELLO = {
  gw: 1,
  type: 'arcade:hello',
  nonce: 'nonce-1',
  user: { profileName: 'Dan', avatarUrl: null },
  token: 'GAME-TOKEN-abc123',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  stateUrl: 'https://aaif.dev/api/modules/arcade/state',
  leaderboardUrl: 'https://aaif.dev/api/modules/arcade/leaderboard/mcp-quest',
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe('local mode (no portal host)', () => {
  let env: FakeRoot;
  let arcade: Arcade;

  beforeEach(async () => {
    env = makeRoot();
    arcade = await loadSdk(env.root).init({ game: 'mcp-quest' });
  });

  it('falls back to local mode with no parent window', () => {
    expect(arcade.mode).toBe('local');
    expect(arcade.signedIn).toBe(false);
    expect(arcade.user).toBeNull();
  });

  it('round-trips state through namespaced localStorage', async () => {
    await arcade.save({ level: 3, answers: ['a', 'b'] });
    expect(env.store.has('gw:mcp-quest:state')).toBe(true);
    expect(JSON.parse(env.store.get('gw:mcp-quest:state')!)).toEqual({ level: 3, answers: ['a', 'b'] });
    expect(await arcade.load()).toEqual({ level: 3, answers: ['a', 'b'] });
  });

  it('returns {} when nothing is saved yet', async () => {
    expect(await arcade.load()).toEqual({});
  });

  it('keeps a working local hall of fame', async () => {
    expect(await arcade.submitScore(120)).toEqual({ bestScore: 120, rank: 1 });
    await arcade.setDisplayName('DAN');
    const board = await arcade.leaderboard();
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ rank: 1, displayName: 'DAN', score: 120 });
    expect(env.store.has('gw:mcp-quest:board')).toBe(true);
  });

  it('keeps only the best score', async () => {
    await arcade.submitScore(200);
    expect(await arcade.submitScore(50)).toEqual({ bestScore: 200, rank: 1 });
  });

  it('clears the alias on an empty name', async () => {
    await arcade.submitScore(10);
    await arcade.setDisplayName('Tester');
    expect(await arcade.leaderboard()).toHaveLength(1);
    expect(await arcade.setDisplayName('   ')).toBeNull();
    expect(await arcade.leaderboard()).toHaveLength(0);
  });

  it('truncates an over-long alias rather than failing', async () => {
    await arcade.submitScore(1);
    const name = await arcade.setDisplayName('x'.repeat(80));
    expect(name).toHaveLength(40);
  });

  it('never throws on nonsense input', async () => {
    await expect(arcade.save(null)).resolves.toBe(false);
    await expect(arcade.save('nope')).resolves.toBe(false);
    await expect(arcade.submitScore('not a number')).resolves.toEqual({ bestScore: 0, rank: 1 });
    await expect(arcade.submitScore(-5)).resolves.toEqual({ bestScore: 0, rank: 1 });
    await expect(arcade.setDisplayName(undefined)).resolves.toBeNull();
    expect(() => arcade.requestSignIn()).not.toThrow();
  });

  it('makes no network calls at all', async () => {
    await arcade.load();
    await arcade.save({ a: 1 });
    await arcade.leaderboard();
    expect(env.fetches).toHaveLength(0);
  });

  it('survives localStorage being unavailable', async () => {
    const blocked = makeRoot();
    (blocked.root as Record<string, unknown>).localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const offline = await loadSdk(blocked.root).init({ game: 'mcp-quest' });
    await expect(offline.save({ a: 1 })).resolves.toBe(true);
    await expect(offline.load()).resolves.toEqual({});
  });

  it('falls back to a safe slug when init is misused', async () => {
    const other = makeRoot();
    const bad = await loadSdk(other.root).init({ game: '../etc/passwd' } as { game: string });
    expect(bad.mode).toBe('local');
    await bad.save({ a: 1 });
    expect([...other.store.keys()]).toEqual(['gw:unknown-game:state']);
  });
});

describe('handshake', () => {
  it('posts arcade:ready and enters portal mode on a valid hello', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    const pending = loadSdk(env.root).init({ game: 'mcp-quest' });

    expect(env.posted[0].message).toEqual({ gw: 1, type: 'arcade:ready', sdk: '1.0' });

    env.emit('message', { source: env.root.parent, origin: 'https://aaif.dev', data: HELLO });
    const arcade = await pending;

    expect(arcade.mode).toBe('portal');
    expect(arcade.signedIn).toBe(true);
    expect(arcade.user).toEqual({ profileName: 'Dan', avatarUrl: null });
  });

  it('never writes the token to any storage', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    const pending = loadSdk(env.root).init({ game: 'mcp-quest' });
    env.emit('message', { source: env.root.parent, origin: 'https://aaif.dev', data: HELLO });
    const arcade = await pending;
    await arcade.save({ level: 1 });

    for (const value of env.store.values()) expect(value).not.toContain('GAME-TOKEN');
    for (const key of env.store.keys()) expect(key).not.toContain('token');
  });

  it('echoes the handshake nonce on every message back to the host', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    const pending = loadSdk(env.root).init({ game: 'mcp-quest' });
    env.emit('message', { source: env.root.parent, origin: 'https://aaif.dev', data: HELLO });
    const arcade = await pending;

    arcade.requestSignIn();
    const last = env.posted[env.posted.length - 1];
    expect(last.message).toEqual({ gw: 1, type: 'arcade:request-signin', nonce: 'nonce-1' });
    expect(last.targetOrigin).toBe('https://aaif.dev');
  });

  it('ignores a hello from an unacceptable origin and times out to local mode', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    const pending = loadSdk(env.root).init({ game: 'mcp-quest' });

    env.emit('message', { source: env.root.parent, origin: 'http://evil.example.com', data: HELLO });
    env.tick(800);

    const arcade = await pending;
    expect(arcade.mode).toBe('local');
  });

  it('ignores a hello from a window that is not the parent', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    const pending = loadSdk(env.root).init({ game: 'mcp-quest' });

    env.emit('message', { source: { postMessage() {} }, origin: 'https://aaif.dev', data: HELLO });
    env.tick(800);

    expect((await pending).mode).toBe('local');
  });

  it('stays in local mode for a signed-out hello but keeps the bridge', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    const pending = loadSdk(env.root).init({ game: 'mcp-quest' });
    env.emit('message', {
      source: env.root.parent,
      origin: 'https://aaif.dev',
      data: { ...HELLO, user: null, token: null },
    });
    const arcade = await pending;

    expect(arcade.mode).toBe('local');
    expect(arcade.signedIn).toBe(false);

    arcade.requestSignIn();
    expect(env.posted[env.posted.length - 1].message.type).toBe('arcade:request-signin');
  });

  it('times out to local mode when the host never answers', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    const pending = loadSdk(env.root).init({ game: 'mcp-quest' });
    env.tick(800);
    expect((await pending).mode).toBe('local');
  });

  it('requests a fresh token five minutes before expiry', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    const pending = loadSdk(env.root).init({ game: 'mcp-quest' });
    env.emit('message', { source: env.root.parent, origin: 'https://aaif.dev', data: HELLO });
    await pending;

    env.tick(3600_000 - 5 * 60_000);
    expect(env.posted.some((p) => p.message.type === 'arcade:request-token')).toBe(true);
  });
});

describe('portal mode behaviour', () => {
  async function portalArcade(env: FakeRoot): Promise<Arcade> {
    const pending = loadSdk(env.root).init({ game: 'mcp-quest' });
    env.emit('message', { source: env.root.parent, origin: 'https://aaif.dev', data: HELLO });
    return pending;
  }

  it('debounces saves by two seconds and sends the bearer token', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    env.setFetch(() => jsonResponse(200, { bestScore: 0 }));
    const arcade = await portalArcade(env);

    await arcade.save({ level: 1 });
    await arcade.save({ level: 2 });
    expect(env.fetches).toHaveLength(0);

    env.tick(2000);
    await Promise.resolve();

    expect(env.fetches).toHaveLength(1);
    expect(env.fetches[0].init.method).toBe('PUT');
    expect((env.fetches[0].init.headers as Record<string, string>).Authorization).toBe('Bearer GAME-TOKEN-abc123');
    expect(JSON.parse(env.fetches[0].init.body as string)).toEqual({ state: { level: 2 } });
  });

  it('flushes a pending save on pagehide with keepalive', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    env.setFetch(() => jsonResponse(200, {}));
    const arcade = await portalArcade(env);

    await arcade.save({ level: 9 });
    expect(env.fetches).toHaveLength(0);

    env.emit('pagehide');
    await Promise.resolve();

    expect(env.fetches).toHaveLength(1);
    expect(env.fetches[0].init.keepalive).toBe(true);
    expect((env.fetches[0].init.headers as Record<string, string>).Authorization).toBe('Bearer GAME-TOKEN-abc123');
  });

  it('flushes on visibilitychange to hidden', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    env.setFetch(() => jsonResponse(200, {}));
    const arcade = await portalArcade(env);

    await arcade.save({ level: 4 });
    (env.root.document as { visibilityState: string }).visibilityState = 'hidden';
    env.emit('visibilitychange');
    await Promise.resolve();

    expect(env.fetches).toHaveLength(1);
    expect(env.fetches[0].init.keepalive).toBe(true);
  });

  it('drops to local mode and emits change on 401', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    env.setFetch(() => jsonResponse(401, { error: { code: 'token_invalid_or_expired' } }));
    const arcade = await portalArcade(env);

    const changes: unknown[] = [];
    arcade.on('change', (payload) => changes.push(payload));

    const result = await arcade.submitScore(50);
    expect(arcade.mode).toBe('local');
    expect(arcade.signedIn).toBe(false);
    expect(changes).toHaveLength(1);
    // The score still lands in the local hall of fame — no data loss.
    expect(result.bestScore).toBe(50);
  });

  it('keeps the local copy and warns on 413', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    env.setFetch(() => jsonResponse(413, { error: { code: 'state_too_large' } }));
    const arcade = await portalArcade(env);

    await arcade.save({ big: 'x' });
    env.tick(2000);
    await drain();

    expect(arcade.mode).toBe('portal');
    expect(JSON.parse(env.store.get('gw:mcp-quest:state')!)).toEqual({ big: 'x' });
    expect(env.warnings.join(' ')).toContain('state too large');
  });

  it('reads the leaderboard from the API', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    env.setFetch((url) =>
      url.includes('leaderboard')
        ? jsonResponse(200, { entries: [{ rank: 1, displayName: 'Ada', score: 900, at: '2026-08-01T00:00:00Z' }] })
        : jsonResponse(200, {}),
    );
    const arcade = await portalArcade(env);
    const board = await arcade.leaderboard();
    expect(board).toEqual([{ rank: 1, displayName: 'Ada', score: 900, at: '2026-08-01T00:00:00Z' }]);
  });

  it('backs off on 429 honouring Retry-After', async () => {
    const env = makeRoot({ framed: true, protocol: 'https:' });
    let calls = 0;
    env.setFetch(() => {
      calls += 1;
      return calls === 1
        ? jsonResponse(429, { error: { code: 'rate_limited' } }, { 'Retry-After': '3' })
        : jsonResponse(200, { bestScore: 70, rank: 2 });
    });
    const arcade = await portalArcade(env);

    const pending = arcade.submitScore(70);
    await drain();
    expect(calls).toBe(1);

    env.tick(3000);
    expect(await pending).toEqual({ bestScore: 70, rank: 2 });
    expect(calls).toBe(2);
  });
});

describe('SDK source guarantees', () => {
  it('never touches sessionStorage, indexedDB or document.cookie', () => {
    expect(SDK_CODE).not.toMatch(/sessionStorage/);
    expect(SDK_CODE).not.toMatch(/indexedDB/i);
    expect(SDK_CODE).not.toMatch(/document\s*\.\s*cookie/);
  });

  it('only ever writes the two documented namespaced keys', () => {
    const keys = [...SDK_CODE.matchAll(/'gw:' \+ game \+ ':([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(['board', 'state']);
  });

  it('has exactly one setItem call site, and it is the JSON writer', () => {
    expect([...SDK_CODE.matchAll(/\.setItem\(/g)]).toHaveLength(1);
    expect(SDK_CODE).toContain('s.setItem(key, JSON.stringify(value));');
  });
});
