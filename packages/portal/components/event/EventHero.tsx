'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { stripEmojis } from '@/lib/text'

interface DateParts {
  month: string
  day: string
  weekday: string
  fullDate: string
  /** Ordinal suffix (st, nd, rd, th) for day-first locales, empty for month-first */
  ordinalSuffix: string
  /** Whether the locale uses day-first format (e.g., "3 March" vs "March 3") */
  isDayFirst: boolean
}

/**
 * Get ordinal suffix for a day number (1st, 2nd, 3rd, 4th, etc.)
 */
function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) {
    return 'th'
  }
  switch (day % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

/**
 * Check if a date string uses day-first format (e.g., "3 March" vs "March 3")
 */
function isDayFirstFormat(dateStr: string, day: number): boolean {
  return dateStr.match(new RegExp(`^${day}\\s`)) !== null
}

// Format date using en-US locale for consistent SSR (fallback)
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

// Format date using viewer's locale (client-side only)
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
    const date = new Date(dateStr)
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return ''
  }
}

function formatTimeClient(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return ''
  }
}

/**
 * Calculate relative luminance of a hex color
 * Returns a value between 0 (black) and 1 (white)
 */
function getLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '')
  if (!/^[0-9A-Fa-f]{6}$/.test(cleanHex)) return 0

  const r = parseInt(cleanHex.substring(0, 2), 16) / 255
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255

  // Apply gamma correction
  const R = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)
  const G = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)
  const B = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)

  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

/**
 * Determine if we should use dark text based on background luminance
 * Uses a threshold that considers both primary colors in the gradient
 */
export function shouldUseDarkText(color1: string, color2: string): boolean {
  const lum1 = getLuminance(color1)
  const lum2 = getLuminance(color2)
  // Use average luminance, weighted toward primary color
  const avgLuminance = lum1 * 0.6 + lum2 * 0.4
  // If average luminance > 0.5, use dark text (background is light)
  return avgLuminance > 0.5
}

interface Props {
  event: Event
  brandConfig: BrandConfig
  useDarkText: boolean
  heroRef?: React.RefObject<HTMLDivElement | null>
}

export function EventHero({ event, brandConfig, useDarkText, heroRef }: Props) {
  const primaryColor = brandConfig.primaryColor
  const secondaryColor = brandConfig.secondaryColor

  // Theme colors based on background luminance
  const theme = useMemo(() => ({
    textStyle: useDarkText ? { color: '#111827' } : { color: '#ffffff' },
    textMutedStyle: useDarkText ? { color: '#4b5563' } : { color: 'rgba(255,255,255,0.8)' },
    fallbackTextColor: useDarkText ? 'text-gray-900/40' : 'text-white/30',
    imageBorder: useDarkText ? 'border border-gray-900/15' : 'border border-white/10',
    fallbackGradientAlpha: useDarkText ? '80' : '40',
  }), [useDarkText])

  // Use SSR-safe date formatting initially, then update to client locale after hydration
  const [dateParts, setDateParts] = useState<DateParts>(() => formatDatePartsSSR(event.event_start))
  const [startTime, setStartTime] = useState(() => formatTimeSSR(event.event_start))
  const [endTime, setEndTime] = useState(() => event.event_end ? formatTimeSSR(event.event_end) : '')

  // Track image aspect ratio for natural sizing
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const imageUrl = event.event_logo || event.screenshot_url || ''

  useEffect(() => {
    // Reset aspect ratio when image URL changes
    setImageAspectRatio(null)

    if (!imageUrl) return

    const img = imageRef.current
    if (!img) return

    const updateAspectRatio = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setImageAspectRatio(img.naturalWidth / img.naturalHeight)
      }
    }

    // If image is already loaded (cached), get dimensions immediately
    if (img.complete && img.naturalWidth) {
      updateAspectRatio()
    } else {
      // Otherwise wait for load event
      img.addEventListener('load', updateAspectRatio)
      return () => img.removeEventListener('load', updateAspectRatio)
    }
  }, [imageUrl])

  useEffect(() => {
    // Update to client locale after hydration
    setDateParts(formatDatePartsClient(event.event_start))
    setStartTime(formatTimeClient(event.event_start))
    if (event.event_end) {
      setEndTime(formatTimeClient(event.event_end))
    }
  }, [event.event_start, event.event_end])

  // Helper to detect if a string looks like coordinates (e.g., "37.3893889,-122.0832101")
  const isCoordinates = (str: string | null): boolean => {
    if (!str) return false
    return /^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(str.trim())
  }

  // Get the venue name - use first part of venue_address (before the street details), or event_location if not coordinates
  const venueName = (event.venue_address ? event.venue_address.split(',')[0].trim() : null)
    || (event.event_location && !isCoordinates(event.event_location) ? event.event_location : null)

  // Build city/region string for subtitle
  const cityRegion = [event.event_city, event.event_region]
    .filter(Boolean)
    .filter(s => s && s.toLowerCase() !== 'na' && s.toLowerCase() !== 'on') // Filter out placeholder values
    .join(', ')

  // Determine if we have any location info to show
  const hasLocation = venueName || cityRegion

  // Event identifier for linking
  const eventIdentifier = event.event_slug || event.event_id

  // Fixed width for the image column (used for alignment with sidebar below)
  const IMAGE_COLUMN_WIDTH = 'w-full lg:w-[320px]'

  return (
    <div ref={heroRef} className="pt-2 pb-8 lg:pt-4 lg:pb-8">
      {/* Two Column Layout - Fixed width image, fluid content */}
      <div className="flex flex-col lg:flex-row gap-6 lg:gap-12 items-center lg:items-start">
        {/* Left Column - Event Image (full width on mobile, fixed 320px on desktop) */}
        <div className={`order-1 lg:order-1 ${IMAGE_COLUMN_WIDTH} flex-shrink-0`}>
          {(event.event_logo || event.screenshot_url) ? (
            <Link
              href={`/events/${eventIdentifier}`}
              className="block w-full transition-transform hover:scale-[1.02]"
            >
              <GlowBorder useDarkTheme={useDarkText} className="" autoRotate autoRotateSpeed={50}>
                <div className={`rounded-2xl overflow-hidden ${theme.imageBorder}`}>
                  <img
                    ref={imageRef}
                    src={imageUrl}
                    alt={stripEmojis(event.event_title)}
                    className="w-full h-auto"
                    style={{
                      aspectRatio: imageAspectRatio ? `${imageAspectRatio}` : undefined,
                    }}
                  />
                </div>
              </GlowBorder>
            </Link>
          ) : (
            // Fallback: brand icon if available, otherwise gradient card with first letter
            <Link
              href={`/events/${eventIdentifier}`}
              className="block w-full transition-transform hover:scale-[1.02]"
            >
              <GlowBorder useDarkTheme={useDarkText} className="" autoRotate autoRotateSpeed={50}>
                <div
                  className={`rounded-2xl aspect-square flex items-center justify-center ${theme.imageBorder}`}
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor}${theme.fallbackGradientAlpha}, ${secondaryColor}${theme.fallbackGradientAlpha})`,
                  }}
                >
                  {brandConfig.faviconUrl ? (
                    <img
                      src={brandConfig.faviconUrl}
                      alt={stripEmojis(event.event_title)}
                      className="w-3/5 h-3/5 object-contain"
                    />
                  ) : (
                    <span className={`text-6xl font-bold ${theme.fallbackTextColor}`}>{stripEmojis(event.event_title).charAt(0)}</span>
                  )}
                </div>
              </GlowBorder>
            </Link>
          )}
        </div>

        {/* Right Column - Event Details (takes remaining width) */}
        <div className="order-2 lg:order-2 flex-1 min-w-0 flex flex-col items-center lg:items-start">
          {/* Title */}
          <h1
            className={`text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 leading-none text-center lg:text-left ${useDarkText ? '' : 'drop-shadow-lg'}`}
            style={theme.textStyle}
          >
            {stripEmojis(event.event_title)}
          </h1>

          {/* Date & Location Panel */}
          {/* Use horizontal layout when image is landscape (creates gap below image) */}
          <div className={`flex items-center lg:items-start ${
            imageAspectRatio && imageAspectRatio > 1.3 && hasLocation
              ? 'flex-col lg:flex-row gap-0 lg:gap-12'
              : 'flex-col'
          }`}>
            {/* Date & Time - Calendar style */}
            <div className={`flex items-center gap-3 lg:gap-4 ${
              imageAspectRatio && imageAspectRatio > 1.3 && hasLocation ? 'mb-4 lg:mb-0' : 'mb-4'
            }`}>
              {/* Calendar icon box */}
              <div
                className={`flex-shrink-0 w-12 h-12 lg:w-14 lg:h-14 rounded-lg flex flex-col items-center justify-center ${
                  useDarkText ? 'bg-gray-900/5' : 'bg-white/5'
                }`}
                style={{ backdropFilter: 'blur(var(--glass-blur, 4px))', WebkitBackdropFilter: 'blur(var(--glass-blur, 4px))' }}
              >
                <span
                  className="text-[10px] lg:text-xs font-semibold leading-none"
                  style={theme.textMutedStyle}
                  suppressHydrationWarning
                >
                  {dateParts.month}
                </span>
                <span
                  className="text-xl lg:text-2xl font-bold leading-none mt-0.5"
                  style={theme.textStyle}
                  suppressHydrationWarning
                >
                  {dateParts.day}
                </span>
              </div>
              {/* Date details */}
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
                {/* Location icon box */}
                <div
                  className={`flex-shrink-0 w-12 h-12 lg:w-14 lg:h-14 rounded-lg flex items-center justify-center ${
                    useDarkText ? 'bg-gray-900/5' : 'bg-white/5'
                  }`}
                  style={{ backdropFilter: 'blur(var(--glass-blur, 4px))', WebkitBackdropFilter: 'blur(var(--glass-blur, 4px))' }}
                >
                  <svg
                    className="w-5 h-5 lg:w-6 lg:h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    style={theme.textStyle}
                  >
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
                </div>
                {/* Location details */}
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

        </div>
      </div>
    </div>
  )
}
