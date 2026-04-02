'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { BrandConfig } from '@/config/brand'
import { isLightColor } from '@/config/brand'

export type ViewMode = 'upcoming' | 'past' | 'calendar' | 'map'

interface Props {
  brandConfig: BrandConfig
  upcomingCount: number
  pastCount: number
  basePath?: string // e.g. "/calendars/bond" — defaults to "/events"
  filterSuffix?: string // e.g. "/eu/conferences" — appended to view links to preserve filters
}

export function TimelineTabs({ brandConfig, upcomingCount, pastCount, basePath = '/events', filterSuffix = '' }: Props) {
  const pathname = usePathname()

  // Determine active tab from pathname
  // Matches /events/{view} or /events/{view}/... (with filter segments after)
  const getActiveView = (): ViewMode => {
    const afterBase = pathname.slice(basePath.length)
    if (afterBase.startsWith('/past')) return 'past'
    if (afterBase.startsWith('/calendar')) return 'calendar'
    if (afterBase.startsWith('/map')) return 'map'
    return 'upcoming'
  }

  const activeView = getActiveView()

  return (
    <div className="flex w-full sm:inline-flex sm:w-auto bg-white/10 backdrop-blur-sm p-1 gap-1 border border-white/10" style={{ borderRadius: 'var(--radius-control-outer)' }}>
      <ViewTab
          href={`${basePath}/upcoming${filterSuffix}`}
          active={activeView === 'upcoming'}
          primaryColor={brandConfig.primaryColor}
        >
          <span className="hidden sm:inline">Upcoming</span>
          <span className="sm:hidden">Up</span>
          <TabCount count={upcomingCount} active={activeView === 'upcoming'} primaryColor={brandConfig.primaryColor} />
        </ViewTab>
        <ViewTab
          href={`${basePath}/past${filterSuffix}`}
          active={activeView === 'past'}
          primaryColor={brandConfig.primaryColor}
        >
          Past
          <TabCount count={pastCount} active={activeView === 'past'} primaryColor={brandConfig.primaryColor} />
        </ViewTab>
        <ViewTab
          href={`${basePath}/calendar${filterSuffix}`}
          active={activeView === 'calendar'}
          primaryColor={brandConfig.primaryColor}
        >
          <svg className="w-4 h-4 sm:mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="hidden sm:inline">Calendar</span>
        </ViewTab>
        <ViewTab
          href={`${basePath}/map${filterSuffix}`}
          active={activeView === 'map'}
          primaryColor={brandConfig.primaryColor}
        >
          <svg className="w-4 h-4 sm:mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
            />
          </svg>
          <span className="hidden sm:inline">Map</span>
      </ViewTab>
    </div>
  )
}

function ViewTab({
  href,
  active,
  primaryColor,
  children,
}: {
  href: string
  active: boolean
  primaryColor: string
  children: React.ReactNode
}) {
  const lightPrimary = isLightColor(primaryColor)
  return (
    <Link
      href={href}
      className={`
        cursor-pointer flex items-center justify-center gap-1 flex-1 sm:flex-initial px-4 py-2 text-base font-medium transition-all duration-200 ease-out
        ${active ? 'shadow-lg' : 'text-white/70 hover:text-white hover:bg-white/10'}
      `}
      style={{ borderRadius: 'var(--radius-control)', ...(active ? { backgroundColor: primaryColor, color: lightPrimary ? '#000000' : '#ffffff' } : {}) }}
    >
      {children}
    </Link>
  )
}

function TabCount({ count, active, primaryColor }: { count: number; active: boolean; primaryColor?: string }) {
  const lightPrimary = primaryColor ? isLightColor(primaryColor) : false
  return (
    <span
      className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-medium transition-colors duration-200
                  ${active ? (lightPrimary ? 'bg-black/10' : 'bg-white/20') : 'bg-white/10'}`}
    >
      {count}
    </span>
  )
}
