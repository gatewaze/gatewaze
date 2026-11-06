'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useConsent } from '@/hooks/useConsent'
import {
  auth0ClaimsForUser,
  forwardableTrack,
  sanitizeSegmentEvent,
  type LfxSegmentAnalytics,
} from '@/lib/lfx-segment'

declare global {
  interface Window {
    LfxAnalytics?: { LfxSegmentsAnalytics?: { getInstance?: () => LfxSegmentAnalytics } }
  }
}

let loading: Promise<LfxSegmentAnalytics | null> | null = null

/** Indirection so tests can observe the reload. */
export const pageControl = { reload: () => window.location.reload() }
function reloadPage() {
  pageControl.reload()
}

/** Loads LF's wrapper once per page and starts it in protected mode, so
 * every event (including the wrapper's own first page view) passes through
 * the sanitizer. Fails closed: no protected init, no tracking. */
function loadWrapper(src: string, writeKey?: string): Promise<LfxSegmentAnalytics | null> {
  loading ??= new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = async () => {
      const analytics = window.LfxAnalytics?.LfxSegmentsAnalytics?.getInstance?.()
      if (!analytics || typeof analytics.initWithEventSanitizer !== 'function') {
        console.error('[lfx-segment] wrapper does not support protected initialization; tracking disabled')
        return resolve(null)
      }
      try {
        await (writeKey
          ? analytics.initWithEventSanitizer(sanitizeSegmentEvent, writeKey)
          : analytics.initWithEventSanitizer(sanitizeSegmentEvent))
        resolve(analytics)
      } catch {
        // The raw error is not logged: it may carry event payloads or URLs.
        console.error('[lfx-segment] protected initialization failed; tracking disabled')
        resolve(null)
      }
    }
    script.onerror = () => resolve(null)
    document.head.appendChild(script)
  })
  return loading
}

/**
 * Sends the portal's Segment identify / page / track calls through LF's
 * wrapper script, the same one every LFX app uses, so the userId (CDP
 * member UUID) and traits match LFX. Rendered only when the deployment sets
 * LFX_SEGMENT_CDN_URL; the server relay's Segment leg is off in that case.
 */
export function LfxSegment({ src, writeKey }: { src: string; writeKey?: string }) {
  const { user, isLoading } = useAuth()
  const { categories } = useConsent()
  const pathname = usePathname()
  const consented = categories.analytics
  const consentRef = useRef(consented)
  const identifiedRef = useRef<string | null>(null)
  const firstPageRef = useRef(true)

  useEffect(() => {
    const wasConsented = consentRef.current
    consentRef.current = consented
    // Consent withdrawn after the wrapper loaded. The script cannot be
    // unloaded and keeps its own listeners (cross-domain anonymous id on LF
    // links), so clear its stored identity and reload: the fresh page never
    // loads it.
    if (wasConsented && !consented && loading) {
      identifiedRef.current = null
      void loading.then(async (analytics) => {
        try {
          if (analytics) await analytics.reset()
        } catch {
          /* tracking must never break the page */
        }
        if (analytics) reloadPage()
      })
    }
  }, [consented])

  // Identify on sign-in, reset on sign-out.
  useEffect(() => {
    if (!consented || isLoading) return
    let cancelled = false
    void loadWrapper(src, writeKey).then((analytics) => {
      if (!analytics || cancelled) return
      try {
        if (!user) {
          if (identifiedRef.current) {
            void analytics.reset()
            identifiedRef.current = null
          }
          return
        }
        if (identifiedRef.current === user.id) return
        const claims = auth0ClaimsForUser(user as Parameters<typeof auth0ClaimsForUser>[0])
        if (!claims) return
        void analytics.identifyAuth0User(claims)
        identifiedRef.current = user.id
      } catch {
        /* tracking must never break the page */
      }
    })
    return () => {
      cancelled = true
    }
  }, [user, isLoading, consented, src, writeKey])

  // Page views on route changes. The wrapper sends the first page view
  // itself when it starts, so the initial render is skipped.
  useEffect(() => {
    if (!consented) return
    if (firstPageRef.current) {
      firstPageRef.current = false
      return
    }
    void loadWrapper(src, writeKey).then((analytics) => {
      if (!analytics) return
      try {
        void analytics.page(document.title, {
          path: window.location.pathname,
          url: window.location.href,
          search: window.location.search,
          title: document.title,
          referrer: document.referrer,
        })
      } catch {
        /* tracking must never break the page */
      }
    })
  }, [pathname, consented, src, writeKey])

  // Custom events from the portal SDK (Link Clicked, Signed In, ...).
  useEffect(() => {
    const onEvent = (e: Event) => {
      if (!consentRef.current) return
      const call = forwardableTrack((e as CustomEvent).detail)
      if (!call) return
      void loadWrapper(src, writeKey).then((analytics) => {
        try {
          if (analytics) void analytics.track(call.event, call.properties)
        } catch {
          /* tracking must never break the page */
        }
      })
    }
    document.addEventListener('analytics', onEvent)
    return () => document.removeEventListener('analytics', onEvent)
  }, [src, writeKey])

  return null
}
