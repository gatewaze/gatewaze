/**
 * Location utilities for distance calculations and formatting
 * Ported from gatewaze-frontend/src/utils/locationUtils.ts
 */

export interface UserLocation {
  lat: number
  lng: number
  city?: string
  region?: string
  country?: string
}

/**
 * Calculate distance between two lat/long points using Haversine formula
 * @returns Distance in kilometers
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Radius of the Earth in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = R * c // Distance in kilometers

  return distance
}

/**
 * Format distance in a user-friendly way (metric)
 */
export function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`
  } else if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)} km`
  } else {
    return `${Math.round(distanceKm)} km`
  }
}

/**
 * Format distance with support for both metric and imperial units
 */
export function formatUserDistance(distanceKm: number, useMiles: boolean = false): string {
  if (useMiles) {
    // Convert kilometers to miles (1 km = 0.621371 miles)
    const distanceMiles = distanceKm * 0.621371

    if (distanceMiles < 0.1) {
      // For very short distances, show yards (1 mile = 1760 yards)
      const yards = Math.round(distanceMiles * 1760)
      return `${yards} yd`
    } else if (distanceMiles < 10) {
      return `${distanceMiles.toFixed(1)} mi`
    } else {
      return `${Math.round(distanceMiles)} mi`
    }
  } else {
    return formatDistance(distanceKm)
  }
}

/**
 * Extract latitude and longitude from a "lat,lng" string
 * Returns null for invalid or "0,0" (online events)
 */
export function extractLatLong(location: string): [number, number] | null {
  if (!location) return null

  // Handle '0,0' for online events
  if (location === '0,0') return null

  const parts = location.split(',')
  if (parts.length !== 2) return null

  const lat = parseFloat(parts[0])
  const lng = parseFloat(parts[1])

  if (isNaN(lat) || isNaN(lng)) return null

  return [lat, lng]
}

/**
 * Check if a country uses imperial units
 */
export function usesImperialUnits(countryCode: string): boolean {
  // US, UK, Liberia, and Myanmar use miles
  return ['US', 'GB', 'LR', 'MM'].includes(countryCode?.toUpperCase())
}

/**
 * Calculate distance between user location and an event location string
 * Returns null if either location is invalid
 */
export function getDistanceToEvent(
  userLocation: UserLocation | null,
  eventLatLong: string | null
): number | null {
  if (!userLocation || !eventLatLong) return null

  const eventCoords = extractLatLong(eventLatLong)
  if (!eventCoords) return null

  return calculateDistance(userLocation.lat, userLocation.lng, eventCoords[0], eventCoords[1])
}

/**
 * Common city coordinates for tech events
 */
export const CITY_COORDINATES: Record<string, [number, number]> = {
  'san francisco': [37.7749, -122.4194],
  sf: [37.7749, -122.4194],
  'mountain view': [37.3861, -122.0839],
  'palo alto': [37.4419, -122.143],
  'san jose': [37.3382, -121.8863],
  'new york': [40.7128, -74.006],
  nyc: [40.7128, -74.006],
  'los angeles': [34.0522, -118.2437],
  la: [34.0522, -118.2437],
  seattle: [47.6062, -122.3321],
  austin: [30.2672, -97.7431],
  boston: [42.3601, -71.0589],
  chicago: [41.8781, -87.6298],
  denver: [39.7392, -104.9903],
  london: [51.5074, -0.1278],
  berlin: [52.52, 13.405],
  paris: [48.8566, 2.3522],
  amsterdam: [52.3676, 4.9041],
  tokyo: [35.6762, 139.6503],
  singapore: [1.3521, 103.8198],
  sydney: [-33.8688, 151.2093],
  melbourne: [-37.8136, 144.9631],
  toronto: [43.6532, -79.3832],
  vancouver: [49.2827, -123.1207],
  bangalore: [12.9716, 77.5946],
  bengaluru: [12.9716, 77.5946],
  mumbai: [19.076, 72.8777],
  'tel aviv': [32.0853, 34.7818],
  dubai: [25.2048, 55.2708],
  stockholm: [59.3293, 18.0686],
  helsinki: [60.1699, 24.9384],
  dublin: [53.3498, -6.2603],
  lisbon: [38.7223, -9.1393],
  barcelona: [41.3851, 2.1734],
  madrid: [40.4168, -3.7038],
  munich: [48.1351, 11.582],
  zurich: [47.3769, 8.5417],
  vienna: [48.2082, 16.3738],
  prague: [50.0755, 14.4378],
  warsaw: [52.2297, 21.0122],
  copenhagen: [55.6761, 12.5683],
  oslo: [59.9139, 10.7522],
  brussels: [50.8503, 4.3517],
  milan: [45.4642, 9.19],
  rome: [41.9028, 12.4964],
  atlanta: [33.749, -84.388],
  miami: [25.7617, -80.1918],
  washington: [38.9072, -77.0369],
  dc: [38.9072, -77.0369],
  philadelphia: [39.9526, -75.1652],
  portland: [45.5152, -122.6784],
  phoenix: [33.4484, -112.074],
  'san diego': [32.7157, -117.1611],
  'salt lake city': [40.7608, -111.891],
  minneapolis: [44.9778, -93.265],
  detroit: [42.3314, -83.0458],
  nashville: [36.1627, -86.7816],
  charlotte: [35.2271, -80.8431],
  raleigh: [35.7796, -78.6382],
  pittsburgh: [40.4406, -79.9959],
  'hong kong': [22.3193, 114.1694],
  seoul: [37.5665, 126.978],
  taipei: [25.033, 121.5654],
  jakarta: [6.2088, 106.8456],
  'kuala lumpur': [3.139, 101.6869],
  bangkok: [13.7563, 100.5018],
  'ho chi minh': [10.8231, 106.6297],
  cairo: [30.0444, 31.2357],
  lagos: [6.5244, 3.3792],
  johannesburg: [-26.2041, 28.0473],
  'cape town': [-33.9249, 18.4241],
  'sao paulo': [-23.5505, -46.6333],
  'buenos aires': [-34.6037, -58.3816],
  'mexico city': [19.4326, -99.1332],
  lima: [-12.0464, -77.0428],
  bogota: [4.711, -74.0721],
  santiago: [-33.4489, -70.6693],
}

/**
 * Get coordinates for an event based on its city name
 * Uses fuzzy matching for partial city name matches
 */
export function getCityCoordinates(cityName: string | null): [number, number] | null {
  if (!cityName) return null

  const cityLower = cityName.toLowerCase().trim()

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

/**
 * Calculate distance from user to an event using city-based coordinates
 */
export function getDistanceToEventByCity(
  userLocation: UserLocation | null,
  eventCity: string | null
): number | null {
  if (!userLocation || !eventCity) return null

  const eventCoords = getCityCoordinates(eventCity)
  if (!eventCoords) return null

  return calculateDistance(userLocation.lat, userLocation.lng, eventCoords[0], eventCoords[1])
}
