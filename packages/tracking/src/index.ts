/**
 * @gatewaze/tracking — shared conventions for frontend + backend
 * engagement tracking.
 *
 * The platform's tracking model:
 *   - The BROWSER carries a first-party anonymous id in the `gw_aid`
 *     cookie (set by the client SDK, vendor-neutral — works whether or
 *     not Segment/GTM is installed).
 *   - CLIENT events fan out to every configured sink: window.dataLayer
 *     (GTM), window.analytics (Segment), window.umami (the analytics
 *     module's first-party store).
 *   - SERVER events go through createServerTracker(), which posts to the
 *     analytics module's /a/collect ingest (first-party store) and, when
 *     a write key is configured, Segment's HTTP API.
 *   - Same-origin server code (Next route handlers) reads the anonymous
 *     id straight from the request cookie; cross-origin API calls can
 *     carry it in the `x-gw-anonymous-id` header instead.
 *
 * Entry points:
 *   @gatewaze/tracking          — constants + shared types (isomorphic)
 *   @gatewaze/tracking/client   — browser SDK
 *   @gatewaze/tracking/server   — Node SDK
 */

/** First-party anonymous-id cookie. Set by the client SDK on the portal
 *  host; readable by same-origin server routes. */
export const ANONYMOUS_ID_COOKIE = 'gw_aid'

/** Header used to forward the anonymous id on cross-origin API calls
 *  (the cookie doesn't travel to sibling hosts). */
export const ANONYMOUS_ID_HEADER = 'x-gw-anonymous-id'

export type TrackProperties = Record<string, unknown>
export type IdentifyTraits = Record<string, unknown>

/** Per-event request context, threaded through to the sinks so server
 *  events join the visitor's browser session (Umami hashes IP+UA into
 *  its session id; Segment stores them on the event context). */
export interface TrackContext {
  /** Originating client IP (X-Forwarded-For first hop). */
  ip?: string | null
  /** Originating browser User-Agent. */
  userAgent?: string | null
  /** Page URL or path the action relates to. */
  url?: string | null
  /** Origin to present to the ingest allowlist (e.g. the portal origin). */
  origin?: string | null
}

/**
 * Extract the anonymous id from a Cookie header string. Isomorphic —
 * usable from Express (`req.headers.cookie`) and Next
 * (`req.headers.get('cookie')`) alike.
 */
export function anonymousIdFromCookieHeader(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === ANONYMOUS_ID_COOKIE) {
      const value = part.slice(eq + 1).trim()
      return value ? decodeURIComponent(value) : null
    }
  }
  return null
}
