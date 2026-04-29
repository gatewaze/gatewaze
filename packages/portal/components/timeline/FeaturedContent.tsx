'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
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
        className="relative overflow-hidden transition-all duration-300 hover:brightness-110"
        style={{
          // Match the dark glass-panel look used by the regular timeline
          // cards (see EventTimelineCard.tsx) so the featured card sits
          // on the same surface tone as the rest of the list. The brand
          // colour is already signalled by the category badge + the
          // hover glow below, so no brand tint on the panel itself.
          borderRadius: 'var(--radius-control, 12px)',
          backgroundColor: `rgba(var(--panel-tint, 0,0,0), var(--glass-opacity, 0.05))`,
          backdropFilter: `blur(var(--glass-blur, 4px))`,
          WebkitBackdropFilter: `blur(var(--glass-blur, 4px))`,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: `rgba(var(--panel-tint, 0,0,0), var(--glass-border-opacity, 0.1))`,
        }}
      >
        <div className="flex flex-col sm:flex-row">
          {/* Content — top group at top, bottom group (location +
              distance) pinned to the bottom on desktop. On mobile the
              column stacks naturally; the bottom group still flows
              after the top group, just without the justify-between
              stretch. */}
          <div className="flex-1 min-w-0 p-5 sm:p-6 flex flex-col items-start sm:justify-between gap-3">
            <div className="flex flex-col items-start">
              {/* Category badge */}
              <span
                className="inline-flex px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-sm mb-3"
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

              {/* Date + time */}
              <div className="text-white/80 text-sm sm:text-base" suppressHydrationWarning>
                {[dateStr, timeStr].filter(Boolean).join(' · ')}
              </div>
            </div>

            {/* Bottom-aligned: location + distance */}
            {(location || formattedDistance) && (
              <div className="flex flex-col items-start gap-1.5">
                {location && (
                  <div className="text-white/60 text-sm">{location}</div>
                )}
                {formattedDistance && (
                  <div className="-ml-1">
                    <DistanceBadge distance={formattedDistance} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Image */}
          {imageUrl && (
            <div className="relative flex-shrink-0 w-full sm:w-48 lg:w-64 h-32 sm:h-auto sm:min-h-32 overflow-hidden">
              <Image
                src={imageUrl}
                alt=""
                fill
                sizes="(min-width: 1024px) 256px, (min-width: 640px) 192px, 100vw"
                className="object-cover"
              />
            </div>
          )}
        </div>

        {/* Subtle brand-coloured edge glow on hover — keeps the
            "featured" affordance without tinting the panel itself. */}
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

/**
 * Black-pill distance chip with white pin + label. Mirrors the
 * `DistanceBadge` defined locally in EventTimelineCard so the featured
 * card uses the same visual language as the rest of the timeline.
 * Kept inline rather than imported to avoid coupling the two cards.
 */
function DistanceBadge({ distance }: { distance: string }) {
  return (
    <span className="inline-flex items-center flex-shrink-0 relative text-[11px] leading-none">
      <span className="relative z-10 w-5 h-5 flex-shrink-0">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#ffffff">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
        </svg>
        <span
          className="absolute w-1.5 h-1.5 rounded-full top-[5px] left-1/2 -translate-x-1/2"
          style={{ backgroundColor: '#000000' }}
        />
      </span>
      <span
        className="rounded-r-full pl-2.5 pr-3 py-[3px] -ml-2.5"
        style={{ backgroundColor: '#000000', color: '#ffffff' }}
      >
        {distance}
      </span>
    </span>
  )
}
