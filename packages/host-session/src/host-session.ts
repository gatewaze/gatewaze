// Token-rewriting and CSRF rules for a host-session session holder.
// Framework-free and dependency-free: callers pass header names and values,
// and apply the results to their own request and response types. Ported from
// the PoC's shared/host-session.ts (Eric Searcy, 2026-09), which the PoC used
// from both a Fastify BFF and Next.js route handlers.

// Placeholder the browser's supabase-js shim uses wherever code expects an
// access token. The server never forwards it; it attaches the session's real
// token instead.
export const HOST_SESSION = 'host-session';

// Response header that tells the browser shim its session cookie no longer
// maps to a live session. The shim fires SIGNED_OUT only when it sees this, so
// a 401 from an upstream (for example an edge function rejecting a request)
// does not sign the user out.
export const SESSION_HEADER = 'x-gw-session';
export const SESSION_EXPIRED = 'expired';

// Request headers never forwarded upstream: hop-by-hop headers, the browser's
// credentials (the server attaches its own), headers that identify the
// browser's origin, and the ones the proxy sets itself.
const DROP_REQUEST = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'cookie',
  'authorization',
  'origin',
  'referer',
  'content-length',
  // Set by the proxy: the anon key on Supabase routes, and the client chain.
  'apikey',
  'x-forwarded-for',
  // A browser must not tell an upstream which host or scheme it was reached
  // on: upstreams build redirect and callback URLs from these.
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'forwarded',
]);

// Response headers never returned to the browser: upstream cookies, and the
// session marker, which only the session holder may set (an edge function
// returning it would otherwise sign the user out).
const DROP_RESPONSE = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'set-cookie',
  'proxy-connection',
  'x-gw-session',
]);
// fetch decompresses response bodies, so a caller that forwards a decoded body
// must also drop the original encoding and length.
const DROP_DECODED = new Set(['content-encoding', 'content-length']);

export function forwardRequestHeader(name: string): boolean {
  return !DROP_REQUEST.has(name.toLowerCase());
}

// Header names listed in a Connection header are hop-by-hop for that
// request (RFC 9110 7.6.1) and are not forwarded either.
export function connectionHeaders(connection: string | string[] | undefined): Set<string> {
  const v = Array.isArray(connection) ? connection.join(',') : (connection ?? '');
  return new Set(
    v
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
}

// Cache-Control for a response that was produced with the user's session:
// the upstream's directives are kept, but it is always private, so no shared
// cache (CDN, ingress cache) can serve it to someone else.
export function privateCacheControl(upstream: string | string[] | undefined): string {
  const v = Array.isArray(upstream) ? upstream.join(',') : (upstream ?? '');
  const kept = v
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d && !/^(public|private|s-maxage=.*|proxy-revalidate)$/i.test(d));
  return ['private', ...kept].join(', ');
}

export function forwardResponseHeader(name: string, bodyDecoded = false): boolean {
  const n = name.toLowerCase();
  return !DROP_RESPONSE.has(n) && !(bodyDecoded && DROP_DECODED.has(n));
}

function decodeKey(pair: string): string {
  const raw = pair.split('=', 1)[0];
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    // Malformed percent-encoding: compare the raw text instead.
    return raw;
  }
}

function decodeValue(pair: string): string {
  const i = pair.indexOf('=');
  if (i < 0) return '';
  try {
    return decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
  } catch {
    // Malformed percent-encoding: compare the raw text instead.
    return pair.slice(i + 1);
  }
}

// Removes URL-borne tokens before a request goes upstream. The PoC replaced
// ?access_token= with the real token; here the token travels only in the
// Authorization header (which every upstream reads first), so it never lands
// in an upstream access log or a URL.
//
// `access_token` is always removed. `token` is removed only when it carries
// the placeholder: Storage signed URLs (/storage/v1/object/sign/...?token=)
// and several edge functions (newsletter-unsubscribe, events-speaker-confirm)
// use `token` for their own signed values, which must pass through.
//
// Pairs that are kept are not re-encoded, so PostgREST filter syntax reaches
// the upstream exactly as the browser sent it.
export function stripQueryTokens(pathAndQuery: string): string {
  const q = pathAndQuery.indexOf('?');
  if (q < 0) return pathAndQuery;
  const path = pathAndQuery.slice(0, q);
  const pairs = pathAndQuery.slice(q + 1).split('&');
  const kept = pairs.filter((pair) => {
    if (pair === '') return false;
    const key = decodeKey(pair);
    if (key === 'access_token') return false;
    if (key === 'token' && decodeValue(pair) === HOST_SESSION) return false;
    return true;
  });
  if (kept.length === pairs.length) return pathAndQuery;
  return kept.length ? `${path}?${kept.join('&')}` : path;
}

// True when the request uses the placeholder, i.e. it was made by code
// running under the host-session shim, which only exists after sign-in. Such
// a request without a live session means the session has ended, so the
// caller answers 401 with the expiry marker rather than forwarding it as anon.
export function carriesPlaceholder(authorization: string | null | undefined, pathAndQuery: string): boolean {
  if (authorization && /^bearer\s+host-session\s*$/i.test(authorization)) return true;
  const q = pathAndQuery.indexOf('?');
  if (q < 0) return false;
  return pathAndQuery
    .slice(q + 1)
    .split('&')
    .some((pair) => {
      const key = decodeKey(pair);
      return (key === 'access_token' || key === 'token') && decodeValue(pair) === HOST_SESSION;
    });
}

// Reads a signed-in user who is not an admin may still make, forwarded as
// anon (exactly what a signed-out browser gets) instead of 403.
// platform_settings is what the sign-in page reads through the BFF (logo,
// theme, page transitions), so it must keep working for that user. Public
// storage objects and the two RPCs may also be read; as anon they reveal
// nothing a signed-out browser can't already see. POST is accepted for the
// RPCs because supabase-js calls rpc() with POST. Everything else stays 403.
const PUBLIC_READ_PATHS = new Set(['/rest/v1/platform_settings']);
const PUBLIC_RPC_PATHS = new Set(['/rest/v1/rpc/public_enabled_modules', '/rest/v1/rpc/lfid_sign_in_mode']);
const PUBLIC_READ_PREFIX = '/storage/v1/object/public/';

export function isPublicRead(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (PUBLIC_RPC_PATHS.has(pathname)) return m === 'GET' || m === 'HEAD' || m === 'POST';
  if (m !== 'GET' && m !== 'HEAD') return false;
  return PUBLIC_READ_PATHS.has(pathname) || pathname.startsWith(PUBLIC_READ_PREFIX);
}

// The PoC's CSRF check for cookie-authenticated proxy calls. Browsers send
// Origin on cross-site requests and on same-origin non-GET requests, and
// supabase-js always sends apikey, which a cross-site form post can't.
export function isSameSite(
  origin: string | null | undefined,
  apikey: string | null | undefined,
  siteOrigin: string,
  anonKey: string,
): boolean {
  if (origin && origin !== siteOrigin) return false;
  return apikey === anonKey;
}

export type CsrfDecision = 'session' | 'anon' | 'reject';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

// Only a Bearer Authorization header is proof. Browsers attach Basic,
// Digest, NTLM and Negotiate credentials on their own, without a preflight
// (e.g. behind an ingress that asks for basic auth), so those prove nothing.
function isBearer(authorization: string | null | undefined): boolean {
  return typeof authorization === 'string' && /^Bearer\s/i.test(authorization);
}

// Decides how a proxied request is authenticated.
//
// - 'session': attach the session's token.
// - 'anon': forward without the session (as the anon role).
// - 'reject': refuse with 403.
//
// Unsafe methods: same Origin (or none) AND either the anon key in `apikey`
// (the PoC's rule) or an `Authorization: Bearer ...` header of any value. Amendment to
// decision 1, approved 2026-10-12: about 280 hand-written fetches in admin
// and module code send `Authorization: Bearer host-session` without
// `apikey`. The PoC's rule works because a cross-site page can't attach a
// non-safelisted header without a CORS preflight, and Authorization is in
// the same class; this BFF never answers a preflight with
// Access-Control-Allow-* headers, so a cross-site page can send neither.
//
// GET and HEAD may also prove they are same-origin with
// `Sec-Fetch-Site: same-origin`, because EventSource, <img> and hand-rolled
// fetches to /api can't send `apikey`. A GET that proves neither isn't
// rejected: it is forwarded without the session, so a cross-site page can
// embed a public object but never read anything as the user. (Deliberate
// deviation from the PoC, approved 2026-10-12.)
export function csrfDecision(input: {
  method: string;
  origin: string | null | undefined;
  apikey: string | null | undefined;
  authorization?: string | null | undefined;
  secFetchSite: string | null | undefined;
  siteOrigin: string;
  anonKey: string;
}): CsrfDecision {
  const { method, origin, apikey, authorization, secFetchSite, siteOrigin, anonKey } = input;
  const originOk = !origin || origin === siteOrigin;
  if (isSameSite(origin, apikey, siteOrigin, anonKey)) return 'session';
  if (originOk && isBearer(authorization)) return 'session';
  if (!SAFE_METHODS.has(method.toUpperCase())) return 'reject';
  if (secFetchSite === 'same-origin' && originOk) return 'session';
  return 'anon';
}

// Accepts only same-origin absolute paths, so return_to can't redirect off-site.
export function safeReturnTo(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\') ||
    // Control characters (tabs and newlines are stripped by URL parsers, so
    // "/\t/evil.example" would become "//evil.example").
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    return '/';
  }
  // Percent-encode anything outside printable ASCII (and spaces), so the
  // value is always safe in a Location header.
  try {
    return value.replace(/[^\x21-\x7e]/gu, (c) => encodeURIComponent(c));
  } catch {
    // A lone UTF-16 surrogate can't be encoded; such a path is never valid.
    return '/';
  }
}

// Removes token-bearing query values from a URL before it is logged.
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:access_token|token|refresh_token|code)=)[^&#]*/gi, '$1[redacted]');
}
