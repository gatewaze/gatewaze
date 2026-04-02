'use client'

import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface Props {
  lat: number
  lng: number
  primaryColor: string
}

function createMarkerIcon(color: string) {
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

export function VenueLeafletMap({ lat, lng, primaryColor }: Props) {
  const markerIcon = createMarkerIcon(primaryColor)

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
          style={{ height: '300px', width: '100%' }}
          scrollWheelZoom={false}
          className="rounded-2xl"
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <Marker position={[lat, lng]} icon={markerIcon} />
        </MapContainer>
      </div>
    </>
  )
}
