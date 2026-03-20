'use client'

import { useMemo, useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { stripEmojis } from '@/lib/text'
import { RegisterButton } from './RegisterButton'
import { captureTrackingParams, createTrackingSession, getExistingSessionId } from '@/lib/tracking'
import { hasConsentFor } from '@/hooks/useConsent'

interface LandingEvent {
  event_id: string
  event_slug: string | null
  event_title: string
  event_start: string
  event_end: string
  event_timezone: string | null
  event_city: string | null
  event_region: string | null
  event_location: string | null
  venue_address: string | null
  event_logo: string | null
  screenshot_url: string | null
  gradient_color_1: string | null
  gradient_color_2: string | null
}

interface DateParts {
  month: string
  day: string
  weekday: string
  fullDate: string
  ordinalSuffix: string
  isDayFirst: boolean
}

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th'
  switch (day % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

function isDayFirstFormat(dateStr: string, day: number): boolean {
  return dateStr.match(new RegExp(`^${day}\\s`)) !== null
}

function formatDatePartsSSR(dateStr: string): DateParts {
  try {
    const date = new Date(dateStr)
    const dayNum = date.getDate()
    const fullDateRaw = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    const isDayFirst = isDayFirstFormat(fullDateRaw, dayNum)
    return {
      month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      day: date.toLocaleDateString('en-US', { day: 'numeric' }),
      weekday: date.toLocaleDateString('en-US', { weekday: 'long' }),
      fullDate: fullDateRaw,
      ordinalSuffix: isDayFirst ? getOrdinalSuffix(dayNum) : '',
      isDayFirst,
    }
  } catch {
    return { month: '', day: '', weekday: '', fullDate: dateStr, ordinalSuffix: '', isDayFirst: false }
  }
}

function formatDatePartsClient(dateStr: string): DateParts {
  try {
    const date = new Date(dateStr)
    const dayNum = date.getDate()
    const fullDateRaw = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    const isDayFirst = isDayFirstFormat(fullDateRaw, dayNum)
    return {
      month: date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
      day: date.toLocaleDateString(undefined, { day: 'numeric' }),
      weekday: date.toLocaleDateString(undefined, { weekday: 'long' }),
      fullDate: fullDateRaw,
      ordinalSuffix: isDayFirst ? getOrdinalSuffix(dayNum) : '',
      isDayFirst,
    }
  } catch {
    return { month: '', day: '', weekday: '', fullDate: dateStr, ordinalSuffix: '', isDayFirst: false }
  }
}

function formatTimeSSR(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  } catch { return '' }
}

function formatTimeClient(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  } catch { return '' }
}

interface Props {
  event: LandingEvent
  identifier: string
  primaryColor: string
  secondaryColor: string
  useDarkText: boolean
}

function LandingHeroInner({ event, identifier, primaryColor, secondaryColor, useDarkText }: Props) {
  const searchParams = useSearchParams()
  const eUrl = `/e/${identifier}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const theme = useMemo(() => ({
    textStyle: useDarkText ? { color: '#111827' } : { color: '#ffffff' },
    textMutedStyle: useDarkText ? { color: '#4b5563' } : { color: 'rgba(255,255,255,0.8)' },
    fallbackTextColor: useDarkText ? 'text-gray-900/30' : 'text-white/30',
    imageBorder: useDarkText ? 'border border-gray-900/10' : 'border border-white/10',
  }), [useDarkText])

  const [dateParts, setDateParts] = useState<DateParts>(() => formatDatePartsSSR(event.event_start))
  const [startTime, setStartTime] = useState(() => formatTimeSSR(event.event_start))
  const [endTime, setEndTime] = useState(() => event.event_end ? formatTimeSSR(event.event_end) : '')

  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const imageUrl = event.event_logo || event.screenshot_url || ''

  useEffect(() => {
    setImageAspectRatio(null)
    if (!imageUrl) return
    const img = imageRef.current
    if (!img) return
    const updateAspectRatio = () => {
      if (img.naturalWidth && img.naturalHeight) setImageAspectRatio(img.naturalWidth / img.naturalHeight)
    }
    if (img.complete && img.naturalWidth) {
      updateAspectRatio()
    } else {
      img.addEventListener('load', updateAspectRatio)
      return () => img.removeEventListener('load', updateAspectRatio)
    }
  }, [imageUrl])

  useEffect(() => {
    setDateParts(formatDatePartsClient(event.event_start))
    setStartTime(formatTimeClient(event.event_start))
    if (event.event_end) setEndTime(formatTimeClient(event.event_end))
  }, [event.event_start, event.event_end])

  // Capture tracking params (rdt_cid, fbclid, utm_*, etc.) and create session
  const hasCapturedTracking = useRef(false)
  useEffect(() => {
    if (hasCapturedTracking.current) return
    const existingSessionId = getExistingSessionId()
    if (existingSessionId) return

    const trackingParams = captureTrackingParams(searchParams)
    const hasTrackingParams =
      Object.keys(trackingParams.clickIds).length > 0 ||
      Object.keys(trackingParams.utmParams).length > 0

    if (hasTrackingParams && hasConsentFor('marketing')) {
      hasCapturedTracking.current = true
      createTrackingSession({
        eventId: event.event_id,
        trackingParams,
        hasConsent: true,
      }).catch((err) => console.error('Tracking capture error:', err))
    }
  }, [searchParams, event.event_id])

  const isCoordinates = (str: string | null): boolean => {
    if (!str) return false
    return /^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(str.trim())
  }

  const venueName = event.venue_address || (event.event_location && !isCoordinates(event.event_location) ? event.event_location : null)
  const cityRegion = [event.event_city, event.event_region]
    .filter(Boolean)
    .filter(s => s && s.toLowerCase() !== 'na' && s.toLowerCase() !== 'on')
    .join(', ')
  const hasLocation = venueName || cityRegion

  return (
    <div className="pt-2 pb-8 lg:pt-4 lg:pb-8">
      <div className="flex flex-col lg:flex-row gap-6 lg:gap-12 lg:items-stretch">
        {/* Left Column - Event Image */}
        <div className="w-full lg:w-[320px] flex-shrink-0">
          <a href={eUrl} className="cursor-pointer block w-full transition-transform hover:scale-[1.02]">
            {imageUrl ? (
              <GlowBorder useDarkTheme={useDarkText} className="shadow-2xl" autoRotate autoRotateSpeed={50}>
                <div className={`rounded-2xl overflow-hidden ${theme.imageBorder}`}>
                  <img
                    ref={imageRef}
                    src={imageUrl}
                    alt={stripEmojis(event.event_title)}
                    className="w-full h-auto"
                    style={{ aspectRatio: imageAspectRatio ? `${imageAspectRatio}` : undefined }}
                  />
                </div>
              </GlowBorder>
            ) : (
              <GlowBorder useDarkTheme={useDarkText} className="shadow-2xl" autoRotate autoRotateSpeed={50}>
                <div
                  className={`rounded-2xl aspect-square flex items-center justify-center ${theme.imageBorder}`}
                  style={{ background: `linear-gradient(135deg, ${primaryColor}40, ${secondaryColor}40)` }}
                >
                  <span className={`text-6xl font-bold ${theme.fallbackTextColor}`}>{stripEmojis(event.event_title).charAt(0)}</span>
                </div>
              </GlowBorder>
            )}
          </a>
        </div>

        {/* Right Column - Event Details + Button */}
        <div className="flex-1 min-w-0 flex flex-col items-center lg:items-start">
          {/* Title */}
          <h1
            className={`text-2xl sm:text-3xl lg:text-4xl font-bold mb-6 leading-tight text-center lg:text-left ${useDarkText ? '' : 'drop-shadow-lg'}`}
            style={theme.textStyle}
          >
            {stripEmojis(event.event_title)}
          </h1>

          {/* Date & Location */}
          <div className={`flex items-start ${
            imageAspectRatio && imageAspectRatio > 1.3 && hasLocation
              ? 'flex-col lg:flex-row gap-0 lg:gap-12'
              : 'flex-col'
          }`}>
            {/* Date & Time */}
            <div className={`flex items-center gap-3 lg:gap-4 ${
              imageAspectRatio && imageAspectRatio > 1.3 && hasLocation ? 'mb-4 lg:mb-0' : 'mb-4'
            }`}>
              <div className={`flex-shrink-0 w-12 h-12 lg:w-14 lg:h-14 rounded-lg flex flex-col items-center justify-center ${
                useDarkText ? 'bg-gray-900/10' : 'bg-white/20'
              }`}>
                <span className="text-[10px] lg:text-xs font-semibold leading-none" style={theme.textMutedStyle} suppressHydrationWarning>
                  {dateParts.month}
                </span>
                <span className="text-xl lg:text-2xl font-bold leading-none mt-0.5" style={theme.textStyle} suppressHydrationWarning>
                  {dateParts.day}
                </span>
              </div>
              <div>
                <div className="font-semibold text-base lg:text-lg" style={theme.textStyle} suppressHydrationWarning>
                  {dateParts.weekday},{' '}
                  {dateParts.isDayFirst ? (
                    <>
                      {dateParts.day}
                      <sup className="text-[0.6em] font-bold ml-[0.05em]">{dateParts.ordinalSuffix}</sup>
                      {dateParts.fullDate.replace(/^\d+\s*/, ' ')}
                    </>
                  ) : (
                    dateParts.fullDate
                  )}
                </div>
                <div className="text-sm lg:text-base" style={theme.textMutedStyle} suppressHydrationWarning>
                  {startTime}
                  {endTime && ` - ${endTime}`}
                </div>
              </div>
            </div>

            {/* Location */}
            {hasLocation && (
              <div className={`flex items-center gap-3 lg:gap-4 ${
                imageAspectRatio && imageAspectRatio > 1.3 ? 'mb-6 lg:mb-0' : 'mb-6'
              }`}>
                <div className={`flex-shrink-0 w-12 h-12 lg:w-14 lg:h-14 rounded-lg flex items-center justify-center ${
                  useDarkText ? 'bg-gray-900/10' : 'bg-white/20'
                }`}>
                  <svg className="w-5 h-5 lg:w-6 lg:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={theme.textStyle}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <div className="font-semibold text-base lg:text-lg" style={theme.textStyle}>
                    {venueName || cityRegion}
                  </div>
                  {venueName && cityRegion && (
                    <div className="text-sm lg:text-base" style={theme.textMutedStyle}>
                      {cityRegion}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* CTA Button — pushed to bottom on desktop, full width on mobile */}
          <div className="lg:mt-auto mt-4 w-full lg:w-auto">
            <RegisterButton
              identifier={identifier}
              primaryColor={primaryColor}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function LandingHero(props: Props) {
  return (
    <Suspense fallback={null}>
      <LandingHeroInner {...props} />
    </Suspense>
  )
}
