// Framework-free proxying for the admin BFF, on Node's http and https modules.
// The browser never holds a Supabase token: every proxied request gets the
// session's access token (or, without a session, the anon key) attached here,
// replacing whatever the browser sent. Ported from the PoC's
// admin/server/core/proxy.ts.
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { Duplex } from 'node:stream';
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
  log?: CoreLogger;
}

// An upstream redirect to its own (internal) origin is made relative, so the
// browser never sees, or follows, an in-cluster host name. Any other
// Location returns null and is dropped: an absolute URL to another host or
// scheme, a protocol-relative one, and anything with a backslash or a
// control character (browsers read "/\host" and "/<TAB>/host" as another
// host). A relative path that stays on the same origin passes through.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_LOCATION = /[\\\x00-\x1f\x7f]/;
const PLACEHOLDER_ORIGIN = 'https://bff.invalid';

export function rewriteLocation(location: string, upstreamOrigin: string): string | null {
  if (UNSAFE_LOCATION.test(location)) return null;
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(location);
  try {
    if (absolute) {
      const u = new URL(location);
      return u.origin === upstreamOrigin ? `${u.pathname}${u.search}${u.hash}` : null;
    }
    // Relative: it must resolve to the same origin it is relative to.
    return new URL(location, PLACEHOLDER_ORIGIN).origin === PLACEHOLDER_ORIGIN ? location : null;
  } catch {
    // Unparseable: dropped.
    return null;
  }
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
          const location = rewriteLocation(headers.location, target.origin);
          if (location === null) {
            opts.log?.warn({ status: res.statusCode, path: target.pathname }, 'dropped an upstream redirect to another host');
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
    req.pipe(up);
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
