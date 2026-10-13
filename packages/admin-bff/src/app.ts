// Fastify adapter for the admin BFF: runs the GoTrue sign-in, keeps the
// session in Redis (the HttpOnly cookie holds only its ID), and proxies
// Supabase, the Gatewaze API and Realtime with the access token attached.
// Ported from the PoC's admin/server/index.ts. Unlike the PoC it does not
// serve the SPA: nginx in the admin image keeps doing that, and the ingress
// sends only the proxied prefixes and /bff here.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import rateLimit from '@fastify/rate-limit';
import secureSession from '@fastify/secure-session';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { WebSocketServer } from 'ws';
import {
  type GwSession,
  type RealtimeBridge,
  SESSION_EXPIRED,
  SESSION_HEADER,
  SessionEndedError,
  type SessionStore,
  SessionUnavailableError,
  type Upstream,
  UpstreamPathError,
  anonCredentials,
  bridgeRealtime,
  carriesPlaceholder,
  csrfDecision,
  deriveKeys,
  forwardedFor,
  getUser,
  isAdminCheckPending,
  isPublicRead,
  logout,
  proxyRequest,
  realtimeUpstreamUrl,
  redactUrl,
  rejectUpgrade,
  retryAfterSeconds,
  safeReturnTo,
  upstreamUrl,
} from '@gatewaze/host-session';
import { type BffConfig, type LoginFlow, finishLogin, startLogin } from './login.js';

declare module '@fastify/secure-session' {
  interface SessionData {
    sid: string;
    pkce: LoginFlow;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    flow: import('@fastify/secure-session').Session;
  }
}

export interface AppOptions {
  cfg: BffConfig;
  // Gatewaze API origin for /api/*.
  apiUrl: string;
  store: SessionStore;
  // Master keys from ADMIN_BFF_SESSION_SECRET; the app derives its cookie
  // subkeys from them.
  sessionKeys: Buffer[];
  sessionTtlSeconds: number;
  upstreamTimeoutMs?: number;
  logger?: FastifyServerOptions['logger'];
  // Which peers may set X-Forwarded-For (proxy-addr syntax: names such as
  // loopback or uniquelocal, addresses, CIDRs). Decides the client address
  // the sign-in rate limit counts by. Default: the in-cluster ranges the
  // ingress controller connects from.
  trustProxy?: string;
  // Requests per minute per client address to /bff/login and /bff/callback.
  signInRateLimit?: number;
}

export const DEFAULT_TRUST_PROXY = 'loopback,linklocal,uniquelocal';
export const DEFAULT_SIGN_IN_RATE_LIMIT = 30;

export interface CookieNames {
  session: string;
  flow: string;
  secure: boolean;
}

// __Host- cookies (Secure, Path=/, no Domain) on https. Plain names, without
// Secure, only for http on a localhost name, where browsers would otherwise
// drop the cookie. Any other http origin is refused: the session cookie must
// never travel in clear text.
export function cookieNames(siteUrl: string): CookieNames {
  const u = new URL(siteUrl);
  if (u.protocol === 'https:') {
    return { session: '__Host-gw-admin-session', flow: '__Host-gw-admin-flow', secure: true };
  }
  const local = u.hostname === 'localhost' || u.hostname.endsWith('.localhost') || u.hostname === '127.0.0.1';
  if (!local) throw new Error(`ADMIN_URL must be https (got ${u.origin}); http is allowed only for localhost`);
  return { session: 'gw-admin-session', flow: 'gw-admin-flow', secure: false };
}

const SUPABASE_PREFIXES = ['/rest/v1', '/storage/v1', '/functions/v1'];
const API_PREFIX = '/api';
const REALTIME_PREFIX = '/realtime/v1';
const FLOW_TTL_SECONDS = 600;
// Realtime sockets one session may hold on one replica.
const MAX_SOCKETS_PER_SESSION = 20;

// Query strings are validated so a repeated parameter (an array) or a wrong
// type is a 400, never a value the handlers didn't expect.
const LOGIN_QUERY = {
  type: 'object',
  properties: { return_to: { type: 'string', maxLength: 2048 } },
} as const;
const CALLBACK_QUERY = {
  type: 'object',
  properties: {
    code: { type: 'string', maxLength: 2048 },
    state: { type: 'string', maxLength: 2048 },
    error: { type: 'string', maxLength: 512 },
    error_description: { type: 'string', maxLength: 2048 },
    error_code: { type: 'string', maxLength: 512 },
  },
} as const;
// Longest IdP-supplied error text written to the log.
const MAX_LOG_LENGTH = 200;

// The only values /login?error= ever carries. The shim maps them to text.
export type SignInErrorCode = 'access_denied' | 'login_failed' | 'callback_invalid' | 'not_admin' | 'server_error';

// Maps an OAuth error from the callback to a sign-in error code.
export function callbackErrorCode(error: string): SignInErrorCode {
  if (error === 'access_denied') return 'access_denied';
  if (error === 'server_error' || error === 'temporarily_unavailable') return 'server_error';
  return 'callback_invalid';
}

class SignInRateLimitedError extends Error {
  statusCode = 429;
}

type Lookup = { state: 'none' } | { state: 'expired' } | { state: 'ok'; sid: string; session: GwSession };

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { store } = opts;
  const siteOrigin = new URL(opts.cfg.siteUrl).origin;
  const cookies = cookieNames(siteOrigin);
  const timeoutMs = opts.upstreamTimeoutMs ?? 300_000;

  const upstreams: Upstream[] = [
    ...SUPABASE_PREFIXES.map((prefix) => ({ url: opts.cfg.supabaseUrl, prefix, supabase: true })),
    { url: opts.apiUrl, prefix: API_PREFIX, supabase: false },
  ];

  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: (opts.trustProxy ?? DEFAULT_TRUST_PROXY).split(',').map((t) => t.trim()).filter(Boolean),
  });

  // Only the sign-in routes are limited: each starts or finishes a GoTrue
  // flow. Counted per client address and per route, in memory on each
  // replica.
  await app.register(rateLimit, {
    global: false,
    // Over the limit, the sign-in page gets a fixed code like any other
    // sign-in failure (the shim has no separate rate_limited code yet).
    errorResponseBuilder: () => new SignInRateLimitedError(),
  });
  const signInLimit = {
    rateLimit: { max: opts.signInRateLimit ?? DEFAULT_SIGN_IN_RATE_LIMIT, timeWindow: 60_000 },
  };
  // The core reports the failures it handles (and recovers from) here.
  const cfg: BffConfig = { ...opts.cfg, log: app.log };
  store.setLogger(app.log);

  await app.register(secureSession, [
    {
      sessionName: 'session',
      cookieName: cookies.session,
      // Each cookie gets its own subkey, so a flow cookie can't be replayed
      // as a session cookie or the other way round.
      key: deriveKeys(opts.sessionKeys, 'cookie:session'),
      expiry: opts.sessionTtlSeconds,
      cookie: {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: cookies.secure,
        maxAge: opts.sessionTtlSeconds,
      },
    },
    {
      sessionName: 'flow',
      cookieName: cookies.flow,
      key: deriveKeys(opts.sessionKeys, 'cookie:flow'),
      expiry: FLOW_TTL_SECONDS,
      // __Host- requires Path=/ (the PoC scoped this cookie to /bff).
      cookie: { path: '/', httpOnly: true, sameSite: 'lax', secure: cookies.secure, maxAge: FLOW_TTL_SECONDS },
    },
  ]);

  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/bff/')) reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    if (err instanceof SignInRateLimitedError) {
      request.log.warn({ ip: request.ip, path: request.routeOptions.url }, 'sign-in rate limit reached');
      return reply.redirect(signInError('server_error'));
    }
    if (err instanceof SessionUnavailableError) {
      request.log.warn({ err: err.message }, 'session unavailable');
      return reply.code(503).send({ error: 'session_unavailable' });
    }
    if (err instanceof UpstreamPathError) return reply.code(400).send({ error: 'bad_path' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'bad_request' });
    request.log.error({ err: err.message }, 'request failed');
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));

  // Loads the session behind the request's cookie, refreshing it if near
  // expiry. 'none': no session cookie at all. 'expired': a cookie whose
  // session is gone (signed out elsewhere, refresh token refused, cookie past
  // its expiry, or undecryptable after a key change).
  async function lookupSession(request: FastifyRequest): Promise<Lookup> {
    if (request.cookies[cookies.session] === undefined) return { state: 'none' };
    const sid = request.session.get('sid');
    let session: GwSession | null = null;
    if (sid) {
      try {
        session = await store.fresh(sid);
      } catch (e) {
        // GoTrue or Redis gave no answer: 503 (via the error handler), never
        // a 500 and never a sign-out.
        if (e instanceof SessionUnavailableError) throw e;
        throw new SessionUnavailableError(`session store: ${(e as Error).message}`);
      }
    }
    if (!sid || !session) return { state: 'expired' };
    // Slide the cookie with the server session: once less than half its
    // lifetime is left, send it again with a fresh timestamp and Max-Age, so
    // an active session never loses its cookie while Redis still holds it.
    const issuedAt = (request.session as unknown as { get(k: string): unknown }).get('__ts');
    if (typeof issuedAt === 'number' && Date.now() / 1000 - issuedAt > opts.sessionTtlSeconds / 2) {
      request.session.touch();
    }
    return { state: 'ok', sid, session };
  }

  function sendExpired(request: FastifyRequest, reply: FastifyReply) {
    request.session.delete();
    return reply.code(401).header(SESSION_HEADER, SESSION_EXPIRED).send({ error: 'not_signed_in' });
  }

  // The admin_profiles check could not be made; the shim retries after
  // Retry-After rather than showing "not an admin".
  function sendAdminCheckPending(reply: FastifyReply, session: GwSession) {
    return reply.code(503).header('retry-after', String(retryAfterSeconds(session))).send({ error: 'admin_check_pending' });
  }

  // The sign-in page gets only a fixed code; the detail goes to the log.
  function signInError(code: SignInErrorCode): string {
    return `/login?error=${code}`;
  }

  app.get('/bff/healthz', async () => ({ status: 'ok' }));

  app.get('/bff/login', { schema: { querystring: LOGIN_QUERY }, config: signInLimit }, async (request, reply) => {
    const { return_to } = request.query as { return_to?: string };
    try {
      const { url, flow } = await startLogin(cfg, return_to ?? '/');
      request.flow.set('pkce', flow);
      return reply.redirect(url);
    } catch (e) {
      request.log.error({ err: (e as Error).message }, 'could not start sign-in');
      return reply.redirect(signInError('login_failed'));
    }
  });

  app.get('/bff/callback', { schema: { querystring: CALLBACK_QUERY }, config: signInLimit }, async (request, reply) => {
    const q = request.query as { code?: string; error?: string; error_description?: string };
    const flow = request.flow.get('pkce');
    request.flow.delete();
    if (q.error) {
      request.log.warn(
        { error: q.error.slice(0, MAX_LOG_LENGTH), description: q.error_description?.slice(0, MAX_LOG_LENGTH) },
        'sign-in returned an error',
      );
      return reply.redirect(signInError(callbackErrorCode(q.error)));
    }
    if (!q.code || !flow) {
      request.log.warn({ code: Boolean(q.code), flow: Boolean(flow) }, 'sign-in callback without code or flow cookie');
      return reply.redirect(signInError('callback_invalid'));
    }
    let session: GwSession;
    try {
      session = await finishLogin(cfg, q.code, flow);
    } catch (e) {
      request.log.warn({ err: (e as Error).message.slice(0, MAX_LOG_LENGTH) }, 'code exchange failed');
      return reply.redirect(signInError('callback_invalid'));
    }
    let sid: string;
    try {
      sid = await store.create(session);
    } catch (e) {
      request.log.error({ err: (e as Error).message }, 'could not store the session');
      return reply.redirect(signInError('server_error'));
    }
    // A new session ID on every sign-in; the previous one is ended.
    const previous = request.session.get('sid');
    if (previous) {
      await store.delete(previous).catch((e) => request.log.warn({ err: (e as Error).message }, 'could not end the previous session'));
    }
    request.session.set('sid', sid);
    return reply.redirect(safeReturnTo(flow.returnTo));
  });

  app.post('/bff/logout', async (request, reply) => {
    if (request.headers.origin && request.headers.origin !== siteOrigin) return reply.code(403).send({ error: 'cross_site' });
    const sid = request.session.get('sid');
    try {
      // GoTrue's /logout authenticates with the access token, so an expired
      // one is refreshed first; otherwise the refresh token would not be
      // revoked. If that fails, the stored tokens are tried as they are.
      let s: GwSession | null = null;
      if (sid) {
        try {
          s = await store.fresh(sid);
        } catch (e) {
          request.log.warn({ err: (e as Error).message }, 'logout: refresh before revoke failed');
          s = await store.get(sid);
        }
      }
      if (s) await logout(cfg, s);
      if (sid) await store.delete(sid);
    } catch (e) {
      // Redis is down: the session may outlive this sign-out in the store
      // until its TTL, but the browser's cookie is cleared regardless.
      request.log.warn({ err: (e as Error).message }, 'logout: could not end the stored session');
    } finally {
      request.session.delete();
    }
    return reply.code(204).send();
  });

  // The SPA's only source of user identity. A signed-in non-admin gets 403
  // with their email, so the SPA can say who they're signed in as.
  app.get('/bff/me', async (request, reply) => {
    const found = await lookupSession(request);
    if (found.state === 'none') return reply.code(401).send({ error: 'not_signed_in' });
    if (found.state === 'expired') return sendExpired(request, reply);
    if (isAdminCheckPending(found.session)) return sendAdminCheckPending(reply, found.session);
    let user: Record<string, unknown>;
    try {
      user = await getUser(cfg, found.session.access_token);
    } catch (e) {
      if (e instanceof SessionEndedError) {
        // GoTrue no longer accepts the token (user deleted, session revoked).
        request.log.warn({ err: e.message }, 'GoTrue /user refused the session; ending it');
        try {
          await store.delete(found.sid);
        } catch (err) {
          request.log.warn({ err: (err as Error).message }, 'could not delete the ended session');
          return reply.code(503).send({ error: 'session_unavailable' });
        }
        return sendExpired(request, reply);
      }
      request.log.warn({ err: (e as Error).message }, 'GoTrue /user unavailable');
      return reply.code(503).send({ error: 'session_unavailable' });
    }
    if (!found.session.is_admin) return reply.code(403).send({ error: 'not_admin', email: user.email });
    return { user };
  });

  await app.register(async (proxied) => {
    // Leave bodies unread so they stream straight to the upstream.
    proxied.removeAllContentTypeParsers();
    proxied.addContentTypeParser('*', (_req, _payload, done) => done(null));

    for (const upstream of upstreams) {
      proxied.all(`${upstream.prefix}/*`, async (request, reply) => {
        const decision = csrfDecision({
          method: request.method,
          origin: request.headers.origin,
          apikey: header(request.headers.apikey),
          authorization: request.headers.authorization,
          secFetchSite: header(request.headers['sec-fetch-site']),
          siteOrigin,
          anonKey: cfg.anonKey,
        });
        if (decision === 'reject') return reply.code(403).send({ error: 'cross_site' });

        // Without a session (no cookie, or a cross-site GET), Supabase gets
        // the anon key as supabase-js would send it (a publishable key only
        // in apikey); the API gets nothing.
        const anon = anonCredentials(cfg.anonKey, upstream.supabase);
        let bearer: string | null = anon.bearer;
        if (decision === 'session') {
          const found = await lookupSession(request);
          if (found.state === 'expired') return sendExpired(request, reply);
          // Code using the placeholder only runs after sign-in, so without a
          // session cookie it means the session has ended (cookie expired or
          // cleared). Truly anonymous reads carry no placeholder.
          if (found.state === 'none' && carriesPlaceholder(request.headers.authorization, request.url)) {
            return sendExpired(request, reply);
          }
          if (found.state === 'ok') {
            if (found.session.is_admin) bearer = found.session.access_token;
            // A signed-in non-admin may still make the sign-in page's public
            // reads, as anon.
            else if (!isPublicRead(request.method, upstreamUrl(upstream, request.url).pathname)) {
              if (isAdminCheckPending(found.session)) return sendAdminCheckPending(reply, found.session);
              return reply.code(403).send({ error: 'not_admin' });
            }
          }
        }

        let res;
        try {
          res = await proxyRequest(request.raw, upstream, request.raw.url ?? '/', {
            creds: { bearer, apikey: anon.apikey },
            xff: forwardedFor(request.headers['x-forwarded-for'], request.socket.remoteAddress),
            timeoutMs,
            downstream: reply.raw,
            privateResponse: bearer !== null && bearer !== anon.bearer,
            siteOrigin,
            log: request.log,
          });
        } catch (e) {
          if (e instanceof UpstreamPathError) throw e;
          request.log.warn({ err: (e as Error).message, prefix: upstream.prefix }, 'upstream request failed');
          return reply.code(502).send({ error: 'upstream_unavailable' });
        }
        return reply.code(res.status).headers(res.headers).send(res.body);
      });
    }
  });

  // Realtime: the browser's socket is terminated here and bridged to
  // Realtime with the token put into the Phoenix messages.
  // Caps a browser message at 8 MiB (ws defaults to 100 MiB).
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  const bridges = new Set<RealtimeBridge>();

  // Open Realtime sockets per session ID, on this replica.
  const socketsPerSession = new Map<string, number>();

  async function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    // First, before any reject or await: Node removes its own error listener
    // from an upgraded socket, and ws adds one only inside handleUpgrade. A
    // client that resets the connection in between would otherwise raise an
    // unhandled 'error' and take the process down.
    socket.on('error', (e) => {
      app.log.debug({ err: e.message }, 'realtime upgrade: socket error');
      socket.destroy();
    });
    const url = req.url ?? '/';
    if (!url.startsWith(`${REALTIME_PREFIX}/`)) return rejectUpgrade(socket, 404, 'Not Found');
    if (req.headers.origin !== siteOrigin) return rejectUpgrade(socket, 403, 'Forbidden');
    // The marker on these 401s is informational: browsers can't read
    // handshake response headers. The shim learns the session has ended from
    // its next REST call, which gets the same 401 with a readable marker.
    const expired = { [SESSION_HEADER]: SESSION_EXPIRED };
    const raw = app.parseCookie(req.headers.cookie ?? '')[cookies.session];
    if (raw === undefined) return rejectUpgrade(socket, 401, 'Unauthorized', expired);
    const sid = app.decodeSecureSession(raw, app.log, 'session')?.get('sid');
    if (!sid) return rejectUpgrade(socket, 401, 'Unauthorized', expired);
    if ((socketsPerSession.get(sid) ?? 0) >= MAX_SOCKETS_PER_SESSION) return rejectUpgrade(socket, 429, 'Too Many Requests');
    // Reserve the slot now, before any await, so concurrent upgrades can't
    // all pass the check. release() is idempotent and is called from every
    // way this upgrade can end: an early reject below, the browser socket
    // closing (which also covers ws.handleUpgrade aborting a malformed
    // handshake without calling back), and the bridged client closing.
    socketsPerSession.set(sid, (socketsPerSession.get(sid) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const n = (socketsPerSession.get(sid) ?? 1) - 1;
      if (n > 0) socketsPerSession.set(sid, n);
      else socketsPerSession.delete(sid);
    };
    // Listen for sign-out before any await, so one that lands while the
    // session loads or the handshake completes is not missed.
    let signedOut = false;
    const stopEarly = store.onDelete(sid, () => {
      signedOut = true;
    });
    socket.once('close', () => {
      stopEarly();
      release();
    });
    const reject = (status: number, reason: string, headers?: Record<string, string>) => {
      stopEarly();
      release();
      rejectUpgrade(socket, status, reason, headers);
    };
    let session: GwSession | null;
    try {
      session = await store.fresh(sid);
    } catch (e) {
      app.log.warn({ err: (e as Error).message }, 'realtime upgrade: session unavailable');
      return reject(503, 'Service Unavailable');
    }
    if (!session || signedOut) return reject(401, 'Unauthorized', expired);
    if (!session.is_admin) {
      if (isAdminCheckPending(session)) {
        return reject(503, 'Service Unavailable', { 'retry-after': String(retryAfterSeconds(session)) });
      }
      return reject(403, 'Forbidden');
    }
    let upstreamUrl: string;
    try {
      upstreamUrl = realtimeUpstreamUrl(cfg.supabaseUrl, url, cfg.anonKey);
    } catch {
      // A path that leaves /realtime/v1 after normalisation.
      return reject(400, 'Bad Request');
    }
    // The client went away (or half-closed) while the session loaded.
    // Defence in depth: ws already destroys such sockets in handleUpgrade,
    // and the socket-close listener above releases the slot, so no test can
    // reach the readable/writable part of this check on its own.
    if (socket.destroyed || !socket.readable || !socket.writable) return reject(400, 'Bad Request');
    const s = session;
    wss.handleUpgrade(req, socket, head, (client) => {
      const bridge = bridgeRealtime(client, {
        upstreamUrl,
        session: s,
        fresh: () => store.fresh(sid),
        onSignedOut: (fn) => store.onDelete(sid, fn),
        log: app.log,
      });
      stopEarly();
      client.once('close', () => {
        bridges.delete(bridge);
        release();
      });
      if (signedOut) return bridge.close(4001, 'signed out');
      bridges.add(bridge);
    });
  }

  app.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    onUpgrade(req, socket, head).catch((e) => {
      app.log.error({ err: (e as Error).message }, 'websocket upgrade failed');
      rejectUpgrade(socket, 500, 'Internal Server Error');
    });
  });

  // preClose, not onClose: the server's close waits for these sockets.
  app.addHook('preClose', async () => {
    // 1001 (going away): realtime-js reconnects, to another replica.
    for (const b of bridges) b.close(1001, 'server shutting down');
    wss.close();
  });

  return app;
}

function header(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// Logger options: never log cookies, credentials or URL-borne tokens.
export function loggerOptions(level: string): FastifyServerOptions['logger'] {
  return {
    level,
    redact: {
      // The req serializer below never logs headers. These paths cover code
      // that logs a headers object itself, at the top level or one level down.
      paths: [
        'headers.cookie',
        'headers.authorization',
        'headers.apikey',
        'headers["set-cookie"]',
        '*.headers.cookie',
        '*.headers.authorization',
        '*.headers.apikey',
        '*.headers["set-cookie"]',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req(req: { method?: string; url?: string; ip?: string }) {
        return { method: req.method, url: redactUrl(req.url ?? ''), remoteAddress: req.ip };
      },
    },
  };
}
