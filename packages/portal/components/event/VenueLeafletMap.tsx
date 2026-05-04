'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface HotelMarker {
  id: string
  name: string
  lat: number
  lng: number
}

interface Props {
  lat: number
  lng: number
  primaryColor: string
  /** Optional secondary markers (e.g. nearby hotels). Each rendered with the
   *  hotel icon + a hover tooltip showing the name. */
  hotels?: HotelMarker[]
  /** ID of the hotel currently highlighted from the list below the map.
   *  When set, that marker uses the venue (primary) colour and pops in z-index. */
  highlightHotelId?: string | null
}

function createMarkerIcon(color: string, kind: 'venue' | 'hotel' = 'venue') {
  // Hotel icon is a smaller, lighter pin so the venue stays the visual anchor.
  if (kind === 'hotel') {
    const svg = `
      <svg width="24" height="30" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0C7.164 0 0 7.164 0 16c0 12 16 24 16 24s16-12 16-24c0-8.836-7.164-16-16-16z" fill="${color}" fill-opacity="0.85"/>
        <circle cx="16" cy="16" r="6" fill="white"/>
      </svg>
    `
    return L.divIcon({
      html: svg,
      className: 'custom-marker',
      iconSize: [24, 30],
      iconAnchor: [12, 30],
    })
  }

  const svg = `
    <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0C7.164 0 0 7.164 0 16c0 12 16 24 16 24s16-12 16-24c0-8.836-7.164-16-16-16z" fill="${color}"/>
      <circle cx="16" cy="16" r="8" fill="white" fill-opacity="0.9"/>
      <circle cx="16" cy="16" r="4" fill="${color}"/>
    </svg>
  `

  return L.divIcon({
    html: svg,
    className: 'custom-marker',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
  })
}

/**
 * Auto-fit the map bounds to include the venue + every hotel marker. Runs on
 * mount and whenever the bounds key changes (hotels added/removed/updated).
 *
 * Why this lives in a child component: react-leaflet's `MapContainer` only
 * exposes the map instance via `useMap` from inside its children, so any
 * imperative call (`fitBounds`, `setView`, etc.) has to go through a child.
 */
function FitBoundsToMarkers({ points, padding = 40 }: { points: Array<[number, number]>; padding?: number }) {
  const map = useMap()
  const key = points.map(([a, b]) => `${a},${b}`).join('|')

  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], 15, { animate: false })
      return
    }
    const bounds = L.latLngBounds(points.map(([la, lo]) => L.latLng(la, lo)))
    map.fitBounds(bounds, { padding: [padding, padding], maxZoom: 15, animate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, padding])

  return null
}

export function VenueLeafletMap({ lat, lng, primaryColor, hotels = [], highlightHotelId = null }: Props) {
  const venueIcon = createMarkerIcon(primaryColor, 'venue')
  const hotelIcon = createMarkerIcon('#374151', 'hotel')
  const highlightIcon = createMarkerIcon(primaryColor, 'hotel')

  const points: Array<[number, number]> = [
    [lat, lng],
    ...hotels.filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng)).map((h) => [h.lat, h.lng] as [number, number]),
  ]

  return (
    <>
      <style>{`
        .custom-marker { background: transparent; border: none; }
        .venue-map-container .leaflet-container { background: #ffffff; }
      `}</style>
      <div className="venue-map-container">
        <MapContainer
          center={[lat, lng]}
          zoom={15}
          style={{ height: '320px', width: '100%' }}
          scrollWheelZoom={false}
          className="rounded-2xl"
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <Marker position={[lat, lng]} icon={venueIcon}>
            <Tooltip direction="top" offset={[0, -32]} opacity={0.95}>Venue</Tooltip>
          </Marker>
          {hotels.map((hotel) => {
            if (!Number.isFinite(hotel.lat) || !Number.isFinite(hotel.lng)) return null
            const isHighlighted = highlightHotelId === hotel.id
            return (
              <Marker
                key={hotel.id}
                position={[hotel.lat, hotel.lng]}
                icon={isHighlighted ? highlightIcon : hotelIcon}
                zIndexOffset={isHighlighted ? 1000 : 0}
              >
                <Tooltip direction="top" offset={[0, -28]} opacity={0.95}>{hotel.name}</Tooltip>
              </Marker>
            )
          })}
          <FitBoundsToMarkers points={points} />
        </MapContainer>
      </div>
    </>
  )
}
