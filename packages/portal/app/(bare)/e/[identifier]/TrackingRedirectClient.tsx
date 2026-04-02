'use client'

import { useEffect, useState } from 'react'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { captureTrackingParams, createTrackingSession, markSessionRedirected, getExistingSessionId } from '@/lib/tracking'
import { hasConsentFor } from '@/hooks/useConsent'
import { getPlatformFromClickId } from '@/config/platforms'
import { trackEvent } from '@/lib/analytics'
import type { BrandConfig } from '@/config/brand'

interface Props {
  event: {
    event_id: string
    event_link: string
  }
  brandConfig: BrandConfig
  searchParams: string
}

/**
 * Build the redirect URL with UTM params and tracking session ID appended.
 * Encodes the session ID into utm_source as {platform}__{session_id} so that
 * Luma persists it in the custom_source CSV column for conversion attribution.
 */
function buildRedirectUrl(
  eventLink: string,
  trackingParams: { clickIds: Record<string, string>; utmParams: Record<string, string> },
  sessionId: string | null
): string {
  const url = new URL(eventLink)

  // Determine the ad platform from click IDs
  let platform: string | undefined
  for (const [clickParam] of Object.entries(trackingParams.clickIds)) {
    platform = getPlatformFromClickId(clickParam)
    if (platform) break
  }

  // Build utm_source: encode both platform and session ID for Luma custom_source
  if (sessionId && platform) {
    url.searchParams.set('utm_source', `${platform}__${sessionId}`)
  } else if (sessionId) {
    url.searchParams.set('utm_source', `direct__${sessionId}`)
  } else if (trackingParams.utmParams.utm_source) {
    url.searchParams.set('utm_source', trackingParams.utmParams.utm_source)
  }

  // Pass through other UTM params
  if (trackingParams.utmParams.utm_medium) {
    url.searchParams.set('utm_medium', trackingParams.utmParams.utm_medium)
  }
  if (trackingParams.utmParams.utm_campaign) {
    url.searchParams.set('utm_campaign', trackingParams.utmParams.utm_campaign)
  }

  // Also put session ID in utm_content for platforms that persist all UTM params
  if (sessionId) {
    url.searchParams.set('utm_content', sessionId)
  } else if (trackingParams.utmParams.utm_content) {
    url.searchParams.set('utm_content', trackingParams.utmParams.utm_content)
  }

  if (trackingParams.utmParams.utm_term) {
    url.searchParams.set('utm_term', trackingParams.utmParams.utm_term)
  }

  return url.toString()
}

export function TrackingRedirectClient({ event, brandConfig, searchParams }: Props) {
  const [status, setStatus] = useState<'loading' | 'redirecting'>('loading')

  useEffect(() => {
    const handleRedirect = async () => {
      try {
        // Capture tracking parameters from URL query string
        const params = new URLSearchParams(searchParams)
        const trackingParams = captureTrackingParams(params)

        // Check if this is a unique click (no existing session)
        const existingSessionId = getExistingSessionId()

        // Only create a new session if we have tracking params or no existing session
        const hasTrackingParams =
          Object.keys(trackingParams.clickIds).length > 0 ||
          Object.keys(trackingParams.utmParams).length > 0

        // Create tracking session if we have tracking data and marketing consent
        let session = null
        const hasMarketingConsent = hasConsentFor('marketing')
        if ((hasTrackingParams || !existingSessionId) && hasMarketingConsent) {
          session = await createTrackingSession({
            eventId: event.event_id,
            trackingParams,
            hasConsent: hasMarketingConsent,
          })
        }

        // Mark session as redirected
        if (session) {
          await markSessionRedirected(session.sessionId)
        }

        // Build redirect URL with UTM params + session ID appended
        const redirectUrl = buildRedirectUrl(
          event.event_link,
          trackingParams,
          session?.sessionId || null
        )

        // Redirect to destination
        setStatus('redirecting')

        if (hasConsentFor('analytics')) {
          trackEvent('event_redirect', {
            event_id: event.event_id,
            destination: event.event_link,
          })
        }

        // Small delay to ensure tracking is saved
        setTimeout(() => {
          window.location.href = redirectUrl
        }, 100)
      } catch (err) {
        console.error('Redirect error:', err)
        // Even on error, redirect to the event
        window.location.href = event.event_link
      }
    }

    handleRedirect()
  }, [event, searchParams])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <LoadingSpinner
        message={status === 'redirecting' ? 'Redirecting to registration...' : 'Loading...'}
        brandConfig={brandConfig}
      />
    </div>
  )
}
