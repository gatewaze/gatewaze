'use client'

import { useEffect } from 'react'

/**
 * Drives one shared, continuously-advancing angle for the card glow borders.
 *
 * A single requestAnimationFrame loop writes `--gw-glow-angle` on :root; every `.gw-card-glow`
 * border reads it via inheritance. Because there's a single clock, whichever card is currently
 * visible (hover on desktop, nearest-to-centre on mobile) is always in continuous phase — a newly
 * activated card picks up exactly where the previous one left off. JS-driven on purpose: animating a
 * registered `@property` via CSS keyframes through inheritance is mishandled by iOS Safari.
 */
const PERIOD_MS = 2400 // one full rotation

export function CardGlowClock() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    let raf = 0
    const tick = (t: number) => {
      const angle = ((t / PERIOD_MS) * 360) % 360
      root.style.setProperty('--gw-glow-angle', angle.toFixed(2) + 'deg')
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return null
}

export default CardGlowClock
