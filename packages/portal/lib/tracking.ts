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
      // Non-200 means ad tracking module isn't installed or misconfigured — silently skip
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
  const emailHash = await hashValue(email)
  await touchSession(sessionId, { emailHash })
}

/**
 * Update tracking session when user redirects to external registration
 */
export async function markSessionRedirected(sessionId: string): Promise<void> {
  await touchSession(sessionId, { externalRedirect: true })
}

/**
 * The two post-insert updates go through the event-tracking module's
 * SECURITY DEFINER RPC (event-tracking migration 002). A direct UPDATE on
 * integrations_ad_tracking_sessions silently matches no rows for a signed-in
 * member: that role has no SELECT policy on the table, and an UPDATE with a
 * WHERE clause needs one. The RPC validates the session id shape and only
 * ever sets these two columns. Best-effort: a missing module (older install)
 * or a failed call never affects the visitor's flow.
 */
async function touchSession(
  sessionId: string,
  opts: { externalRedirect?: boolean; emailHash?: string }
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) return
  try {
    const supabase = getSupabaseClient()
    const { error } = await supabase.rpc('event_tracking_touch_session', {
      p_session_id: sessionId,
      p_external_redirect: opts.externalRedirect === true,
      p_email_hash: opts.emailHash ?? null,
    })
    if (error) console.warn('tracking session update skipped:', error.message)
  } catch (err) {
    console.warn('tracking session update skipped:', err)
  }
}

/**
 * Get existing session from cookie
 */
export function getExistingSessionId(): string | null {
  return getCookie(SESSION_COOKIE)
}
