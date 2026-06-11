'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLayoutEffect, useRef, useState } from 'react'
import type { BrandConfig } from '@/config/brand'

export type ViewMode = 'upcoming' | 'past' | 'calendar' | 'map'

interface Props {
  brandConfig: BrandConfig
  upcomingCount: number
  pastCount: number
  basePath?: string // e.g. "/calendars/bond" — defaults to "/events"
  filterSuffix?: string // e.g. "/eu/conferences" — appended to view links to preserve filters
}

/**
 * Module-level memory of the indicator's last position. Each route (upcoming/past/calendar/map) is
 * a separate page, so TimelineTabs remounts on navigation — but JS module state survives client-side
 * nav. Seeding the indicator at the previous position then animating to the new active tab reproduces
 * the design's slide-on-click even across route changes. (Reset naturally on full reload.)
 */
let lastIndicator: { left: number; width: number } | null = null

export function TimelineTabs({ upcomingCount, pastCount, basePath = '/events', filterSuffix = '' }: Props) {
  const pathname = usePathname()

  const getActiveView = (): ViewMode => {
    const afterBase = pathname.slice(basePath.length)
    if (afterBase.startsWith('/past')) return 'past'
    if (afterBase.startsWith('/calendar')) return 'calendar'
    if (afterBase.startsWith('/map')) return 'map'
    return 'upcoming'
  }
  const activeView = getActiveView()

  const trackRef = useRef<HTMLDivElement>(null)
  // Seed at the remembered previous position so the indicator animates to the new tab on nav.
  const [ind, setInd] = useState<{ left: number; width: number } | null>(lastIndicator)

  useLayoutEffect(() => {
    const el = trackRef.current?.querySelector<HTMLElement>('.pub-seg-btn.on')
    if (!el) return
    const next = { left: el.offsetLeft, width: el.offsetWidth }
    setInd(next)
    lastIndicator = next
  }, [activeView])

  // Calendar/Map views are hidden for now (routes still resolve if linked directly).
  const tabs: Array<{ view: ViewMode; href: string; label: string; short?: string; count?: number; icon?: React.ReactNode }> = [
    { view: 'upcoming', href: `${basePath}/upcoming${filterSuffix}`, label: 'Upcoming', count: upcomingCount },
    { view: 'past', href: `${basePath}/past${filterSuffix}`, label: 'Past', count: pastCount },
  ]

  return (
    <div className="pub-seg" ref={trackRef} role="tablist" aria-label="Event views">
      {ind && <span className="pub-seg-ind" style={{ transform: `translateX(${ind.left}px)`, width: ind.width }} aria-hidden />}
      {tabs.map((t) => {
        const active = activeView === t.view
        return (
          <Link
            key={t.view}
            href={t.href}
            scroll={false}
            role="tab"
            aria-selected={active}
            className={`pub-seg-btn${active ? ' on' : ''}`}
          >
            {t.icon}
            {t.short ? (
              <>
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.short}</span>
              </>
            ) : (
              <span className={t.icon ? 'hidden sm:inline' : undefined}>{t.label}</span>
            )}
            {t.count != null && <span className="cnt">{t.count}</span>}
          </Link>
        )
      })}
    </div>
  )
}
