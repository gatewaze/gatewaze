/**
 * Browser SDK.
 *
 * One call fans out to every configured sink, so product code never
 * cares which vendor (if any) a brand has installed:
 *   - window.dataLayer + a DOM CustomEvent (GTM / custom integrations)
 *   - window.analytics (Segment, injected via admin tracking code)
 *   - window.umami (the analytics module's first-party store)
 *
 * The SDK also owns the first-party anonymous id (`gw_aid` cookie):
 * call ensureAnonymousId() once per session (consent-gated by the
 * caller) and every subsequent event/identify carries it, giving the
 * internal store the same anonymous→person join Segment does with
 * ajs_anonymous_id.
 */

import { ANONYMOUS_ID_COOKIE, type IdentifyTraits, type TrackProperties } from '../index'

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[]
    analytics?: {
      track: (event: string, properties?: Record<string, unknown>) => void
      page: (name?: string, properties?: Record<string, unknown>) => void
      identify: (userId: string, traits?: Record<string, unknown>) => void
    }
    umami?: {
      track: (event: string, properties?: Record<string, unknown>) => void
      identify?: (data: Record<string, unknown>) => void
    }
  }
}

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
 * decides whether tracking is allowed.
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
// Event fan-out
// ---------------------------------------------------------------------------

function withAnonymousId(properties?: TrackProperties): TrackProperties | undefined {
  const anonymousId = getAnonymousId()
  if (!anonymousId) return properties
  return { anonymous_id: anonymousId, ...properties }
}

function pushEvent(event: string, properties?: TrackProperties) {
  if (typeof window === 'undefined') return

  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ event, ...properties })

  document.dispatchEvent(
    new CustomEvent('analytics', { detail: { event, properties } })
  )
}

export function trackEvent(event: string, properties?: TrackProperties) {
  const props = withAnonymousId(properties)
  pushEvent(event, props)
  window.analytics?.track(event, props)
  // First-party store (analytics module / Umami) — page views are auto-tracked
  // by its tracker, so only custom events fan out here.
  try {
    window.umami?.track(event, props)
  } catch {
    /* first-party tracker absent/not ready — vendor path already fired */
  }
}

export function trackPageView(name?: string, properties?: TrackProperties) {
  const props = withAnonymousId(properties)
  pushEvent('page_view', { page_name: name, ...props })
  window.analytics?.page(name, props)
}

export function identifyUser(userId: string, traits?: IdentifyTraits) {
  const enriched = withAnonymousId(traits)
  pushEvent('identify', { user_id: userId, ...enriched })
  window.analytics?.identify(userId, enriched)
  // Umami ≥2.13 session data (no-op guard for older trackers).
  try {
    window.umami?.identify?.({ user_id: userId, ...enriched })
  } catch {
    /* ignore */
  }
}

/**
 * Derive the portal module/section from a pathname for engagement
 * segmentation: '/' → 'home', '/events/abc' → 'events', '/blog/x' → 'blog'.
 */
export function moduleFromPath(pathname: string): string {
  const seg = (pathname.split('?')[0].split('/')[1] || '').trim()
  return seg || 'home'
}
