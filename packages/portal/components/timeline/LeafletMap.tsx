'use client'

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import Link from 'next/link'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import 'leaflet/dist/leaflet.css'
import { stripEmojis } from '@/lib/text'

interface EventWithCoords extends Event {
  coordinates: [number, number]
}

interface Props {
  events: EventWithCoords[]
  brandConfig: BrandConfig
}

// Create custom marker icon
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
    popupAnchor: [0, -40],
  })
}

// Convert hex to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 }
}

export function LeafletMap({ events, brandConfig }: Props) {
  // Calculate bounds to fit all markers
  const bounds =
    events.length > 0
      ? L.latLngBounds(events.map((e) => e.coordinates))
      : L.latLngBounds([
          [20, -130],
          [60, 30],
        ])

  const markerIcon = createMarkerIcon(brandConfig.primaryColor)
  const primaryRgb = hexToRgb(brandConfig.primaryColor)
  const secondaryRgb = hexToRgb(brandConfig.secondaryColor)

  // Format time for display
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <>
      <style>{`
        .custom-marker {
          background: transparent;
          border: none;
        }
        .leaflet-popup-content-wrapper {
          background: rgba(30, 40, 55, 0.95);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          color: white;
          padding: 0;
        }
        .leaflet-popup-content {
          margin: 0;
          min-width: 200px;
        }
        .leaflet-popup-tip {
          background: rgba(30, 40, 55, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .leaflet-container {
          background: ${brandConfig.secondaryColor};
        }
        .branded-map-container {
          position: relative;
        }
        .branded-map-container::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(
            135deg,
            rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.15) 0%,
            rgba(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}, 0.2) 100%
          );
          mix-blend-mode: color;
          z-index: 400;
          border-radius: 1rem;
        }
        .branded-map-container .leaflet-tile-pane {
          filter: saturate(0.3) brightness(0.8);
        }
      `}</style>
      <div className="branded-map-container">
        <MapContainer
          bounds={bounds}
          boundsOptions={{ padding: [50, 50] }}
          style={{ height: '500px', width: '100%' }}
          scrollWheelZoom={true}
          className="rounded-2xl"
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {events.map((event) => (
            <Marker key={event.event_id} position={event.coordinates} icon={markerIcon}>
              <Popup>
                <div className="p-3">
                  <div className="text-white/60 text-xs mb-1" suppressHydrationWarning>
                    {formatTime(event.event_start)}
                  </div>
                  <Link
                    href={`/events/${event.event_slug || event.event_id}`}
                    className="text-white font-semibold text-sm hover:opacity-80 transition-opacity block mb-2"
                  >
                    {stripEmojis(event.event_title)}
                  </Link>
                  {(event.venue_address || event.event_city) && (
                    <div className="flex items-start gap-1.5 text-white/70 text-xs">
                      <svg className="w-3 h-3 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      <span>{event.venue_address || event.event_city}</span>
                    </div>
                  )}
                  {event.event_logo || event.screenshot_url ? (
                    <img
                      src={event.event_logo || event.screenshot_url || ''}
                      alt=""
                      className="w-full h-20 object-cover rounded-lg mt-2"
                    />
                  ) : null}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </>
  )
}
