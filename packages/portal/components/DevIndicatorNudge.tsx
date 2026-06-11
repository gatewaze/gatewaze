'use client'

import { useEffect } from 'react'

/**
 * Dev-only: lift the Next.js dev-tools indicator above the fixed mobile bottom nav.
 *
 * The indicator lives inside `<nextjs-portal>`'s shadow root, so app CSS can't reach it and
 * `devIndicators.position` only offers corners (all of which overlap our chrome on mobile). The
 * shadow root is `mode: "open"`, so we inject a small stylesheet into it that nudges the badge up on
 * mobile widths. No-ops in production (the portal only exists in dev) and if Next changes internals.
 */
export function DevIndicatorNudge() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return

    const STYLE_ID = 'gw-dev-badge-nudge'
    const CSS = `@media (max-width: 820px) {
      [data-next-badge-root], [data-next-badge] {
        transform: translateY(-88px) !important;
        transition: transform .2s ease;
      }
    }`

    let stopped = false
    const tryInject = (): boolean => {
      let injected = false
      document.querySelectorAll('nextjs-portal').forEach((el) => {
        const root = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot
        if (!root || !root.querySelector('[data-next-badge-root]')) return
        if (!root.getElementById(STYLE_ID)) {
          const style = document.createElement('style')
          style.id = STYLE_ID
          style.textContent = CSS
          root.appendChild(style)
        }
        injected = true
      })
      return injected
    }

    if (tryInject()) return
    // The portal/badge mounts after hydration — poll briefly until it appears, then stop.
    const interval = setInterval(() => {
      if (stopped || tryInject()) clearInterval(interval)
    }, 400)
    const timeout = setTimeout(() => clearInterval(interval), 8000)
    return () => {
      stopped = true
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [])

  return null
}

export default DevIndicatorNudge
