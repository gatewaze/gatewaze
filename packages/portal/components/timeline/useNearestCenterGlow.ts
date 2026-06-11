'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Shared "nearest to the viewport centre" coordinator for the mobile timeline glow.
 *
 * Touch devices have no hover, so as the page scrolls we want exactly one card lit at all times —
 * the one closest to the viewport's vertical centre. A per-card IntersectionObserver can only tell
 * whether a card *straddles* the centre line, which leaves nothing lit at the top of the page or in
 * the gaps between cards. Instead every card registers its element here; on scroll/resize we measure
 * each registered card's distance to the centre line (0 if it straddles it) and activate the nearest.
 */
type Entry = { el: HTMLElement; setActive: (v: boolean) => void }

const entries = new Set<Entry>()
let activeEntry: Entry | null = null
let frame = 0
let bound = false

function recompute() {
  frame = 0
  if (entries.size === 0) {
    activeEntry = null
    return
  }
  const center = window.innerHeight / 2
  let best: Entry | null = null
  let bestDist = Infinity
  for (const e of entries) {
    const r = e.el.getBoundingClientRect()
    // 0 while the card spans the centre line; otherwise the gap to its nearest edge.
    const dist = r.top > center ? r.top - center : r.bottom < center ? center - r.bottom : 0
    if (dist < bestDist) {
      bestDist = dist
      best = e
    }
  }
  if (best !== activeEntry) {
    activeEntry?.setActive(false)
    activeEntry = best
    best?.setActive(true)
  }
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(recompute)
}

function register(entry: Entry): () => void {
  entries.add(entry)
  if (!bound) {
    // `capture: true` so we catch scroll from the actual scroll container (the logged-out site
    // scrolls inside `.pub-area`, not the window, and scroll events don't bubble).
    window.addEventListener('scroll', schedule, { passive: true, capture: true })
    window.addEventListener('resize', schedule, { passive: true })
    bound = true
  }
  schedule()
  return () => {
    entries.delete(entry)
    if (activeEntry === entry) activeEntry = null
    schedule()
  }
}

/** Attach the returned ref to a card; `active` is true when it's the card nearest the viewport centre
 *  (only ever active on mobile widths, matching the CSS that consumes it). */
export function useNearestCenterGlow<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const mq = window.matchMedia('(max-width: 820px)')
    let cleanup: (() => void) | undefined
    const sync = () => {
      if (mq.matches && !cleanup) {
        cleanup = register({ el, setActive })
      } else if (!mq.matches && cleanup) {
        cleanup()
        cleanup = undefined
        setActive(false)
      }
    }
    sync()
    mq.addEventListener('change', sync)
    return () => {
      mq.removeEventListener('change', sync)
      cleanup?.()
    }
  }, [])

  return { ref, active }
}
