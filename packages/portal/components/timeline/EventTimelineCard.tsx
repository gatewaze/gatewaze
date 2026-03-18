'use client'

import { useRef, useCallback } from 'react'
import Link from 'next/link'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import { isLightColor } from '@/config/brand'
import { formatEventTime, formatEventDate } from './utils'
import { type UserLocation, getDistanceToEventByCity, formatUserDistance, usesImperialUnits } from '@/lib/location'
import { stripEmojis } from '@/lib/text'

interface Props {
  event: Event
  brandConfig: BrandConfig
  userLocation?: UserLocation | null
  showDate?: boolean
}

export function EventTimelineCard({ event, brandConfig, userLocation, showDate }: Props) {
  const eventUrl = `/events/${event.event_slug || event.event_id}`
  const imageUrl = event.event_logo || event.screenshot_url
  const glowRef = useRef<HTMLDivElement>(null)

  const location = [event.venue_address, event.event_city]
    .filter(Boolean)
    .filter((s) => s && s.toLowerCase() !== 'na')
    .join(', ')

  // Calculate distance if user location is available
  const distanceKm = getDistanceToEventByCity(userLocation || null, event.event_city)
  const useMiles = usesImperialUnits(userLocation?.country || '')
  const formattedDistance = distanceKm !== null ? formatUserDistance(distanceKm, useMiles) : null

  const timeStr = formatEventTime(event.event_start)
  const dateStr = showDate ? formatEventDate(event.event_start) : null

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!glowRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    glowRef.current.style.opacity = '1'
    glowRef.current.style.background = `radial-gradient(250px circle at ${x}% ${y}%, rgba(255,255,255,0.15), transparent 70%)`
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (!glowRef.current) return
    glowRef.current.style.opacity = '0'
  }, [])

  return (
    <Link href={eventUrl} className="block group">
      <div
        className="relative bg-white/[0.06] rounded-xl border border-white/[0.08] overflow-hidden
                   hover:bg-white/[0.10] hover:border-white/[0.15] transition-all duration-200
                   flex"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Mouse-tracking border glow */}
        <div
          ref={glowRef}
          className="absolute inset-0 pointer-events-none opacity-0 transition-opacity duration-300 rounded-xl"
          style={{
            padding: '1px',
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            maskComposite: 'exclude',
          }}
        />

        {/* Event Details */}
        <div className="flex-1 min-w-0 p-3 flex flex-col justify-center">
          {/* Title */}
          <h3
            className="text-white font-semibold text-sm sm:text-base
                       group-hover:text-white/90 transition-colors line-clamp-2"
          >
            {stripEmojis(event.event_title)}
          </h3>

          {/* Mobile: date · time · location, then distance on next line */}
          <div className="sm:hidden mt-1 space-y-1">
            <div className="text-white/80 text-xs truncate" suppressHydrationWarning>
              {[dateStr, timeStr, location].filter(Boolean).join(' · ')}
            </div>
            {formattedDistance && (
              <div className="mt-0.5 -ml-1">
                <DistanceBadge distance={formattedDistance} primaryColor={brandConfig.primaryColor} />
              </div>
            )}
          </div>

          {/* Desktop: date + time, location, then distance each on own line */}
          <div className="hidden sm:block mt-1 space-y-0.5">
            <div className="text-white/90 text-sm" suppressHydrationWarning>
              {[dateStr, timeStr].filter(Boolean).join(' · ')}
            </div>
            {location && (
              <div className="text-white/80 text-sm truncate">{location}</div>
            )}
            {formattedDistance && (
              <div className="mt-1.5 -ml-1">
                <DistanceBadge distance={formattedDistance} primaryColor={brandConfig.primaryColor} />
              </div>
            )}
          </div>
        </div>

        {/* Event Screenshot — flush to top, right & bottom edges */}
        {imageUrl && (
          <div className="flex-shrink-0 w-28 sm:w-36">
            <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          </div>
        )}
      </div>
    </Link>
  )
}

function DistanceBadge({ distance, primaryColor }: { distance: string; primaryColor: string }) {
  return (
    <span className="inline-flex items-center flex-shrink-0 relative text-[11px] leading-none">
      {/* Pin icon — sits on top of the pill */}
      <span className="relative z-10 w-5 h-5 flex-shrink-0">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="white">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
        </svg>
        <span
          className="absolute w-1.5 h-1.5 rounded-full top-[5px] left-1/2 -translate-x-1/2"
          style={{ backgroundColor: primaryColor }}
        />
      </span>
      {/* Pill — starts at icon center, square left corners, rounded right */}
      <span
        className="rounded-r-full pl-2.5 pr-3 py-[3px] -ml-2.5"
        style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}
      >
        {distance}
      </span>
    </span>
  )
}
