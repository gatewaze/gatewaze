'use client'

import { useRef, useState, useEffect } from 'react'

/**
 * Returns a ref and a boolean indicating whether the element is in (or near)
 * the viewport. When `inView` is true, the caller should apply backdrop-blur;
 * when false, skip it to save GPU compositing work.
 *
 * Uses a generous rootMargin (200px) so blur is applied before the element
 * scrolls into view — prevents visible "pop-in".
 */
export function useViewportBlur<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(true) // default true to avoid flash

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // If IntersectionObserver isn't available, always blur
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, inView }
}
