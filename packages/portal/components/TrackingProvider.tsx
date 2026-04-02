'use client'

import { useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { CLICK_ID_PARAMS, UTM_PARAMS } from '@/config/platforms'
import { captureTrackingParams, createTrackingSession, getExistingSessionId } from '@/lib/tracking'
import { hasConsentFor } from '@/hooks/useConsent'

/**
 * Checks if the current URL has any tracking parameters (UTM or click IDs)
 */
function hasTrackingParams(searchParams: URLSearchParams): boolean {
  // Check for click IDs
  for (const param of Object.values(CLICK_ID_PARAMS)) {
    if (searchParams.get(param)) return true
  }
  // Check for UTM params
  for (const param of UTM_PARAMS) {
    if (searchParams.get(param)) return true
  }
  return false
}

/**
 * Inner component that uses useSearchParams (requires Suspense boundary)
 */
function TrackingCaptureInner() {
  const searchParams = useSearchParams()
  const hasInitialized = useRef(false)

  useEffect(() => {
    // Only run once per page load
    if (hasInitialized.current) return

    // Check if we have tracking params
    if (!hasTrackingParams(searchParams)) return

    // Check if we already have a session
    const existingSessionId = getExistingSessionId()
    if (existingSessionId) return

    // Check for marketing consent (defaults to true if not explicitly denied)
    if (!hasConsentFor('marketing')) return

    hasInitialized.current = true

    // Capture and create session asynchronously
    const createSession = async () => {
      try {
        const trackingParams = captureTrackingParams(searchParams)

        // Create session without tying to a specific event
        // The event association will happen when they register
        await createTrackingSession({
          trackingParams,
          hasConsent: true,
        })
      } catch (error) {
        console.error('Failed to create tracking session:', error)
      }
    }

    createSession()
  }, [searchParams])

  return null
}

/**
 * Provider component that automatically captures tracking parameters
 * and creates a tracking session when users land on any page with
 * UTM parameters or ad platform click IDs.
 *
 * Place in root layout to ensure tracking happens on every page.
 */
export function TrackingProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <TrackingCaptureInner />
      </Suspense>
      {children}
    </>
  )
}
