'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  captureTrackingParams,
  createTrackingSession,
  getExistingSessionId,
} from '@/lib/tracking'
import type { TrackingSession } from '@/types/event'

interface UseTrackingCaptureOptions {
  eventId?: string
  hasConsent: boolean
  email?: string
}

interface UseTrackingCaptureResult {
  session: TrackingSession | null
  isCapturing: boolean
  error: string | null
}

/**
 * Hook to capture tracking parameters and create a session
 *
 * This should be called when a user lands on a tracking page.
 * It captures all relevant ad tracking parameters from the URL
 * and cookies, then creates a tracking session in the database.
 */
export function useTrackingCapture(options: UseTrackingCaptureOptions): UseTrackingCaptureResult {
  const { eventId, hasConsent, email } = options
  const searchParams = useSearchParams()

  const [session, setSession] = useState<TrackingSession | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Use ref to track if we've already captured
  const hasCaptured = useRef(false)

  useEffect(() => {
    // Only capture once, and only if user has consented
    if (hasCaptured.current || !hasConsent) {
      return
    }

    // Check if we already have a session
    const existingSessionId = getExistingSessionId()
    if (existingSessionId) {
      // We already have a session, don't create a new one
      // (Could fetch the existing session here if needed)
      return
    }

    const captureAndCreate = async () => {
      setIsCapturing(true)
      setError(null)

      try {
        // Capture all tracking parameters
        const trackingParams = captureTrackingParams(searchParams)

        // Create the tracking session
        const newSession = await createTrackingSession({
          eventId,
          trackingParams,
          hasConsent,
          email,
        })

        if (newSession) {
          setSession(newSession)
          hasCaptured.current = true
        } else {
          setError('Failed to create tracking session')
        }
      } catch (err) {
        console.error('Error capturing tracking:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setIsCapturing(false)
      }
    }

    captureAndCreate()
  }, [hasConsent, eventId, email, searchParams])

  return {
    session,
    isCapturing,
    error,
  }
}
