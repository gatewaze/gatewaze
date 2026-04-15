'use client'

import { useState, useEffect, type RefObject } from 'react'
import Link from 'next/link'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import { isOnCustomDomain } from '@/lib/customDomain'

interface Props {
  event: Event & { id: string }
  brandConfig: BrandConfig
  heroRef: RefObject<HTMLDivElement | null>
  eventIdentifier: string
}

function formatShortDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return null
  }
}

export function EventCompactBar({ event, brandConfig, heroRef, eventIdentifier }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = heroRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { threshold: 0, rootMargin: '-56px 0px 0px 0px' } // offset by header height
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [heroRef])

  const imageUrl = event.event_logo || event.screenshot_url
  const shortDate = formatShortDate(event.event_start)
  const city = event.event_city
  const basePath = isOnCustomDomain() ? '' : `/events/${eventIdentifier}`
  const eventUrl = basePath || '/'

  return (
    <div
      className="fixed left-0 right-0 z-[90] pointer-events-none"
      style={{ top: 56 }}
    >
      <div
        className="pointer-events-auto transition-all duration-200 ease-out"
        style={{
          transform: visible ? 'translateY(0)' : 'translateY(-100%)',
          opacity: visible ? 1 : 0,
        }}
      >
        <div className="max-w-7xl mx-auto px-6">
          <Link
            href={eventUrl}
            className="flex items-center gap-3 py-2.5 px-4 mt-2 bg-white/10 border border-white/10 transition-colors hover:bg-white/15"
            style={{
              borderRadius: 'var(--radius-card)',
              backdropFilter: 'blur(var(--glass-blur, 4px))',
              WebkitBackdropFilter: 'blur(var(--glass-blur, 4px))',
            }}
          >
            {/* Thumbnail */}
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=""
                className="w-9 h-9 lg:w-10 lg:h-10 rounded-lg object-cover flex-shrink-0"
              />
            ) : (
              <div
                className="w-9 h-9 lg:w-10 lg:h-10 rounded-lg flex-shrink-0 flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: brandConfig.primaryColor }}
              >
                {event.event_title?.charAt(0) || '?'}
              </div>
            )}

            {/* Title */}
            <span className="flex-1 min-w-0 text-sm lg:text-base font-semibold text-white truncate">
              {event.event_title}
            </span>

            {/* Date + City — desktop only */}
            {(shortDate || city) && (
              <span className="hidden lg:flex items-center gap-1.5 text-sm text-white/60 flex-shrink-0">
                {shortDate && <span>{shortDate}</span>}
                {shortDate && city && <span>·</span>}
                {city && <span>{city}</span>}
              </span>
            )}
          </Link>
        </div>
      </div>
    </div>
  )
}
