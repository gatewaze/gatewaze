'use client'

/**
 * Refcounted driver for the shared card-glow angle.
 *
 * Writes `--gw-glow-angle` on :root only while at least one holder needs it —
 * a hovered `.gw-card-glow` on desktop (see CardGlowClock's delegated pointer
 * tracking) or the nearest-to-centre card on mobile (useNearestCenterGlow).
 * Previously the loop ran unconditionally from mount: a 60fps write to a
 * :root custom property invalidates styles page-wide every frame, which
 * showed up as constant CPU on completely idle portal tabs.
 *
 * The angle derives from the rAF timestamp, so a freshly started clock is
 * automatically in phase with where a previous run left off — cards stay in
 * continuous phase across pause/resume just like the always-on version.
 */
const PERIOD_MS = 2400 // one full rotation

let holders = 0
let raf = 0

function tick(t: number) {
  const angle = ((t / PERIOD_MS) * 360) % 360
  document.documentElement.style.setProperty('--gw-glow-angle', angle.toFixed(2) + 'deg')
  raf = holders > 0 ? requestAnimationFrame(tick) : 0
}

/**
 * Hold the clock while some card actively shows its glow. Returns a release
 * function (idempotent). Respects prefers-reduced-motion by never starting.
 */
export function acquireGlowClock(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}

  holders++
  if (!raf) raf = requestAnimationFrame(tick)

  let released = false
  return () => {
    if (released) return
    released = true
    holders--
    // The loop notices holders === 0 on its next tick and stops itself.
  }
}
