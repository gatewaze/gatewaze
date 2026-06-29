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
import { EventSectionMenu } from './EventSectionMenu'
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
  /**
   * True when a `live_event_config` row exists for this event (the
   * virtual-events module has been configured). Drives the visibility
   * of the "Live" sidebar item + CTA buttons.
   */
  hasVirtualEvent?: boolean
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

export function EventLayoutClient({ event, brandConfig, eventIdentifier, speakerCount, sponsorCount, competitionCount, discountCount, mediaCount, hasVirtualEvent = false, recommendedEvent, children }: Props) {
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
          speakerCount={speakerCount}
          sponsorCount={sponsorCount}
          competitionCount={competitionCount}
          discountCount={discountCount}
          mediaCount={mediaCount}
          hasVirtualEvent={hasVirtualEvent}
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
  speakerCount,
  sponsorCount,
  competitionCount,
  discountCount,
  mediaCount,
  hasVirtualEvent,
  children,
}: {
  event: Event & { id: string }
  brandConfig: BrandConfig
  eventIdentifier: string
  useDarkText: boolean
  speakerCount: number
  sponsorCount: number
  competitionCount: number
  discountCount: number
  mediaCount: number
  hasVirtualEvent: boolean
  children: React.ReactNode
}) {
  const { userState } = useEventContext()
  const heroRef = useRef<HTMLDivElement>(null)

  return (
    <main className="relative z-10">
      <div className="pub-wrap">
        {/* Hero Section (now carries the Register + Add-to-calendar actions) */}
        <EventHero event={event} brandConfig={brandConfig} useDarkText={useDarkText} heroRef={heroRef} />

        {/* Mobile: Competition panel portal target (rendered from AboutEventContent) */}
        <div id="mobile-competition-slot" className="lg:hidden" />

        {/* Section menu + content. Menu is a sticky left column on desktop, a horizontal scroller on mobile. */}
        <div className="grid grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)] gap-4 lg:gap-8 pb-12">
          <EventSectionMenu
            event={event}
            eventIdentifier={eventIdentifier}
            useDarkText={useDarkText}
            speakerCount={speakerCount}
            sponsorCount={sponsorCount}
            competitionCount={competitionCount}
            discountCount={discountCount}
            mediaCount={mediaCount}
            hasVirtualEvent={hasVirtualEvent}
            userState={userState}
          />
          <div className="min-w-0">
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}
