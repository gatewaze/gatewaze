/**
 * @gatewaze/tracking — shared conventions for frontend + backend
 * engagement tracking.
 *
 * The platform's tracking model (server-relayed):
 *   - The BROWSER carries a first-party anonymous id in the `gw_aid`
 *     cookie and never talks to vendor endpoints. The client SDK POSTs
 *     every event to the portal's own relay (/api/t) — ad blockers
 *     can't distinguish it from app traffic, and cookies ride along.
 *   - The RELAY is the single consent-enforcement point: it reads the
 *     `gw_consent` cookie (mirrored from the consent UI's localStorage
 *     state) and drops everything when analytics consent is withdrawn.
 *   - SERVER-side fan-out via createServerTracker(): the analytics
 *     module's /a/collect ingest (first-party store) and, when a write
 *     key is configured, Segment's HTTP API. Backend emitters (route
 *     handlers, workers) use the same tracker — and the same consent
 *     gate via the portal's getRequestTracking().
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

/** Consent-mirror cookie. The cookie-consent UI persists choices to
 *  localStorage (which servers can't read) AND mirrors the category map
 *  here so backend code — the /api/t relay, route-handler events — can
 *  enforce the same consent. Value: URI-encoded JSON
 *  `{"analytics":bool,"marketing":bool,"functional":bool}`. */
export const CONSENT_COOKIE = 'gw_consent'

export interface ConsentCategories {
  analytics: boolean
  marketing: boolean
  functional: boolean
}

/**
 * Read the mirrored consent categories from a Cookie header.
 *
 * Returns null when the visitor has made no explicit choice yet — the
 * platform's consent model is opt-out (implicit consent until denied),
 * so callers should treat null as "allowed" to match the client-side
 * useConsent defaults. An explicit denial always comes back as
 * `{ analytics: false, ... }`.
 */
export function consentFromCookieHeader(cookieHeader: string | null | undefined): ConsentCategories | null {
  const raw = readCookie(cookieHeader, CONSENT_COOKIE)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentCategories>
    return {
      analytics: parsed.analytics !== false,
      marketing: parsed.marketing !== false,
      functional: parsed.functional !== false,
    }
  } catch {
    return null
  }
}

/** True when the visitor is trackable: either no explicit choice yet
 *  (implicit consent, matching the client default) or an explicit grant. */
export function hasAnalyticsConsent(cookieHeader: string | null | undefined): boolean {
  const consent = consentFromCookieHeader(cookieHeader)
  return consent === null || consent.analytics
}

function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim()
      try {
        return value ? decodeURIComponent(value) : null
      } catch {
        return null
      }
    }
  }
  return null
}

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
  return readCookie(cookieHeader, ANONYMOUS_ID_COOKIE)
}

/** Relay wire format — what the client SDK POSTs to the portal's
 *  first-party /api/t endpoint. */
export interface RelayEvent {
  type: 'track' | 'page' | 'identify'
  /** track: event name. page: optional page name. */
  event?: string
  properties?: TrackProperties
  /** identify only */
  userId?: string
  traits?: IdentifyTraits
  /** Browser-context the server can't derive itself. */
  client?: {
    url?: string
    path?: string
    referrer?: string
    title?: string
    screen?: string
    language?: string
  }
}
