'use client'

import Link from 'next/link'
import type { Event } from '@/types/event'
import type { BrandConfig, ContentCategoryOption } from '@/config/brand'
import { useViewportBlur } from '@/hooks/useViewportBlur'
import { useNearestCenterGlow } from './useNearestCenterGlow'
import { type UserLocation, getDistanceToEventByCity, usesImperialUnits } from '@/lib/location'
import { stripEmojis } from '@/lib/text'

interface Props {
  event: Event
  brandConfig: BrandConfig
  userLocation?: UserLocation | null
  showDate?: boolean
}

export function EventTimelineCard({ event, brandConfig, userLocation }: Props) {
  const eventUrl = `/events/${event.event_slug || event.event_id}`
  const imageUrl = event.event_logo || event.screenshot_url
  const { ref: blurRef, inView } = useViewportBlur()

  // On mobile (no hover), the card nearest the viewport's vertical centre lights its glow border,
  // moving from card to card as the page scrolls. Inert on desktop, where hover drives the glow.
  const { ref: linkRef, active: isCenter } = useNearestCenterGlow<HTMLAnchorElement>()

  const location = [event.venue_address, event.event_city]
    .filter(Boolean)
    .filter((s) => s && s.toLowerCase() !== 'na')
    .join(', ')

  // Calculate distance if user location is available
  const distanceKm = getDistanceToEventByCity(userLocation || null, event.event_city)
  const useMiles = usesImperialUnits(userLocation?.country || '')
  const distanceLabel = distanceKm !== null
    ? useMiles
      ? `${Math.round(distanceKm * 0.621371).toLocaleString()} miles from you`
      : `${Math.round(distanceKm).toLocaleString()} km from you`
    : null

  // Resolve category label from brand config; fall back to a humanized raw value so every event
  // that carries a content_category shows a badge (e.g. "foundation" → "Foundation").
  const categoryLabel = event.content_category
    ? brandConfig.contentCategories.find((c: ContentCategoryOption) => c.value === event.content_category)?.label
        ?? event.content_category.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
    : null

  return (
    <Link ref={linkRef} href={eventUrl} className="block group">
      <div
        ref={blurRef}
        className={`relative rounded-xl overflow-hidden hover:brightness-110 transition-all duration-200 flex flex-col sm:flex-row sm:h-44 gw-card-glow${isCenter ? ' gw-glow-active' : ''}`}
        style={{
          backgroundColor: `rgba(var(--panel-tint, 0,0,0), var(--glass-opacity, 0.05))`,
          backdropFilter: inView ? `blur(var(--glass-blur, 4px))` : undefined,
          WebkitBackdropFilter: inView ? `blur(var(--glass-blur, 4px))` : undefined,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: `rgba(var(--panel-tint, 0,0,0), var(--glass-border-opacity, 0.1))`,
        }}
      >
        {/* Event Details (below the banner on mobile, left column on desktop) */}
        <div className="order-2 sm:order-1 flex-1 min-w-0 pl-4 pr-3 py-4 flex flex-col justify-between">
          {/* Top-left: category, then title directly underneath. The category row reserves its
              height even when empty so the title sits at the same position on every card. */}
          <div>
            <div className="h-5 mb-3">
              {categoryLabel && (
                <span
                  className="inline-flex self-start px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-sm"
                  style={{
                    backgroundColor: `${brandConfig.primaryColor}20`,
                    color: brandConfig.primaryColor,
                  }}
                >
                  {categoryLabel}
                </span>
              )}
            </div>
            <h3
              className="text-white font-semibold text-base sm:text-lg
                         group-hover:text-white/90 transition-colors line-clamp-2"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {stripEmojis(event.event_title)}
            </h3>
          </div>

          {/* Bottom-left: location, with the distance pin directly beneath it. */}
          {(location || distanceLabel) && (
            <div className="flex flex-col items-start gap-1 text-left mt-2">
              {location && (
                <div className="text-white/80 text-xs truncate max-w-full">{location}</div>
              )}
              {distanceLabel && <DistanceBadge distance={distanceLabel} />}
            </div>
          )}
        </div>

        {/* Event Screenshot.
            Mobile: full-width banner on top at the image's full native aspect ratio (no cropping —
            square posters just make the card taller), with the details below at full width.
            Desktop: right column at native aspect ratio, fixed to the card height and width-capped so
            it can't crowd out the details (object-cover trims only when a very wide image hits the cap). */}
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="order-1 sm:order-2 w-full h-auto sm:w-auto sm:h-full sm:max-w-[55%] object-cover flex-shrink-0"
          />
        )}
      </div>
    </Link>
  )
}

function DistanceBadge({ distance }: { distance: string }) {
  // Fixed black-on-card chip with a solid white map-pin and white label so it reads
  // consistently regardless of the brand's primary colour. The pin's hole is a real
  // even-odd cutout (transparent), so whatever sits behind shows through — giving a clean
  // map-pin look against both the dark pill and the card.
  return (
    <span className="inline-flex items-center flex-shrink-0 relative text-[11px] leading-none">
      {/* Pin icon — sits on top of the pill */}
      <span className="relative z-10 w-5 h-5 flex-shrink-0">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#ffffff" aria-hidden>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.683 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z"
          />
        </svg>
      </span>
      {/* Pill — starts at icon center, square left corners, rounded right */}
      <span
        className="rounded-r-full pl-2.5 pr-3 py-[3px] -ml-2.5"
        style={{ backgroundColor: '#000000', color: '#ffffff', border: '1px solid rgba(255,255,255,0.28)', borderLeft: 'none' }}
      >
        {distance}
      </span>
    </span>
  )
}
