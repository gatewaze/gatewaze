'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { Event } from '@/types/event'
import type { BrandConfig, ContentCategoryOption } from '@/config/brand'
import { isLightColor } from '@/config/brand'
import { formatEventTime, formatEventDate } from './utils'
import { type UserLocation, getDistanceToEventByCity, formatUserDistance, usesImperialUnits } from '@/lib/location'
import { stripEmojis } from '@/lib/text'

interface Props {
  events: Event[]
  brandConfig: BrandConfig
  userLocation?: UserLocation | null
}

/**
 * Featured content section shown above the timeline.
 *
 * When content categories are configured, this picks the upcoming event(s)
 * from the highest-priority category. If multiple events share the same
 * category, the one geographically closest to the viewer (via IP) is shown.
 *
 * If no categories are configured, nothing is rendered.
 */
export function FeaturedContent({ events, brandConfig, userLocation }: Props) {
  const categories = brandConfig.contentCategories
  if (!categories || categories.length === 0) return null

  // Find the highest-priority category that has at least one upcoming event
  const featured = useMemo(() => {
    for (const category of categories) {
      const matching = events.filter((e) => e.content_category === category.value)
      if (matching.length === 0) continue

      // If we have user location, pick the closest event; otherwise pick the soonest
      let best: Event
      if (userLocation && matching.length > 1) {
        const withDistance = matching.map((event) => ({
          event,
          distance: getDistanceToEventByCity(userLocation, event.event_city),
        }))
        // Sort by distance (null distances go last)
        withDistance.sort((a, b) => {
          if (a.distance === null && b.distance === null) return 0
          if (a.distance === null) return 1
          if (b.distance === null) return -1
          return a.distance - b.distance
        })
        best = withDistance[0].event
      } else {
        // Pick soonest
        best = matching.sort(
          (a, b) => new Date(a.event_start).getTime() - new Date(b.event_start).getTime()
        )[0]
      }

      return { event: best, category }
    }
    return null
  }, [events, categories, userLocation])

  if (!featured) return null

  const { event, category } = featured

  return (
    <FeaturedCard
      event={event}
      category={category}
      brandConfig={brandConfig}
      userLocation={userLocation}
    />
  )
}

function FeaturedCard({
  event,
  category,
  brandConfig,
  userLocation,
}: {
  event: Event
  category: ContentCategoryOption
  brandConfig: BrandConfig
  userLocation?: UserLocation | null
}) {
  const eventUrl = `/events/${event.event_slug || event.event_id}`
  const imageUrl = event.event_logo || event.screenshot_url
  const primaryColor = brandConfig.primaryColor
  const light = isLightColor(primaryColor)

  const location = [event.venue_address, event.event_city]
    .filter(Boolean)
    .filter((s) => s && s.toLowerCase() !== 'na')
    .join(', ')

  const distanceKm = getDistanceToEventByCity(userLocation || null, event.event_city)
  const useMiles = usesImperialUnits(userLocation?.country || '')
  const formattedDistance = distanceKm !== null ? formatUserDistance(distanceKm, useMiles) : null

  const dateStr = formatEventDate(event.event_start)
  const timeStr = formatEventTime(event.event_start)

  return (
    <Link href={eventUrl} className="block group mb-8">
      <div
        className="relative overflow-hidden border transition-all duration-300 hover:scale-[1.01]"
        style={{
          borderRadius: 'var(--radius-control, 12px)',
          borderColor: `${primaryColor}40`,
          background: `linear-gradient(135deg, ${primaryColor}15 0%, transparent 60%)`,
        }}
      >
        <div className="flex flex-col sm:flex-row">
          {/* Content */}
          <div className="flex-1 min-w-0 p-5 sm:p-6 flex flex-col justify-center">
            {/* Category badge */}
            <span
              className="inline-flex self-start px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-sm mb-3"
              style={{
                backgroundColor: primaryColor,
                color: light ? '#000000' : '#ffffff',
              }}
            >
              {category.label}
            </span>

            {/* Title */}
            <h2
              className="text-white font-bold text-lg sm:text-xl lg:text-2xl
                         group-hover:text-white/90 transition-colors line-clamp-2 mb-2"
              style={{ fontWeight: 'var(--font-weight-heading, 700)' }}
            >
              {stripEmojis(event.event_title)}
            </h2>

            {/* Date, time, location */}
            <div className="space-y-1">
              <div className="text-white/80 text-sm sm:text-base" suppressHydrationWarning>
                {[dateStr, timeStr].filter(Boolean).join(' · ')}
              </div>
              {location && (
                <div className="text-white/60 text-sm">{location}</div>
              )}
              {formattedDistance && (
                <div className="text-white/50 text-xs mt-1">
                  {formattedDistance} away
                </div>
              )}
            </div>
          </div>

          {/* Image */}
          {imageUrl && (
            <div className="flex-shrink-0 w-full sm:w-48 lg:w-64 h-32 sm:h-auto">
              <img src={imageUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
        </div>

        {/* Subtle border glow on hover */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          style={{
            boxShadow: `inset 0 0 0 1px ${primaryColor}60`,
            borderRadius: 'inherit',
          }}
        />
      </div>
    </Link>
  )
}
