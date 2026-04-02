'use client'

import { useCallback } from 'react'
import { trackEvent, trackPageView, identifyUser } from '@/lib/analytics'
import { useConsent } from '@/hooks/useConsent'

type AnalyticsValue = string | number | boolean | null | undefined
type AnalyticsProperties = Record<string, AnalyticsValue>

/**
 * Consent-aware analytics hook.
 * Pushes events to dataLayer (GTM-compatible) when analytics consent is granted.
 */
export function useAnalytics() {
  const { categories } = useConsent()
  const isEnabled = categories.analytics

  const track = useCallback(
    (event: string, properties?: AnalyticsProperties) => {
      if (!isEnabled) return
      trackEvent(event, properties as Record<string, unknown>)
    },
    [isEnabled]
  )

  const page = useCallback(
    (name?: string, properties?: AnalyticsProperties) => {
      if (!isEnabled) return
      trackPageView(name, properties as Record<string, unknown>)
    },
    [isEnabled]
  )

  const identify = useCallback(
    (userId: string, traits?: AnalyticsProperties) => {
      if (!isEnabled) return
      identifyUser(userId, traits as Record<string, unknown>)
    },
    [isEnabled]
  )

  return { track, page, identify, isEnabled }
}
