'use client'

import { useEffect, useRef, useState } from 'react'
import { acquireGlowClock } from '@/lib/glowClock'
import { MOBILE_MEDIA_QUERY } from '@/lib/breakpoints'

/**
 * Shared "nearest to the viewport centre" coordinator for the mobile timeline glow.
 *
 * Touch devices have no hover, so as the page scrolls we want exactly one card lit at all times —
 * the one closest to the viewport's vertical centre. A per-card IntersectionObserver alone can only
 * tell whether a card *straddles* the centre line, which leaves nothing lit at the top of the page or
 * in the gaps between cards. So we still measure distance to the centre with getBoundingClientRect.
 *
 * What the observer IS for: deciding which cards are worth measuring. The timeline virtualises by
 * date group, and one date can hold 30+ events, so a few hundred cards can be mounted at once. The
 * old version measured every registered card on every scroll frame, which is a forced synchronous
 * layout per card per frame on exactly the devices least able to afford it. The observer keeps a
 * `nearby` set of cards within half a viewport of the centre, and only those get measured, so the
 * per-frame cost tracks what is visible rather than what is mounted.
 */
type Entry = { el: HTMLElement; setActive: (v: boolean) => void }

const entries = new Set<Entry>()
/** Cards the observer says are close enough to the viewport to be candidates. */
const nearby = new Set<Entry>()
const byElement = new WeakMap<Element, Entry>()
let activeEntry: Entry | null = null
let frame = 0
let bound = false
let observer: IntersectionObserver | null = null

function ensureObserver(): void {
  if (observer || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        const entry = byElement.get(record.target)
        if (!entry) continue
        if (record.isIntersecting) nearby.add(entry)
        else nearby.delete(entry)
      }
      schedule()
    },
    // Root stays the viewport even when an ancestor is the scroll container —
    // IntersectionObserver accounts for ancestor clipping either way. The band
    // is half a viewport each side of it, comfortably wider than any gap
    // between cards, so the nearest card to the centre is always in the set.
    { rootMargin: '50% 0px 50% 0px', threshold: 0 },
  )
}

function recompute() {
  frame = 0
  // Without an observer (no support) fall back to measuring everything, which
  // is the previous behaviour and still correct, just more expensive.
  const candidates = observer ? nearby : entries
  if (candidates.size === 0) {
    activeEntry?.setActive(false)
    activeEntry = null
    return
  }
  const center = window.innerHeight / 2
  let best: Entry | null = null
  let bestDist = Infinity
  for (const e of candidates) {
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
  byElement.set(entry.el, entry)
  ensureObserver()
  observer?.observe(entry.el)
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
    nearby.delete(entry)
    byElement.delete(entry.el)
    observer?.unobserve(entry.el)
    if (activeEntry === entry) activeEntry = null
    schedule()
  }
}

/** Attach the returned ref to a card; `active` is true when it's the card nearest the viewport centre
 *  (only ever active on mobile widths, matching the CSS that consumes it). */
export function useNearestCenterGlow<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [active, setActive] = useState(false)

  // Hold the shared glow clock only while this card is the active one —
  // the clock is refcounted (lib/glowClock.ts) and stops when nothing
  // holds it, so idle pages don't pay for a 60fps :root style write.
  useEffect(() => {
    if (!active) return
    return acquireGlowClock()
  }, [active])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const mq = window.matchMedia(MOBILE_MEDIA_QUERY)
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
