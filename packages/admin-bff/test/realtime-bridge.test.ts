// bridgeRealtime on its own, with a fake upstream: what it does when GoTrue
// can't be reached during a connection, and when Realtime never answers.
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { bridgeRealtime } from '../src/core/realtime.js';
import { RefreshUnavailableError, type GwSession } from '../src/core/session.js';
import { FakeSupabase } from './helpers/fakes.js';

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const now = () => Math.floor(Date.now() / 1000);

// A browser socket whose server side is handed to bridgeRealtime.
async function pair(
  upstreamUrl: string,
  session: GwSession,
  fresh: () => Promise<GwSession | null>,
  refreshRetryMs?: number,
  handshakeTimeoutMs?: number,
) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.once('listening', r));
  cleanups.push(() => new Promise((r) => wss.close(r)));
  wss.on('connection', (server) =>
    bridgeRealtime(server, { upstreamUrl, session, fresh, onSignedOut: () => () => undefined, refreshRetryMs, handshakeTimeoutMs }),
  );
  const client = new WebSocket(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`);
  cleanups.push(() => client.terminate());
  const closed = new Promise<number>((r) => client.on('close', (c) => r(c)));
  await new Promise((r) => client.once('open', r));
  return { client, closed };
}

async function fakeRealtime() {
  const sb = await new FakeSupabase().start();
  cleanups.push(() => sb.stop());
  return `${sb.url.replace('http', 'ws')}/realtime/v1/websocket`;
}

describe('refresh outage during a connection', () => {
  it('keeps the socket open and retries while the token is still valid', async () => {
    let calls = 0;
    const session: GwSession = { access_token: 'a', refresh_token: 'r', expires_at: now() + 61, user_id: 'u', is_admin: true };
    const { client } = await pair(await fakeRealtime(), session, async () => {
      calls++;
      throw new RefreshUnavailableError('down');
    }, 200);
    await new Promise((r) => setTimeout(r, 1700));
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(client.readyState).toBe(WebSocket.OPEN);
  });

  it('closes with 1011 once the token would expire before the next retry', async () => {
    const session: GwSession = { access_token: 'a', refresh_token: 'r', expires_at: now() + 61, user_id: 'u', is_admin: true };
    const { closed } = await pair(await fakeRealtime(), session, async () => {
      throw new RefreshUnavailableError('down');
    }, 120_000);
    expect(await closed).toBe(1011);
  });
});

describe('upstream never opens', () => {
  it('closes with 1011 when the pre-open queue overflows', async () => {
    // Accepts TCP and never answers the WebSocket handshake.
    const silent = net.createServer(() => undefined);
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    cleanups.push(() => {
      silent.close();
    });
    const session: GwSession = { access_token: 'a', refresh_token: 'r', expires_at: now() + 3600, user_id: 'u', is_admin: true };
    const { client, closed } = await pair(`ws://127.0.0.1:${(silent.address() as AddressInfo).port}/`, session, async () => session, undefined, 60_000);
    for (let i = 0; i < 1001; i++) client.send(JSON.stringify([null, String(i), 'phoenix', 'heartbeat', {}]));
    const within = new Promise((r) => setTimeout(() => r('still open'), 2000));
    expect(await Promise.race([closed, within])).toBe(1011);
  });
});

async function silentUpstream() {
  // Accepts TCP and never answers the WebSocket handshake.
  const silent = net.createServer(() => undefined);
  await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
  cleanups.push(() => {
    silent.close();
  });
  return `ws://127.0.0.1:${(silent.address() as AddressInfo).port}/`;
}

const live = (): GwSession => ({ access_token: 'a', refresh_token: 'r', expires_at: now() + 3600, user_id: 'u', is_admin: true });

describe('memory bounds', () => {
  it('closes with 1011 once the pre-open queue passes 1 MiB, well before the message cap', async () => {
    // A long handshake timeout, so only the byte cap can close the socket.
    const { client, closed } = await pair(await silentUpstream(), live(), async () => live(), undefined, 60_000);
    const big = JSON.stringify([null, '1', 'realtime:t', 'broadcast', { blob: 'x'.repeat(600 * 1024) }]);
    client.send(big);
    client.send(big);
    const within = new Promise((r) => setTimeout(() => r('still open'), 2000));
    expect(await Promise.race([closed, within])).toBe(1011);
  });

  it('closes with 1011 when the upstream handshake times out', async () => {
    const { closed } = await pair(await silentUpstream(), live(), async () => live(), undefined, 200);
    expect(await closed).toBe(1011);
  });
});

describe('frames the bridge cannot rewrite', () => {
  it('closes with 1003 on a binary frame and forwards nothing', async () => {
    const sb = await new FakeSupabase().start();
    cleanups.push(() => sb.stop());
    const { client, closed } = await pair(`${sb.url.replace('http', 'ws')}/realtime/v1/websocket`, live(), async () => live());
    client.send(Buffer.from('{"access_token":"x"}'), { binary: true });
    expect(await closed).toBe(1003);
    expect(sb.wsConnections.flatMap((c) => c.messages)).toEqual([]);
  });

  it('closes with 1003 on an unparseable text frame and forwards nothing', async () => {
    const sb = await new FakeSupabase().start();
    cleanups.push(() => sb.stop());
    const { client, closed } = await pair(`${sb.url.replace('http', 'ws')}/realtime/v1/websocket`, live(), async () => live());
    client.send('not json');
    expect(await closed).toBe(1003);
    expect(sb.wsConnections.flatMap((c) => c.messages)).toEqual([]);
  });
});

describe('a closed bridge', () => {
  it('makes no refresh call after it closes, even with a refresh in flight', async () => {
    // An upstream that never answers keeps the bridge open (its handshake
    // timer is faked and never fires).
    const upstreamUrl = await silentUpstream();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // A browser socket stand-in: the bridge only needs these members.
      const client = Object.assign(new EventEmitter(), {
        readyState: WebSocket.OPEN as number,
        bufferedAmount: 0,
        send: () => undefined,
        close() {
          this.readyState = WebSocket.CLOSED;
        },
      });
      let calls = 0;
      let resolveFresh!: (s: GwSession) => void;
      const session: GwSession = { ...live(), expires_at: now() + 61 };
      const bridge = bridgeRealtime(client as unknown as WebSocket, {
        upstreamUrl,
        session,
        fresh: () => {
          calls++;
          return new Promise<GwSession>((r) => (resolveFresh = r));
        },
        onSignedOut: () => () => undefined,
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(100);
      bridge.close(1000, 'test');
      // The in-flight refresh finishes after the close.
      resolveFresh({ ...live(), access_token: 'a2', expires_at: now() + 61 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
