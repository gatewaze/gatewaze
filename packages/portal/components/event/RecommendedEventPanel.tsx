'use client'

import { useState, useEffect, useMemo } from 'react'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { PortalButton } from '@/components/ui/PortalButton'
import { useRegistrationStatus } from '@/hooks/useRegistrationStatus'
import type { RecommendedEvent } from '@/app/(main)/events/[identifier]/(portal)/layout'
import { stripEmojis } from '@/lib/text'

interface Props {
  recommendedEvent: RecommendedEvent
  useDarkText: boolean
  primaryColor: string
}

function formatEventDate(startDate: string | null, endDate: string | null, locale?: string): string {
  if (!startDate) return ''
  const start = new Date(startDate)
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  const loc = locale || undefined
  const startStr = start.toLocaleDateString(loc, options)

  if (endDate) {
    const end = new Date(endDate)
    if (start.toDateString() !== end.toDateString()) {
      const endStr = end.toLocaleDateString(loc, options)
      return `${startStr} – ${endStr}`
    }
  }

  return startStr
}

function formatLocation(city: string | null, countryCode: string | null): string {
  const parts = [city, countryCode?.toUpperCase()].filter(Boolean)
  return parts.join(', ')
}

export function RecommendedEventPanel({ recommendedEvent, useDarkText, primaryColor }: Props) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const theme = useMemo(() => ({
    textColor: useDarkText ? '#1f2937' : '#ffffff',
    textMutedColor: useDarkText ? '#374151' : 'rgba(255,255,255,0.7)',
    headingColor: useDarkText ? '#111827' : '#ffffff',
    labelColor: useDarkText ? '#6b7280' : 'rgba(255,255,255,0.5)',
  }), [useDarkText])

  const { isRegistered } = useRegistrationStatus(recommendedEvent)
  const imageUrl = recommendedEvent.screenshot_url || recommendedEvent.event_logo || ''
  // Use browser locale after mount for SSR safety, fallback to en-US on server
  const dateStr = formatEventDate(
    recommendedEvent.event_start,
    recommendedEvent.event_end,
    mounted ? undefined : 'en-US'
  )
  const locationStr = formatLocation(recommendedEvent.event_city, recommendedEvent.event_country_code)

  const panelContent = (
    <GlassPanel
      useDarkTheme={useDarkText}
      autoRotate
      autoRotateSpeed={20}
      padding="p-0"
    >
      <div className="flex flex-col sm:flex-row gap-0">
        {imageUrl && (
          <div className="sm:w-56 sm:min-w-56 flex-shrink-0 self-start">
            <img
              src={imageUrl}
              alt={stripEmojis(recommendedEvent.event_title)}
              className="w-full rounded-t-2xl sm:rounded-t-none sm:rounded-l-2xl"
            />
          </div>
        )}
        <div className="flex-1 p-5 sm:p-6 flex flex-col justify-center">
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: theme.labelColor }}
          >
            Recommended Event
          </p>
          <h3
            className="text-lg sm:text-xl font-bold mb-2 leading-tight"
            style={{ color: theme.headingColor }}
          >
            {stripEmojis(recommendedEvent.event_title)}
          </h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1" suppressHydrationWarning>
            {dateStr && (
              <p className="text-sm" style={{ color: theme.textMutedColor }} suppressHydrationWarning>
                {dateStr}
              </p>
            )}
            {locationStr && (
              <p className="text-sm" style={{ color: theme.textMutedColor }}>
                {locationStr}
              </p>
            )}
          </div>
          {isRegistered ? (
            <div className="mt-4 flex items-center gap-2">
              <div className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor }}>
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm font-medium text-white">
                You're registered
              </span>
            </div>
          ) : recommendedEvent.event_link && (
            <div className="mt-4">
              <PortalButton
                variant="primary"
                primaryColor={primaryColor}
                size="small"
                href={recommendedEvent.event_link}
                target="_blank"
              >
                {recommendedEvent.register_button_text || 'Register now'}
              </PortalButton>
            </div>
          )}
        </div>
      </div>
    </GlassPanel>
  )

  return (
    <div className={`transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      {panelContent}
    </div>
  )
}
