/**
 * Generic analytics layer.
 *
 * Pushes events to `window.dataLayer` (GTM-compatible) so any analytics
 * tool configured via the admin settings tracking code can pick them up.
 *
 * Also dispatches CustomEvents on `document` for non-GTM integrations.
 */

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

function pushEvent(event: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined') return

  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ event, ...properties })

  document.dispatchEvent(
    new CustomEvent('analytics', { detail: { event, properties } })
  )
}

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  pushEvent(event, properties)
  window.analytics?.track(event, properties)
  // First-party store (analytics module / Umami) — page views are auto-tracked
  // by its tracker, so only custom events fan out here.
  try {
    window.umami?.track(event, properties)
  } catch {
    /* first-party tracker absent/not ready — vendor path already fired */
  }
}

export function trackPageView(name?: string, properties?: Record<string, unknown>) {
  pushEvent('page_view', { page_name: name, ...properties })
  window.analytics?.page(name, properties)
}

export function identifyUser(userId: string, traits?: Record<string, unknown>) {
  pushEvent('identify', { user_id: userId, ...traits })
  window.analytics?.identify(userId, traits)
  // Umami ≥2.13 session data (no-op guard for older trackers).
  try {
    window.umami?.identify?.({ user_id: userId, ...traits })
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
