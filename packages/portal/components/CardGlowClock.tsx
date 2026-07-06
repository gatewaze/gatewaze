'use client'

import { useEffect } from 'react'
import { acquireGlowClock } from '@/lib/glowClock'

/**
 * Desktop activation tracker for the shared card-glow clock.
 *
 * The glow border on `.gw-card-glow` cards only shows on :hover (desktop) or
 * `.gw-glow-active` (mobile — driven by useNearestCenterGlow, which holds the
 * clock itself). This component watches pointer movement via delegated
 * listeners and holds the refcounted clock (lib/glowClock.ts) only while the
 * pointer is inside a glow card. No hovered card → no rAF loop → no page-wide
 * style invalidation on idle pages.
 *
 * JS-driven on purpose: animating a registered `@property` via CSS keyframes
 * through inheritance is mishandled by iOS Safari.
 */
export function CardGlowClock() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let release: (() => void) | null = null

    const stop = () => {
      release?.()
      release = null
    }

    // pointerover fires on every hovered-element change, so transitions
    // between cards keep the hold; landing on a non-card element drops it.
    const onPointerOver = (e: Event) => {
      const card = (e.target as Element | null)?.closest?.('.gw-card-glow')
      if (card && !release) {
        release = acquireGlowClock()
      } else if (!card && release) {
        stop()
      }
    }

    document.addEventListener('pointerover', onPointerOver, { passive: true })
    // Pointer left the document entirely (no pointerover fires for that).
    document.addEventListener('pointerleave', stop)
    // Tab hidden: rAF is throttled anyway, but drop the hold so the loop
    // isn't resumed the moment the tab is foregrounded without a pointer.
    document.addEventListener('visibilitychange', stop)

    return () => {
      document.removeEventListener('pointerover', onPointerOver)
      document.removeEventListener('pointerleave', stop)
      document.removeEventListener('visibilitychange', stop)
      stop()
    }
  }, [])

  return null
}

export default CardGlowClock
