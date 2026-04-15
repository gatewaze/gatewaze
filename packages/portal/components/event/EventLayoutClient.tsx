'use client'

import { Suspense, useMemo, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import { resolveEventTheme, getThemeBackgroundColor } from '@/config/brand'
import { getEmailFromParams } from '@/lib/emailEncoding'
import { CLICK_ID_PARAMS, UTM_PARAMS } from '@/config/platforms'
import { trackEvent } from '@/lib/analytics'
import { hasConsentFor } from '@/hooks/useConsent'
import { EventHero } from './EventHero'
import { EventCompactBar } from './EventCompactBar'
import { EventSidebar } from './EventSidebar'
import { EventMobileActions } from './EventSidebar'
import { EventProvider, useEventContext } from './EventContext'
import { PersistentBackground } from '@/components/ui/PersistentBackground'
import type { RecommendedEvent } from '@/app/(main)/events/[identifier]/(portal)/layout'

interface Props {
  event: Event & { id: string }
  brandConfig: BrandConfig
  eventIdentifier: string
  speakerCount: number
  sponsorCount: number
  competitionCount: number
  discountCount: number
  mediaCount: number
  recommendedEvent?: RecommendedEvent | null
  children: React.ReactNode
}

/**
 * Captures email and tracking params from the URL and persists to sessionStorage.
 * Isolated in its own component so the useSearchParams() call is wrapped in Suspense,
 * preventing the entire page from bailing out to client-side rendering.
 */
function TrackingParamsCapture() {
  const searchParams = useSearchParams()
  useEffect(() => {
    try {
      const email = getEmailFromParams(searchParams)
      if (email) {
        sessionStorage.setItem('prefill_email', email)
      }

      // Store ad tracking params (click IDs + UTMs) for use on later pages
      const clickIds: Record<string, string> = {}
      for (const [, param] of Object.entries(CLICK_ID_PARAMS)) {
        const value = searchParams.get(param)
        if (value) clickIds[param] = value
      }
      const utmParams: Record<string, string> = {}
      for (const param of UTM_PARAMS) {
        const value = searchParams.get(param)
        if (value) utmParams[param] = value
      }
      if (Object.keys(clickIds).length > 0 || Object.keys(utmParams).length > 0) {
        sessionStorage.setItem('tracking_params', JSON.stringify({ clickIds, utmParams }))
      }
    } catch {
      // sessionStorage not available
    }
  }, [searchParams])
  return null
}

export function EventLayoutClient({ event, brandConfig, eventIdentifier, speakerCount, sponsorCount, competitionCount, discountCount, mediaCount, recommendedEvent, children }: Props) {
  // Resolve theme from event overrides or brand defaults
  const resolved = useMemo(() => resolveEventTheme(event, brandConfig), [event, brandConfig])
  const { theme, colors, primaryColor, secondaryColor } = resolved
  const bgColor = getThemeBackgroundColor(theme, colors, secondaryColor)

  // Only render a separate event background if this event has per-event theme overrides
  const hasEventThemeOverride = !!(event.portal_theme || event.theme_colors || event.gradient_color_1)

  // Determine if we need dark text — follows the UI mode
  const uiMode = brandConfig.portalUiMode
  const useDarkText = uiMode === 'obsidian' || uiMode === 'paper'

  // Set event primary color for cookie consent banner (client-side only to avoid hydration mismatch)
  useEffect(() => {
    document.documentElement.dataset.eventPrimaryColor = primaryColor
    return () => {
      delete document.documentElement.dataset.eventPrimaryColor
    }
  }, [primaryColor])

  // Track event view once on mount
  const hasTrackedView = useRef(false)
  useEffect(() => {
    if (!hasTrackedView.current && hasConsentFor('analytics')) {
      hasTrackedView.current = true
      trackEvent('event_viewed', {
        event_id: event.event_id,
        event_title: event.event_title,
      })
    }
  }, [event.event_id, event.event_title])

  return (
    <div className="min-h-screen">
      <Suspense fallback={null}>
        <TrackingParamsCapture />
      </Suspense>
      {/* Per-event theme background — only rendered if this event overrides the brand theme.
           Otherwise the root layout's PersistentBackground shows through. */}
      {hasEventThemeOverride && (
        <div className="fixed inset-0 h-screen overflow-hidden pointer-events-none">
          <PersistentBackground
            theme={theme}
            themeColors={colors}
            fallbackBg={bgColor}
            gradientWaveConfig={brandConfig.gradientWaveConfig}
          />
        </div>
      )}

      {/* Main Content — EventProvider wraps everything so sidebar + content can access userState */}
      <EventProvider
        event={event}
        brandConfig={brandConfig}
        eventIdentifier={eventIdentifier}
        speakerCount={speakerCount}
        sponsorCount={sponsorCount}
        competitionCount={competitionCount}
        discountCount={discountCount}
        mediaCount={mediaCount}
        recommendedEvent={recommendedEvent}
        useDarkText={useDarkText}
      >
        <EventLayoutInner
          event={event}
          brandConfig={brandConfig}
          eventIdentifier={eventIdentifier}
          useDarkText={useDarkText}
          primaryColor={primaryColor}
          speakerCount={speakerCount}
          sponsorCount={sponsorCount}
          competitionCount={competitionCount}
          discountCount={discountCount}
          mediaCount={mediaCount}
        >
          {children}
        </EventLayoutInner>
      </EventProvider>
    </div>
  )
}

function EventLayoutInner({
  event,
  brandConfig,
  eventIdentifier,
  useDarkText,
  primaryColor,
  speakerCount,
  sponsorCount,
  competitionCount,
  discountCount,
  mediaCount,
  children,
}: {
  event: Event & { id: string }
  brandConfig: BrandConfig
  eventIdentifier: string
  useDarkText: boolean
  primaryColor: string
  speakerCount: number
  sponsorCount: number
  competitionCount: number
  discountCount: number
  mediaCount: number
  children: React.ReactNode
}) {
  const { userState } = useEventContext()
  const heroRef = useRef<HTMLDivElement>(null)

  return (
    <main className="relative z-10">
      {/* Compact sticky bar — slides in when hero scrolls out of view */}
      <EventCompactBar event={event} brandConfig={brandConfig} heroRef={heroRef} eventIdentifier={eventIdentifier} />

      <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8">
        {/* Hero Section */}
        <EventHero event={event} brandConfig={brandConfig} useDarkText={useDarkText} heroRef={heroRef} />

        {/* Mobile: Competition panel portal target (rendered from AboutEventContent) */}
        <div id="mobile-competition-slot" className="lg:hidden" />

        {/* Mobile: Register button + hamburger menu (below hero, above content) */}
        <EventMobileActions
          event={event}
          eventIdentifier={eventIdentifier}
          useDarkText={useDarkText}
          primaryColor={primaryColor}
          speakerCount={speakerCount}
          sponsorCount={sponsorCount}
          competitionCount={competitionCount}
          discountCount={discountCount}
          mediaCount={mediaCount}
          userState={userState}
        />

        {/* Two-column layout: Sidebar + Content */}
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-12 pb-12">
          {/* Left Sidebar - Navigation (desktop only) */}
          <div className="hidden lg:block">
            <EventSidebar
              event={event}
              eventIdentifier={eventIdentifier}
              useDarkText={useDarkText}
              primaryColor={primaryColor}
              speakerCount={speakerCount}
              sponsorCount={sponsorCount}
              competitionCount={competitionCount}
              discountCount={discountCount}
              mediaCount={mediaCount}
              userState={userState}
            />
          </div>

          {/* Right Content - Page Content */}
          <div className="flex-1 min-w-0">
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}
