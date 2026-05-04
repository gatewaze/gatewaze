'use client'

import { useMemo } from 'react'
import type { NearbyHotel } from '@/types/event'

interface Props {
  hotels: NearbyHotel[]
  /** Venue coordinates. When null, distance/drive-time columns are hidden and
   *  hotels are sorted alphabetically by name. */
  venueLat: number | null
  venueLng: number | null
  useDarkText: boolean
  theme: {
    textColor: string
    textMutedColor: string
    headingColor: string
    linkColor: string
    panelBg: string
    panelBorder: string
  }
  onHover?: (hotelId: string | null) => void
}

// ---------------------------------------------------------------------------
// Distance + duration formatting (mirror of modules/events/lib/geocoding —
// duplicated rather than shared so the portal stays free of cross-repo
// imports for a fairly small chunk of code).
// ---------------------------------------------------------------------------

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.344
  if (miles < 0.1) return `${Math.round(meters * 1.0936)} yd`
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 1) return '< 1 min'
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  if (rem === 0) return `${hrs} hr`
  return `${hrs} hr ${rem} min`
}

interface Sortable extends NearbyHotel {
  _distM: number | null
}

function sortByProximity(
  hotels: NearbyHotel[],
  venueLat: number | null,
  venueLng: number | null,
): Sortable[] {
  // No venue coords → can't compute distance, fall back to alphabetical.
  if (venueLat == null || venueLng == null) {
    return hotels
      .map((h) => ({ ...h, _distM: null }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  const enriched: Sortable[] = hotels.map((h) => {
    let d: number | null = null
    if (h.driveDistanceMeters != null) d = h.driveDistanceMeters
    else if (h.lat != null && h.lng != null) {
      d = haversineMeters({ lat: h.lat, lng: h.lng }, { lat: venueLat, lng: venueLng })
    }
    return { ...h, _distM: d }
  })
  return enriched.sort((a, b) => {
    if (a._distM == null && b._distM == null) return a.name.localeCompare(b.name)
    if (a._distM == null) return 1
    if (b._distM == null) return -1
    return a._distM - b._distM
  })
}

export function NearbyHotelsList({ hotels, venueLat, venueLng, useDarkText, theme, onHover }: Props) {
  const sorted = useMemo(() => sortByProximity(hotels, venueLat, venueLng), [hotels, venueLat, venueLng])

  const headingColor = useDarkText ? 'text-gray-900' : 'text-white'
  const cardBg = useDarkText ? 'bg-gray-900/10' : 'bg-white/10'
  const cardBorder = useDarkText ? 'border border-gray-700/30' : 'border border-white/15'
  const hoverBg = useDarkText ? 'hover:bg-gray-900/15' : 'hover:bg-white/15'

  return (
    <div>
      <h2 className={`text-xl sm:text-2xl font-bold mb-5 ${headingColor}`}>
        Nearby accommodation
      </h2>
      <ul className="space-y-3">
        {sorted.map((hotel) => {
          const inner = (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className={`font-semibold ${headingColor}`}>{hotel.name}</p>
                <p className="text-sm mt-1" style={{ color: theme.textMutedColor }}>
                  {hotel.postcode}
                  {hotel.priceRange ? ` · ${hotel.priceRange}` : ''}
                </p>
              </div>
              <div className="text-right text-sm shrink-0" style={{ color: theme.textMutedColor }}>
                {hotel._distM != null && <p>{formatDistance(hotel._distM)} away</p>}
                {hotel.driveSeconds != null && <p className="opacity-80">~{formatDuration(hotel.driveSeconds)} by taxi</p>}
              </div>
            </div>
          )
          const cardClass = `block rounded-xl p-4 transition-colors ${cardBg} ${cardBorder} ${hoverBg}`
          return (
            <li
              key={hotel.id}
              onMouseEnter={() => onHover?.(hotel.id)}
              onMouseLeave={() => onHover?.(null)}
            >
              {hotel.url ? (
                <a
                  href={hotel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cardClass}
                >
                  {inner}
                </a>
              ) : (
                <div className={cardClass}>{inner}</div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
