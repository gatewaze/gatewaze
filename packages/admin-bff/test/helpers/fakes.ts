// Fake upstreams for the BFF tests: an in-memory KeyValue, a Supabase stand-in
// (GoTrue, PostgREST, Storage, edge functions and a Realtime WebSocket) and a
// Gatewaze API stand-in. Every request they receive is recorded, so tests can
// assert on exactly what the BFF sent upstream.
import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { KeyValue } from '@gatewaze/host-session';

export class MemoryKeyValue implements KeyValue {
  data = new Map<string, { value: string; expiresAt: number }>();
  subscribers = new Map<string, Array<(m: string) => void>>();

  private live(key: string) {
    const e = this.data.get(key);
    if (e && e.expiresAt <= Date.now()) this.data.delete(key);
    return this.data.get(key);
  }
  async get(key: string) {
    return this.live(key)?.value ?? null;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    this.data.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
  async setIfExists(key: string, value: string, ttlSeconds: number) {
    if (!this.live(key)) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }
  async setIfAbsent(key: string, value: string, ttlMs: number) {
    if (this.live(key)) return false;
    this.data.set(key, { value, expiresAt: Date.now() + ttlMs });
    return true;
  }
  async del(key: string) {
    this.data.delete(key);
  }
  async delIfEquals(key: string, value: string): Promise<boolean | void> {
    if (this.live(key)?.value !== value) return false;
    this.data.delete(key);
    return true;
  }
  async setIfLockHeld(key: string, value: string, ttlSeconds: number, lockKey: string, lockValue: string, blockKey: string) {
    if (this.live(blockKey)) return 'blocked' as const;
    if (this.live(lockKey)?.value !== lockValue) return 'lock-lost' as const;
    await this.set(key, value, ttlSeconds);
    return 'ok' as const;
  }
  async publish(channel: string, message: string) {
    for (const fn of this.subscribers.get(channel) ?? []) fn(message);
  }
  async subscribe(channel: string, onMessage: (m: string) => void) {
    this.subscribers.set(channel, [...(this.subscribers.get(channel) ?? []), onMessage]);
  }
  async close() {}
}

export interface Recorded {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

// A JWT-shaped token. Nothing here verifies signatures; the shape is what
// supabase-js expects.
export function fakeJwt(sub: string, expiresAt: number, nonce: string): string {
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: expiresAt, role: 'authenticated', n: nonce })}.c2ln`;
}

interface FakeUser {
  id: string;
  email: string;
  admin: boolean;
  // An admin_profiles row that exists with is_active=false.
  inactive?: boolean;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString();
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export class FakeSupabase {
  url = '';
  requests: Recorded[] = [];
  users = new Map<string, FakeUser>();
  // access token -> user id; refresh token -> user id
  accessTokens = new Map<string, string>();
  refreshTokens = new Map<string, string>();
  // PKCE: code -> user id
  codes = new Map<string, string>();
  refreshCalls = 0;
  // Next refresh responses: 'ok' | status code to fail with.
  refreshMode: 'ok' | number = 'ok';
  refreshDelayMs = 0;
  tokenTtlSeconds = 3600;
  logoutCalls: string[] = [];
  // Realtime
  wsConnections: Array<{ url: string; socket: WebSocket; messages: string[] }> = [];
  // Response the fake PostgREST gives for non-admin_profiles paths.
  restStatus = 200;
  // When set, admin_profiles answers with this status (and no rows).
  adminStatus: number | null = null;
  // When set, admin_profiles answers 200 with this raw body.
  adminRawBody: string | null = null;
  // When true, admin_profiles (or /auth/v1/user) drops the connection.
  adminDrop = false;
  userDrop = false;
  // When set, /auth/v1/user answers 200 with this raw body.
  userRawBody: string | null = null;
  // When set, /auth/v1/user answers with this status.
  userStatus: number | null = null;
  // When set, a refresh answers 200 with this raw body.
  refreshRawBody: string | null = null;
  // Delay before answering PostgREST/Storage/functions paths.
  restDelayMs = 0;
  // The Location /redirect-to answers with. Set by the test, never taken
  // from the request, so the fake is not an open redirect.
  redirectLocation = '';
  // Requests to non-auth paths that the client abandoned before an answer.
  aborted: string[] = [];
  private seq = 0;
  private server = http.createServer((req, res) => void this.handle(req, res));
  private wss = new WebSocketServer({ noServer: true });

  async start() {
    this.server.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith('/realtime/v1/websocket')) return socket.destroy();
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        const conn = { url: req.url ?? '', socket: ws, messages: [] as string[] };
        this.wsConnections.push(conn);
        ws.on('message', (data) => {
          const text = data.toString();
          conn.messages.push(text);
          const m = JSON.parse(text);
          // Reply to every message the way Phoenix does (array form for 2.0.0).
          if (Array.isArray(m)) ws.send(JSON.stringify([m[0], m[1], m[2], 'phx_reply', { status: 'ok', response: {} }]));
          else ws.send(JSON.stringify({ join_ref: m.join_ref, ref: m.ref, topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: {} } }));
        });
      });
    });
    this.url = await listen(this.server);
    return this;
  }

  async stop() {
    for (const c of this.wsConnections) c.socket.terminate();
    this.wss.close();
    this.server.closeAllConnections();
    await new Promise((r) => this.server.close(r));
  }

  addUser(id: string, email: string, admin: boolean) {
    this.users.set(id, { id, email, admin });
  }

  // Issues a token pair the way GoTrue would.
  issue(userId: string, ttlSeconds = this.tokenTtlSeconds) {
    const n = `${++this.seq}`;
    const expires_at = Math.floor(Date.now() / 1000) + ttlSeconds;
    const access_token = fakeJwt(userId, expires_at, n);
    const refresh_token = `rt-${userId}-${n}`;
    this.accessTokens.set(access_token, userId);
    this.refreshTokens.set(refresh_token, userId);
    return { access_token, refresh_token, expires_at, expires_in: ttlSeconds };
  }

  sessionBody(userId: string) {
    const t = this.issue(userId);
    const u = this.users.get(userId)!;
    return { ...t, token_type: 'bearer', user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' } };
  }

  private userFor(headers: IncomingHttpHeaders): FakeUser | undefined {
    const token = headers.authorization?.replace(/^Bearer /, '') ?? '';
    const id = this.accessTokens.get(token);
    return id ? this.users.get(id) : undefined;
  }

  private json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readBody(req);
    this.requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
    const url = new URL(req.url ?? '/', 'http://x');

    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      this.refreshCalls++;
      if (this.refreshDelayMs) await new Promise((r) => setTimeout(r, this.refreshDelayMs));
      if (this.refreshRawBody !== null) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(this.refreshRawBody);
        return;
      }
      if (this.refreshMode !== 'ok') {
        return this.json(res, this.refreshMode, { code: this.refreshMode, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      }
      const { refresh_token } = JSON.parse(body) as { refresh_token: string };
      const uid = this.refreshTokens.get(refresh_token);
      if (!uid) return this.json(res, 400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      this.refreshTokens.delete(refresh_token);
      return this.json(res, 200, this.sessionBody(uid));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      const { auth_code, code_verifier } = JSON.parse(body) as { auth_code: string; code_verifier: string };
      const uid = this.codes.get(auth_code);
      if (!uid || !code_verifier) return this.json(res, 400, { error_code: 'bad_code', msg: 'invalid flow state' });
      this.codes.delete(auth_code);
      return this.json(res, 200, this.sessionBody(uid));
    }
    if (url.pathname === '/auth/v1/user') {
      if (this.userStatus) return this.json(res, this.userStatus, { msg: 'forced' });
      if (this.userDrop) return void req.socket.destroy();
      if (this.userRawBody !== null) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(this.userRawBody);
        return;
      }
      const u = this.userFor(req.headers);
      if (!u) return this.json(res, 401, { msg: 'invalid JWT' });
      return this.json(res, 200, { id: u.id, email: u.email, aud: 'authenticated', user_metadata: { name: 'Test' } });
    }
    if (url.pathname === '/auth/v1/logout') {
      this.logoutCalls.push(req.headers.authorization ?? '');
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/rest/v1/admin_profiles') {
      if (this.adminStatus) return this.json(res, this.adminStatus, { message: 'forced' });
      if (this.adminDrop) return void req.socket.destroy();
      if (this.adminRawBody !== null) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(this.adminRawBody);
        return;
      }
      const u = this.userFor(req.headers);
      const asked = url.searchParams.get('user_id');
      if (!u || asked !== `eq.${u.id}`) return this.json(res, 200, []);
      if (u.inactive) return this.json(res, 200, [{ is_active: false }]);
      return this.json(res, 200, u.admin ? [{ is_active: true }] : []);
    }
    if (this.restDelayMs) {
      const done = await new Promise<boolean>((r) => {
        const t = setTimeout(() => r(true), this.restDelayMs);
        res.on('close', () => {
          clearTimeout(t);
          r(false);
        });
      });
      if (!done) {
        this.aborted.push(url.pathname);
        return;
      }
    }
    // PostgREST, Storage, edge functions: a fixed body that never echoes the
    // request, plus a cookie that must not reach the browser.
    if (url.pathname.endsWith('/redirect-internal')) {
      res.writeHead(302, { location: `${this.url}/storage/v1/object/public/b/k.png?v=1` }).end();
      return;
    }
    if (url.pathname.endsWith('/redirect-to')) {
      res.writeHead(302, { location: this.redirectLocation }).end();
      return;
    }
    if (url.pathname.endsWith('/redirect-external')) {
      res.writeHead(302, { location: 'https://cdn.example.test/k.png' }).end();
      return;
    }
    if (url.pathname.endsWith('/cacheable')) {
      return this.json(res, 200, { ok: true }, { 'cache-control': 'public, max-age=60, s-maxage=600', vary: 'Accept-Encoding' });
    }
    return this.json(res, this.restStatus, { ok: true, path: url.pathname }, {
      'set-cookie': 'upstream=1; Path=/',
      'x-upstream': 'supabase',
      ...(url.pathname.endsWith('/forge-marker') ? { 'x-gw-session': 'expired' } : {}),
    });
  }
}

export class FakeApi {
  url = '';
  requests: Recorded[] = [];
  private server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    this.requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  async start() {
    this.url = await listen(this.server);
    return this;
  }
  async stop() {
    this.server.closeAllConnections();
    await new Promise((r) => this.server.close(r));
  }
}

export interface Response {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

// A raw HTTP client, so tests control every header (fetch adds some and
// forbids others).
export function call(
  base: string,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    // `path` is sent exactly as given: new URL() would normalise "..".
    const u = new URL(base);
    if (body !== undefined) headers = { 'content-length': String(Buffer.byteLength(body)), ...headers };
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
