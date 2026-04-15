'use client'

import { useEffect, useState } from 'react'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'

interface Props {
  events: Event[]
  brandConfig: BrandConfig
}

// Common city coordinates for tech events
const CITY_COORDINATES: Record<string, [number, number]> = {
  'san francisco': [37.7749, -122.4194],
  'sf': [37.7749, -122.4194],
  'mountain view': [37.3861, -122.0839],
  'palo alto': [37.4419, -122.143],
  'san jose': [37.3382, -121.8863],
  'new york': [40.7128, -74.006],
  'nyc': [40.7128, -74.006],
  'los angeles': [34.0522, -118.2437],
  'la': [34.0522, -118.2437],
  'seattle': [47.6062, -122.3321],
  'austin': [30.2672, -97.7431],
  'boston': [42.3601, -71.0589],
  'chicago': [41.8781, -87.6298],
  'denver': [39.7392, -104.9903],
  'london': [51.5074, -0.1278],
  'berlin': [52.52, 13.405],
  'paris': [48.8566, 2.3522],
  'amsterdam': [52.3676, 4.9041],
  'tokyo': [35.6762, 139.6503],
  'singapore': [1.3521, 103.8198],
  'sydney': [33.8688, 151.2093],
  'toronto': [43.6532, -79.3832],
  'vancouver': [49.2827, -123.1207],
  'bangalore': [12.9716, 77.5946],
  'mumbai': [19.076, 72.8777],
  'tel aviv': [32.0853, 34.7818],
  'dubai': [25.2048, 55.2708],
  'stockholm': [59.3293, 18.0686],
  'helsinki': [60.1699, 24.9384],
  'dublin': [53.3498, -6.2603],
  'lisbon': [38.7223, -9.1393],
  'barcelona': [41.3851, 2.1734],
  'madrid': [40.4168, -3.7038],
  'munich': [48.1351, 11.582],
  'zurich': [47.3769, 8.5417],
  'vienna': [48.2082, 16.3738],
  'prague': [50.0755, 14.4378],
  'warsaw': [52.2297, 21.0122],
  'copenhagen': [55.6761, 12.5683],
  'oslo': [59.9139, 10.7522],
  'brussels': [50.8503, 4.3517],
  'milan': [45.4642, 9.19],
  'rome': [41.9028, 12.4964],
  'atlanta': [33.749, -84.388],
  'miami': [25.7617, -80.1918],
  'washington': [38.9072, -77.0369],
  'dc': [38.9072, -77.0369],
  'philadelphia': [39.9526, -75.1652],
  'portland': [45.5152, -122.6784],
  'phoenix': [33.4484, -112.074],
  'san diego': [32.7157, -117.1611],
  'salt lake city': [40.7608, -111.891],
  'minneapolis': [44.9778, -93.265],
  'detroit': [42.3314, -83.0458],
  'nashville': [36.1627, -86.7816],
  'charlotte': [35.2271, -80.8431],
  'raleigh': [35.7796, -78.6382],
  'pittsburgh': [40.4406, -79.9959],
}

function getCityCoordinates(event: Event): [number, number] | null {
  const cityLower = (event.event_city || '').toLowerCase().trim()

  // Direct match
  if (CITY_COORDINATES[cityLower]) {
    return CITY_COORDINATES[cityLower]
  }

  // Partial match
  for (const [city, coords] of Object.entries(CITY_COORDINATES)) {
    if (cityLower.includes(city) || city.includes(cityLower)) {
      return coords
    }
  }

  return null
}

interface EventWithCoords extends Event {
  coordinates: [number, number]
}

export function EventMap({ events, brandConfig }: Props) {
  const [MapComponent, setMapComponent] = useState<React.ComponentType<{
    events: EventWithCoords[]
    brandConfig: BrandConfig
  }> | null>(null)

  // Dynamically import Leaflet components (they don't work with SSR)
  useEffect(() => {
    import('./LeafletMap').then((mod) => {
      setMapComponent(() => mod.LeafletMap)
    })
  }, [])

  // Filter events that have valid coordinates
  const eventsWithCoords: EventWithCoords[] = events
    .map((event) => {
      const coords = getCityCoordinates(event)
      if (coords) {
        return { ...event, coordinates: coords }
      }
      return null
    })
    .filter((e): e is EventWithCoords => e !== null)

  if (!MapComponent) {
    return (
      <div className="w-full max-w-7xl mx-auto">
        <div className="rounded-2xl h-[500px] flex items-center justify-center" style={{ backgroundColor: `rgba(var(--panel-tint,0,0,0),var(--glass-opacity,0.05))`, backdropFilter: `blur(var(--glass-blur,4px))`, border: `1px solid rgba(var(--panel-tint,0,0,0),var(--glass-border-opacity,0.1))` }}>
          <div className="text-white/60">Loading map...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: `rgba(var(--panel-tint,0,0,0),var(--glass-opacity,0.05))`, backdropFilter: `blur(var(--glass-blur,4px))`, border: `1px solid rgba(var(--panel-tint,0,0,0),var(--glass-border-opacity,0.1))` }}>
        <MapComponent events={eventsWithCoords} brandConfig={brandConfig} />
      </div>
    </div>
  )
}
