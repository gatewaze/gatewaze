'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Event } from '@/types/event'
import type { EventUserState } from '@/hooks/useEventUserState'
import { isOnCustomDomain } from '@/lib/customDomain'
import { useNavItems } from './EventSidebar'

interface Props {
  event: Event
  eventIdentifier: string
  useDarkText: boolean
  speakerCount: number
  sponsorCount: number
  competitionCount: number
  discountCount: number
  mediaCount: number
  hasVirtualEvent?: boolean
  userState?: EventUserState
}

/**
 * Compact section menu for the event-detail page (matches the mockup): icon + label rows, the active
 * section subtly filled. Sticky vertical column on desktop; a horizontal scroller above the content on
 * mobile. Config-dependent items come from the shared `useNavItems`.
 */
export function EventSectionMenu(props: Props) {
  return (
    <Suspense fallback={null}>
      <EventSectionMenuInner {...props} />
    </Suspense>
  )
}

function EventSectionMenuInner({
  event,
  eventIdentifier,
  useDarkText,
  speakerCount,
  sponsorCount,
  competitionCount,
  discountCount,
  mediaCount,
  hasVirtualEvent = false,
  userState,
}: Props) {
  const pathname = usePathname()
  const basePath = isOnCustomDomain() ? '' : `/events/${eventIdentifier}`
  const items = useNavItems(event, basePath, speakerCount, sponsorCount, competitionCount, discountCount, mediaCount, hasVirtualEvent, userState)

  const isActive = (href: string) => {
    const detailsHref = basePath || '/'
    if (href === detailsHref) return pathname === detailsHref || pathname === `${basePath}/`
    return pathname.startsWith(href)
  }

  const ink = useDarkText ? '#111827' : '#ffffff'
  const inkMuted = useDarkText ? 'rgba(17,24,39,0.65)' : 'rgba(255,255,255,0.72)'
  const activeBg = useDarkText ? 'rgba(17,24,39,0.07)' : 'rgba(255,255,255,0.10)'

  const itemClass =
    'flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-sm font-medium whitespace-nowrap transition-colors [&_svg]:w-4 [&_svg]:h-4'

  return (
    <nav className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-visible lg:sticky lg:top-24 pb-2 lg:pb-0">
      {items.map((item) => {
        const active = !item.external && isActive(item.href)
        const style = { color: active ? ink : inkMuted, backgroundColor: active ? activeBg : 'transparent' }
        const inner = (
          <>
            <span className="flex-shrink-0" style={{ color: active ? ink : inkMuted }}>{item.icon}</span>
            <span>{item.label}</span>
          </>
        )
        return item.external ? (
          <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" className={itemClass} style={style}>
            {inner}
          </a>
        ) : (
          <Link key={item.href} href={item.href} className={itemClass} style={style}>
            {inner}
          </Link>
        )
      })}
    </nav>
  )
}

export default EventSectionMenu
