'use client'

import { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useEventContext } from './EventContext'
import { GlowBorder } from '@/components/ui/GlowBorder'

const VenueLeafletMap = dynamic(
  () => import('./VenueLeafletMap').then((mod) => mod.VenueLeafletMap),
  { ssr: false }
)

export function VenueContent() {
  const { event, useDarkText, primaryColor, theme } = useEventContext()
  const [sanitizedVenueHtml, setSanitizedVenueHtml] = useState<string | null>(null)

  // Parse lat/lng from event_location ("lat,lon" format)
  const coords = useMemo(() => {
    if (!event.event_location) return null
    const parts = event.event_location.split(',').map(Number)
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return { lat: parts[0], lng: parts[1] }
    }
    return null
  }, [event.event_location])

  // Sanitize venue_content HTML
  useEffect(() => {
    if (event.venue_content && typeof window !== 'undefined') {
      import('dompurify').then((DOMPurify) => {
        const clean = DOMPurify.default.sanitize(event.venue_content!, {
          ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a', 'img', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'code', 'pre', 'hr', 'u', 's', 'sub', 'sup', 'div', 'span'],
          ALLOWED_ATTR: ['href', 'src', 'alt', 'width', 'height', 'target', 'rel', 'class', 'style'],
        })
        setSanitizedVenueHtml(clean)
      })
    }
  }, [event.venue_content])

  const textColor = useDarkText ? 'text-gray-900' : 'text-white'
  const textMuted = useDarkText ? 'text-gray-600' : 'text-white/70'
  const panelBg = useDarkText ? 'bg-gray-900/15' : 'bg-white/15'
  const panelBorder = useDarkText ? 'border border-gray-700/50' : 'border border-white/20'

  return (
    <div className="space-y-10">
      <h1 className={`text-2xl sm:text-3xl font-bold ${textColor} drop-shadow-md`}>Venue</h1>

      {/* Interactive Map */}
      {coords && (
        <GlowBorder useDarkTheme={useDarkText}>
          <div className={`${panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelBorder}`}>
            <VenueLeafletMap lat={coords.lat} lng={coords.lng} primaryColor={primaryColor} />
          </div>
        </GlowBorder>
      )}

      {/* Address */}
      {event.venue_address && (
        <div className="flex items-start gap-4">
          <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${useDarkText ? 'bg-gray-900/10' : 'bg-white/20'}`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: theme.textMutedColor }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
          </div>
          <div>
            <p className={`font-semibold ${textColor}`}>Address</p>
            <p className={`text-sm mt-1 ${textMuted}`}>{event.venue_address}</p>
            {coords && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm mt-2"
                style={{ color: theme.linkColor }}
              >
                Open in Google Maps
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>
        </div>
      )}

      {/* Venue Details (rich text) */}
      {sanitizedVenueHtml && (
        <div
          className="prose prose-lg max-w-none [&_p]:mb-5 [&_p]:leading-[1.8] [&_p]:text-[1.0625rem] [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-5 [&_h2]:mt-10 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mb-4 [&_h3]:mt-8 [&_a]:underline [&_a]:underline-offset-4 [&_ul]:list-disc [&_ul]:ml-6 [&_ol]:list-decimal [&_ol]:ml-6 [&_img]:rounded-2xl [&_img]:mx-auto [&_img]:shadow-xl"
          style={{ color: theme.textMutedColor }}
          dangerouslySetInnerHTML={{ __html: sanitizedVenueHtml }}
        />
      )}

      {/* Indoor Venue Map Image */}
      {event.venue_map_image && (
        <div>
          <p className={`font-semibold mb-4 ${textColor}`}>Venue Map</p>
          <img
            src={event.venue_map_image}
            alt="Indoor venue map"
            className="w-full rounded-xl"
          />
        </div>
      )}
    </div>
  )
}
