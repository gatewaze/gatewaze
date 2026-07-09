/**
 * Browser SDK — first-party relay transport.
 *
 * Events are NOT sent to vendor endpoints from the browser. Every call
 * POSTs to the portal's own relay (`/api/t`, same-origin), which:
 *   - enforces consent server-side (the single enforcement point — it
 *     reads the gw_consent cookie the consent UI mirrors),
 *   - fans out to the first-party store (analytics module / Umami) and
 *     Segment's HTTP API.
 *
 * Why: ad blockers kill cdn.segment.com / api.segment.io, but not the
 * site's own origin. Same-origin also means the gw_aid anonymous-id and
 * gw_consent cookies ride along on every request with zero plumbing.
 *
 * Local in-page sinks are still fed (window.dataLayer + a DOM
 * CustomEvent) so GTM-style integrations keep working — those are
 * in-page pushes, not network calls.
 *
 * The SDK also owns the first-party anonymous id (`gw_aid` cookie):
 * call ensureAnonymousId() once per session (consent-gated by the
 * caller) and the relay reads it from the request cookie.
 */

import type { IdentifyTraits, RelayEvent, TrackProperties } from '../index'
import { ANONYMOUS_ID_COOKIE } from '../index'

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[]
  }
}

/** Same-origin relay path. Deliberately short and generic — ad-blocker
 *  filter lists match on things like /analytics/ or /track/. */
const RELAY_PATH = '/api/t'

// ---------------------------------------------------------------------------
// Anonymous id
// ---------------------------------------------------------------------------

/** 400 days — Chrome's cap on cookie lifetime. */
const ANONYMOUS_ID_MAX_AGE = 400 * 24 * 60 * 60

export function getAnonymousId(): string | null {
  if (typeof document === 'undefined') return null
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === ANONYMOUS_ID_COOKIE) {
      const value = part.slice(eq + 1).trim()
      return value ? decodeURIComponent(value) : null
    }
  }
  return null
}

/**
 * Return the visitor's anonymous id, minting + persisting one on first
 * call. Callers gate this on analytics consent — the SDK itself never
 * decides whether tracking is allowed (the relay does, server-side).
 */
export function ensureAnonymousId(): string | null {
  if (typeof document === 'undefined') return null
  const existing = getAnonymousId()
  if (existing) return existing
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  document.cookie = `${ANONYMOUS_ID_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${ANONYMOUS_ID_MAX_AGE}; SameSite=Lax`
  return id
}

// ---------------------------------------------------------------------------
// Relay transport
// ---------------------------------------------------------------------------

function clientContext(): RelayEvent['client'] {
  if (typeof window === 'undefined') return undefined
  return {
    url: window.location.href,
    // Include the query string — Umami derives utm_* campaign attribution
    // from the url's query params, so a bare pathname silently kills the
    // whole UTM feature.
    path: window.location.pathname + window.location.search,
    referrer: document.referrer || undefined,
    title: document.title || undefined,
    screen: window.screen ? `${window.screen.width}x${window.screen.height}` : undefined,
    language: navigator.language || undefined,
  }
}

function sendToRelay(payload: RelayEvent): void {
  if (typeof window === 'undefined') return
  const body = JSON.stringify(payload)
  try {
    // sendBeacon survives page unloads (link clicks that navigate away)
    // and carries same-origin cookies. Falls back to keepalive fetch.
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(RELAY_PATH, new Blob([body], { type: 'application/json' }))
      if (ok) return
    }
    void fetch(RELAY_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => undefined)
  } catch {
    /* tracking must never break the page */
  }
}

// ---------------------------------------------------------------------------
// Event API
// ---------------------------------------------------------------------------

function pushLocal(event: string, properties?: TrackProperties) {
  if (typeof window === 'undefined') return

  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ event, ...properties })

  document.dispatchEvent(
    new CustomEvent('analytics', { detail: { event, properties } })
  )
}

export function trackEvent(event: string, properties?: TrackProperties) {
  pushLocal(event, properties)
  sendToRelay({ type: 'track', event, properties, client: clientContext() })
}

export function trackPageView(name?: string, properties?: TrackProperties) {
  pushLocal('page_view', { page_name: name, ...properties })
  sendToRelay({ type: 'page', event: name, properties, client: clientContext() })
}

export function identifyUser(userId: string, traits?: IdentifyTraits) {
  pushLocal('identify', { user_id: userId, ...traits })
  sendToRelay({ type: 'identify', userId, traits, client: clientContext() })
}

/**
 * Derive the portal module/section from a pathname for engagement
 * segmentation: '/' → 'home', '/events/abc' → 'events', '/blog/x' → 'blog'.
 */
export function moduleFromPath(pathname: string): string {
  const seg = (pathname.split('?')[0].split('/')[1] || '').trim()
  return seg || 'home'
}
