'use client'

/**
 * Tracking Utilities
 *
 * Functions for capturing ad tracking parameters and creating tracking sessions.
 * This is the core of the conversion tracking system - it captures all relevant
 * data from ad clicks before users are redirected to external registration.
 *
 * Client-only: uses browser APIs (cookies, localStorage, document)
 */

import { getCookie, setCookie } from './cookies'
import { getSupabaseClient } from './supabase/client'
import { CLICK_ID_PARAMS, PLATFORM_COOKIES, UTM_PARAMS } from '@/config/platforms'
import { getClientBrandConfig } from '@/config/brand'
import type { TrackingParams, TrackingSession } from '@/types/event'

// Session cookie name
const SESSION_COOKIE = 'gw_tracking_session'

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}`
}

/**
 * Hash a value using SHA-256 (for email hashing)
 */
export async function hashValue(value: string): Promise<string> {
  const normalized = value.toLowerCase().trim()
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Capture all tracking parameters from the current URL and cookies
 */
export function captureTrackingParams(searchParams: URLSearchParams): TrackingParams {
  const clickIds: Record<string, string> = {}
  const platformCookies: Record<string, string> = {}
  const utmParams: Record<string, string> = {}

  // Capture click IDs from URL
  for (const [, param] of Object.entries(CLICK_ID_PARAMS)) {
    const value = searchParams.get(param)
    if (value) {
      clickIds[param] = value
    }
  }

  // Capture platform cookies
  for (const [, cookieNames] of Object.entries(PLATFORM_COOKIES)) {
    for (const name of cookieNames) {
      const value = getCookie(name)
      if (value) {
        platformCookies[name] = value
      }
    }
  }

  // Capture UTM parameters
  for (const param of UTM_PARAMS) {
    const value = searchParams.get(param)
    if (value) {
      utmParams[param] = value
    }
  }

  return {
    clickIds,
    platformCookies,
    utmParams,
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    landingPage: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  }
}

/**
 * Create a tracking session via server API (to capture IP address)
 */
export async function createTrackingSession(params: {
  eventId?: string
  trackingParams: TrackingParams
  hasConsent: boolean
  email?: string
}): Promise<TrackingSession | null> {
  const { eventId, trackingParams, hasConsent, email } = params
  const brandConfig = getClientBrandConfig()

  const sessionId = generateSessionId()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  // Determine which platforms user has consented to (for now, all if consented)
  const consentedPlatforms = hasConsent ? Object.keys(CLICK_ID_PARAMS) : []

  // Hash email if provided
  let emailHash: string | undefined
  if (email) {
    emailHash = await hashValue(email)
  }

  try {
    // Call server API to create session (captures IP address server-side)
    const response = await fetch('/api/tracking-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        brandId: brandConfig.id,
        eventId,
        sessionId,
        clickIds: trackingParams.clickIds,
        platformCookies: trackingParams.platformCookies,
        utmParams: trackingParams.utmParams,
        referrer: trackingParams.referrer,
        landingPage: trackingParams.landingPage,
        userAgent: trackingParams.userAgent,
        emailHash,
        hasConsent,
        consentedPlatforms,
        expiresAt: expiresAt.toISOString(),
      }),
    })

    if (!response.ok) {
      // 404 means ad tracking module isn't installed — silently skip
      if (response.status === 404) return null
      console.error('Failed to create tracking session:', await response.text())
      return null
    }

    const data = await response.json()

    // Store session ID in cookie for potential later matching
    setCookie(SESSION_COOKIE, sessionId, 7)

    return {
      id: data.id,
      sessionId: data.sessionId,
      eventId: data.eventId,
    }
  } catch (error) {
    console.error('Failed to create tracking session:', error)
    return null
  }
}

/**
 * Update tracking session with email (for later matching)
 */
export async function updateSessionEmail(sessionId: string, email: string): Promise<void> {
  const supabase = getSupabaseClient()
  const emailHash = await hashValue(email)

  await supabase
    .from('integrations_ad_tracking_sessions')
    .update({
      email_hash: emailHash,
    })
    .eq('session_id', sessionId)
}

/**
 * Update tracking session when user redirects to external registration
 */
export async function markSessionRedirected(sessionId: string): Promise<void> {
  const supabase = getSupabaseClient()

  await supabase
    .from('integrations_ad_tracking_sessions')
    .update({
      external_redirect_at: new Date().toISOString(),
    })
    .eq('session_id', sessionId)
}

/**
 * Get existing session from cookie
 */
export function getExistingSessionId(): string | null {
  return getCookie(SESSION_COOKIE)
}
