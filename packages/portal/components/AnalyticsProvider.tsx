'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useConsent } from '@/hooks/useConsent'
import { identifyUser, trackEvent, moduleFromPath } from '@/lib/analytics'

/**
 * Analytics provider — the portal's engagement-tracking spine.
 *
 * 1. IDENTITY RESOLUTION: when a user signs in (or arrives with a session),
 *    calls identify(userId, traits). Segment/GTM then merge the visitor's
 *    anonymous history (ajs_anonymous_id) into the signed-in user — without
 *    this, anonymous page views were never attributed to anyone.
 * 2. SIGNED-IN EVENT: a `Signed In` track on the anonymous→signed-in
 *    transition inside a mounted session (not on mere session restore).
 * 3. GLOBAL LINK CLICKS: one delegated listener tracks every <a> click in the
 *    portal (href, text, source module, outbound) — no per-component wiring.
 *
 * All of it respects the analytics consent category. The actual vendor
 * scripts (Segment etc.) are injected via admin-configured tracking code.
 */
export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const { categories } = useConsent()
  const pathname = usePathname()
  const consented = categories.analytics

  // Refs so the click listener and auth effect always see current values
  // without re-subscribing.
  const pathRef = useRef(pathname)
  pathRef.current = pathname
  const consentRef = useRef(consented)
  consentRef.current = consented

  // -- Identity resolution ---------------------------------------------------
  const identifiedIdRef = useRef<string | null>(null)
  const sawSignedOutRef = useRef(false)
  useEffect(() => {
    if (isLoading || !consented) return
    if (!user) {
      // Loaded and signed out: a later sign-in is a genuine transition.
      sawSignedOutRef.current = true
      identifiedIdRef.current = null
      return
    }
    if (identifiedIdRef.current === user.id) return
    identifiedIdRef.current = user.id

    const meta = (user.user_metadata ?? {}) as Record<string, unknown>
    identifyUser(user.id, {
      email: user.email,
      name: (meta.full_name as string) || (meta.name as string) || undefined,
    })
    // Only on the anonymous→signed-in flip within this mount — session
    // restores on page load identify silently without a Signed In event.
    if (sawSignedOutRef.current) {
      trackEvent('Signed In', { method: (meta.provider as string) || undefined })
      sawSignedOutRef.current = false
    }
  }, [user, isLoading, consented])

  // -- Global link-click tracking ---------------------------------------------
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!consentRef.current) return
      const target = e.target as Element | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href') || ''
      // Ignore in-page anchors and javascript: pseudo-links.
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return

      let outbound = false
      try {
        outbound = new URL(anchor.href, window.location.href).host !== window.location.host
      } catch {
        /* unparsable href — treat as internal */
      }

      trackEvent('Link Clicked', {
        href,
        link_text: (anchor.textContent || '').trim().slice(0, 80) || undefined,
        module: moduleFromPath(pathRef.current || '/'),
        path: pathRef.current,
        outbound,
      })
    }
    // Capture phase so navigations can't unbind us before we record the click.
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  return <>{children}</>
}
