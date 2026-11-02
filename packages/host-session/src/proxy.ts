// Framework-free proxying for a session holder, on Node's http and https modules.
// The browser never holds a Supabase token: every proxied request gets the
// session's access token (or, without a session, the anon key) attached here,
// replacing whatever the browser sent. Ported from the PoC's
// admin/server/core/proxy.ts.
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { Duplex, Readable } from 'node:stream';
import type { CoreLogger } from './session.js';
import { connectionHeaders, forwardRequestHeader, forwardResponseHeader, privateCacheControl, stripQueryTokens } from './host-session.js';

export {
  HOST_SESSION,
  SESSION_EXPIRED,
  SESSION_HEADER,
  csrfDecision,
  isSameSite,
  stripQueryTokens,
} from './host-session.js';

// One pooled agent per protocol, so upstream connections are reused.
const agents = {
  'http:': new http.Agent({ keepAlive: true }),
  'https:': new https.Agent({ keepAlive: true }),
};

export interface Upstream {
  // Base URL of the upstream (origin only, e.g. http://supabase-kong:8000).
  url: string;
  // The browser path prefix this upstream serves, e.g. /rest/v1. The path is
  // forwarded unchanged.
  prefix: string;
  // Supabase upstreams always get the anon key in `apikey`; the Gatewaze API
  // doesn't read it.
  supabase: boolean;
}

export interface ProxyCredentials {
  // Bearer token for Authorization, or null to send none.
  bearer: string | null;
  // Value for the `apikey` header, or null to send none.
  apikey: string | null;
}

export class UpstreamPathError extends Error {}

// True for Supabase's newer publishable keys (sb_publishable_...). They are
// not JWTs, so they are sent only in `apikey`: Supabase may reject one sent
// as `Authorization: Bearer`, which it would try to verify as a JWT.
export function isPublishableKey(anonKey: string): boolean {
  return anonKey.startsWith('sb_publishable_');
}

// Credentials for a request forwarded without the user's session. Supabase
// upstreams get the anon key in `apikey`, and also as the bearer when it is a
// legacy JWT anon key (exactly what supabase-js sends signed out). Other
// upstreams get neither.
export function anonCredentials(anonKey: string, supabase: boolean): ProxyCredentials {
  if (!supabase) return { bearer: null, apikey: null };
  return { bearer: isPublishableKey(anonKey) ? null : anonKey, apikey: anonKey };
}

// Resolves the browser's path against the upstream and checks that it is
// still under the matched prefix after normalisation, so "/rest/v1/../../x",
// "%2e%2e" segments or a backslash can't reach a different upstream path
// (for example GoTrue's /auth/v1, which this BFF deliberately doesn't proxy).
export function upstreamUrl(upstream: Upstream, pathAndQuery: string): URL {
  if (!pathAndQuery.startsWith('/') || pathAndQuery.startsWith('//')) {
    throw new UpstreamPathError('path must be absolute');
  }
  const base = new URL(upstream.url);
  const target = new URL(base.origin + stripQueryTokens(pathAndQuery));
  if (target.origin !== base.origin) throw new UpstreamPathError('path changed the upstream origin');
  if (target.pathname !== upstream.prefix && !target.pathname.startsWith(`${upstream.prefix}/`)) {
    throw new UpstreamPathError('path left the proxied prefix');
  }
  return target;
}

// Appends the address the request came from to X-Forwarded-For, as a
// standard proxy does, so the API's rate limiter (Express trust proxy) still
// sees the client.
export function forwardedFor(existing: string | string[] | undefined, remoteAddress: string | undefined): string {
  const prior = Array.isArray(existing) ? existing.join(', ') : existing;
  return [prior, remoteAddress].filter(Boolean).join(', ');
}

export function upstreamHeaders(
  headers: IncomingHttpHeaders,
  creds: ProxyCredentials,
  xff: string,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const hopByHop = connectionHeaders(headers.connection);
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && forwardRequestHeader(k) && !hopByHop.has(k.toLowerCase())) out[k] = v;
  }
  if (creds.bearer) out.authorization = `Bearer ${creds.bearer}`;
  if (creds.apikey) out.apikey = creds.apikey;
  if (xff) out['x-forwarded-for'] = xff;
  return out;
}

export interface ProxyResult {
  status: number;
  headers: Record<string, string | string[]>;
  body: IncomingMessage;
}

export interface ProxyOptions {
  creds: ProxyCredentials;
  xff: string;
  // Idle-socket timeout for the upstream request.
  timeoutMs: number;
  // The browser's response. If it closes before it is finished (the browser
  // went away), the upstream request and response are destroyed.
  downstream?: ServerResponse;
  // True when the request carried the user's session: the response is then
  // marked Cache-Control: private and Vary: Cookie.
  privateResponse?: boolean;
  // The admin's public origin: a Location on it is made relative too.
  siteOrigin?: string;
  // The request body to send instead of `req` itself, for a host that wraps
  // the stream (a byte limit, for example). It is piped as-is; an error it
  // emits aborts the upstream request and rejects with that error. Whether
  // the browser went away is still read from `req`.
  body?: Readable;
  log?: CoreLogger;
}

// Filters an upstream Location header before it reaches the browser.
//
// - A redirect to the upstream's own (internal) origin, or to the admin's
//   public origin, is made relative, so the browser never sees an in-cluster
//   host name. The resulting path then gets the relative checks below.
// - A relative Location must not start with "//" and must resolve back to
//   the origin it is relative to.
// - Any other absolute https: URL passes through unchanged. Edge functions
//   own their redirect targets (e.g. google-sheets-oauth/authorize sends the
//   browser to accounts.google.com), exactly as when they are called directly.
// - http: passes only to localhost names, for local development.
// - Everything else is dropped (null): other schemes such as javascript: or
//   data:, and any value with a backslash or a control character, because
//   browsers read "/\host" and "/<TAB>/host" as another host.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_LOCATION = /[\\\x00-\x1f\x7f]/;
const PLACEHOLDER_ORIGIN = 'https://bff.invalid';

function safeRelative(path: string): string | null {
  // "//host" would also fail the origin check below; it is refused by name
  // too so the rule does not rest on URL parsing alone.
  if (UNSAFE_LOCATION.test(path) || path.startsWith('//')) return null;
  try {
    return new URL(path, PLACEHOLDER_ORIGIN).origin === PLACEHOLDER_ORIGIN ? path : null;
  } catch {
    // Unparseable: dropped.
    return null;
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
}

export function rewriteLocation(location: string, upstreamOrigin: string, siteOrigin?: string): string | null {
  if (UNSAFE_LOCATION.test(location)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(location)) return safeRelative(location);
  let u: URL;
  try {
    u = new URL(location);
  } catch {
    // Unparseable absolute URL: dropped.
    return null;
  }
  if (u.origin === upstreamOrigin || (siteOrigin !== undefined && u.origin === siteOrigin)) {
    return safeRelative(`${u.pathname}${u.search}${u.hash}`);
  }
  if (u.protocol === 'https:') return location;
  if (u.protocol === 'http:' && isLocalHostname(u.hostname)) return location;
  return null;
}

function appendVary(existing: string | string[] | undefined, name: string): string {
  const v = (Array.isArray(existing) ? existing.join(',') : (existing ?? ''))
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!v.some((x) => x.toLowerCase() === name.toLowerCase() || x === '*')) v.push(name);
  return v.join(', ');
}

// Forwards an HTTP request (body streamed, not buffered) and resolves with the
// upstream response for the adapter to send. If the browser goes away first,
// whether while sending the body or while waiting for the answer, the
// upstream request is aborted.
export function proxyRequest(
  req: IncomingMessage,
  upstream: Upstream,
  pathAndQuery: string,
  opts: ProxyOptions,
): Promise<ProxyResult> {
  let target: URL;
  try {
    target = upstreamUrl(upstream, pathAndQuery);
  } catch (e) {
    return Promise.reject(e);
  }
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const up = transport.request(
      target,
      {
        method: req.method,
        headers: upstreamHeaders(req.headers, opts.creds, opts.xff),
        agent: agents[target.protocol as 'http:' | 'https:'],
        timeout: opts.timeoutMs,
      },
      (res) => {
        const headers: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined && forwardResponseHeader(k)) headers[k] = v;
        }
        if (typeof headers.location === 'string') {
          const location = rewriteLocation(headers.location, target.origin, opts.siteOrigin);
          if (location === null) {
            opts.log?.warn({ status: res.statusCode, path: target.pathname }, 'dropped an unsafe upstream redirect');
            delete headers.location;
          } else headers.location = location;
        }
        if (opts.privateResponse) {
          headers['cache-control'] = privateCacheControl(headers['cache-control']);
          headers.vary = appendVary(headers.vary, 'Cookie');
        }
        resolve({ status: res.statusCode ?? 502, headers, body: res });
      },
    );
    up.on('timeout', () => up.destroy(new Error('upstream timed out')));
    up.on('error', reject);
    req.on('close', () => {
      if (!req.complete) up.destroy();
    });
    opts.downstream?.on('close', () => {
      if (!opts.downstream?.writableFinished) up.destroy();
    });
    if (opts.body) {
      opts.body.on('error', (e) => up.destroy(e));
      opts.body.pipe(up);
    } else req.pipe(up);
  });
}

// Answers a refused WebSocket upgrade and closes the socket. Safe on a socket
// the client has already reset or closed.
export function rejectUpgrade(socket: Duplex, status: number, reason: string, headers: Record<string, string> = {}): void {
  if (socket.destroyed || !socket.writable) {
    socket.destroy();
    return;
  }
  const extra = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join('');
  try {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n${extra}\r\n`);
  } catch {
    // The socket failed while writing: nothing left to answer.
    socket.destroy();
  }
}

// ws:// or wss:// URL for the upstream Realtime socket: the browser's path
// and query with URL-borne tokens removed and `apikey` set to the anon key.
// The session's token goes into the Phoenix messages instead (realtime.ts).
export function realtimeUpstreamUrl(supabaseUrl: string, pathAndQuery: string, anonKey: string): string {
  const target = upstreamUrl({ url: supabaseUrl, prefix: '/realtime/v1', supabase: true }, pathAndQuery);
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  target.searchParams.set('apikey', anonKey);
  return target.toString();
}
