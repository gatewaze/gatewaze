import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The served SDK is pinned to the deployment's portal origin at boot
// (src/index.ts substitutes the placeholder). Without a pin the SDK can only
// shape-check the host origin and leans entirely on `frame-ancestors` CSP;
// these tests hold that second control in place.

const SDK_PATH = fileURLToPath(new URL('../../sdk/gatewaze-arcade.js', import.meta.url));
const SDK_SOURCE = readFileSync(SDK_PATH, 'utf8');
const PLACEHOLDER = '__GATEWAZE_PORTAL_ORIGIN__';

interface Posted {
  message: Record<string, unknown>;
  targetOrigin: string;
}

function makeFramedRoot() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const posted: Posted[] = [];
  const store = new Map<string, string>();
  const parent = {
    postMessage: (message: Record<string, unknown>, targetOrigin: string) =>
      posted.push({ message, targetOrigin }),
  };
  const root: Record<string, unknown> = {
    parent,
    location: { protocol: 'https:', pathname: '/g/mcp-quest/', href: 'https://play.aaif.dev/g/mcp-quest/' },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(fn);
    },
    removeEventListener: () => {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    console: { warn: () => {}, error: () => {}, log: () => {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  };
  root.self = root;
  root.window = root;
  return {
    root,
    posted,
    emit(type: string, event: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
}

function loadSdk(source: string, root: Record<string, unknown>) {
  const factory = new Function('globalThis', `${source}\nreturn globalThis.GatewazeArcade;`);
  return factory(root) as { init: (o: { game: string; portalOrigin?: string }) => Promise<{ mode: string }> };
}

const HELLO = {
  gw: 1,
  type: 'arcade:hello',
  nonce: 'n-1',
  user: { profileName: 'Dan', avatarUrl: null },
  token: 'GAME-TOKEN',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  stateUrl: 'https://aaif.dev/api/arcade/state',
  leaderboardUrl: 'https://aaif.dev/api/arcade/leaderboard/mcp-quest',
};

describe('portal-origin pinning', () => {
  it('ships the placeholder so the boot-time substitution cannot silently no-op', () => {
    // src/index.ts exits non-zero if this is ever missing, which would otherwise
    // mean serving an unpinned SDK without anyone noticing.
    expect(SDK_SOURCE).toContain(PLACEHOLDER);
  });

  it('accepts a hello only from the pinned origin once templated', async () => {
    const templated = SDK_SOURCE.split(PLACEHOLDER).join('https://aaif.dev');
    const env = makeFramedRoot();
    const pending = loadSdk(templated, env.root).init({ game: 'mcp-quest' });

    // A different HTTPS origin is well-formed but is not the portal.
    env.emit('message', { source: env.root.parent, origin: 'https://evil.example', data: HELLO });
    env.emit('message', { source: env.root.parent, origin: 'https://aaif.dev', data: HELLO });

    const arcade = await pending;
    expect(arcade.mode).toBe('portal');
  });

  it('ignores a well-formed hello from a non-portal origin and stays local', async () => {
    const templated = SDK_SOURCE.split(PLACEHOLDER).join('https://aaif.dev');
    const env = makeFramedRoot();
    const pending = loadSdk(templated, env.root).init({ game: 'mcp-quest' });

    env.emit('message', { source: env.root.parent, origin: 'https://evil.example', data: HELLO });

    // No valid hello ever arrives → the handshake times out into local mode.
    const arcade = await pending;
    expect(arcade.mode).toBe('local');
  });

  it('lets a vendored (untemplated) copy pin explicitly via init({ portalOrigin })', async () => {
    const env = makeFramedRoot();
    const pending = loadSdk(SDK_SOURCE, env.root).init({
      game: 'mcp-quest',
      portalOrigin: 'https://aaif.dev',
    });

    env.emit('message', { source: env.root.parent, origin: 'https://evil.example', data: HELLO });
    env.emit('message', { source: env.root.parent, origin: 'https://aaif.dev', data: HELLO });

    const arcade = await pending;
    expect(arcade.mode).toBe('portal');
  });
});
