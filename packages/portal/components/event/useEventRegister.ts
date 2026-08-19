'use client'

import { useCallback } from 'react'
import type { Event } from '@/types/event'
import { CLICK_ID_PARAMS } from '@/config/platforms'
import { createTrackingSession, captureTrackingParams, markSessionRedirected } from '@/lib/tracking'
import { hasConsentFor } from '@/hooks/useConsent'
import { getSupabaseClient } from '@/lib/supabase/client'

export interface RegisterTarget {
  showRegisterButton: boolean
  useExternalLink: boolean
  registerHref: string | undefined
}

/**
 * Pure resolver for the register CTA target. Extracted from EventSidebar so the
 * members-only gate (EventContext) can compute the same destination without a
 * circular import back into the sidebar.
 */
export function computeRegisterTarget(event: Event, basePath: string): RegisterTarget {
  const now = new Date()
  const eventEndDate = event.event_end ? new Date(event.event_end) : new Date(event.event_start)
  const isPastEvent = eventEndDate < now

  // Scraper-captured Register button URL (when present) takes priority over
  // event_link — same rationale as the original useRegisterLink.
  const actionRegister = event.source_details?.action_links?.register

  const showRegisterButton = (event.enable_registration ?? false) && !isPastEvent
  const useExternalLink =
    !!actionRegister || (!event.enable_native_registration && !!event.event_link)
  const registerHref = actionRegister
    ?? (useExternalLink ? (event.event_link ?? undefined) : `${basePath}/register`)

  return { showRegisterButton, useExternalLink, registerHref }
}

/**
 * Build a tracked external URL from stored sessionStorage tracking params and
 * navigate to it. Unchanged behaviour, moved here so both the sidebar buttons
 * and the members-only gate share one implementation.
 */
export function useExternalRegisterHandler(event: Event) {
  return useCallback(async () => {
    if (!event.event_link) return

    let storedParams: { clickIds: Record<string, string>; utmParams: Record<string, string> } | null = null
    try {
      const raw = sessionStorage.getItem('tracking_params')
      if (raw) storedParams = JSON.parse(raw)
    } catch { /* ignore */ }

    let sessionId: string | null = null
    if (storedParams && hasConsentFor('marketing')) {
      const searchParams = new URLSearchParams()
      for (const [k, v] of Object.entries(storedParams.clickIds)) searchParams.set(k, v)
      for (const [k, v] of Object.entries(storedParams.utmParams)) searchParams.set(k, v)
      const trackingParams = captureTrackingParams(searchParams)
      const newSession = await createTrackingSession({
        eventId: event.event_id,
        trackingParams,
        hasConsent: true,
      })
      if (newSession) {
        sessionId = newSession.sessionId
        await markSessionRedirected(sessionId)
      }
    }

    const url = new URL(event.event_link)
    if (storedParams) {
      const platform = Object.entries(CLICK_ID_PARAMS).find(([, param]) => storedParams!.clickIds[param])?.[0]
      if (sessionId && platform) {
        url.searchParams.set('utm_source', `${platform}__${sessionId}`)
      } else if (sessionId) {
        url.searchParams.set('utm_source', `direct__${sessionId}`)
      } else if (storedParams.utmParams.utm_source) {
        url.searchParams.set('utm_source', storedParams.utmParams.utm_source)
      }
      if (storedParams.utmParams.utm_medium) url.searchParams.set('utm_medium', storedParams.utmParams.utm_medium)
      if (storedParams.utmParams.utm_campaign) url.searchParams.set('utm_campaign', storedParams.utmParams.utm_campaign)
      if (sessionId) {
        url.searchParams.set('utm_content', sessionId)
      } else if (storedParams.utmParams.utm_content) {
        url.searchParams.set('utm_content', storedParams.utmParams.utm_content)
      }
      if (storedParams.utmParams.utm_term) url.searchParams.set('utm_term', storedParams.utmParams.utm_term)
    }

    window.location.href = url.toString()
  }, [event.event_link, event.event_id])
}

/**
 * Is the currently signed-in viewer a member? Uses the auth.uid()-based
 * `current_person_is_member` RPC (granted to authenticated) through the portal
 * browser client. Fail-closed: any error / anon caller resolves to false, so the
 * members-only modal is shown rather than silently allowing registration.
 *
 * UI HINT ONLY — this is NOT the security boundary. Registration is enforced
 * server-side: the events-registration edge function rejects non-member emails
 * (403 members_only) and RLS governs data access. Never treat this boolean (or
 * `event.registration_members_only`) as authoritative for gating real data.
 */
export async function checkCurrentPersonIsMember(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.rpc('current_person_is_member')
    return !error && data === true
  } catch {
    return false
  }
}
