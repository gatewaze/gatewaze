'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getSupabaseClient } from '@/lib/supabase/client'
import type { Event } from '@/types/event'

export type EventTimeline = 'upcoming' | 'live' | 'past'

export interface EventUserState {
  timeline: EventTimeline
  isRegistered: boolean
  isConfirmedSpeaker: boolean
  hasTalkSubmission: boolean
  talkStatus: string | null
  talkTitle: string | null
  speakerEditToken: string | null
  presentationUrl: string | null
  presentationStoragePath: string | null
  presentationType: string | null
  calendarAddedAt: string | null
  trackingLinkCopiedAt: string | null
  speakerEmail: string | null
  registrationId: string | null
  registrationCalendarAddedAt: string | null
  isLoading: boolean
}

function getTimeline(event: Event): EventTimeline {
  const now = new Date()
  const start = event.event_start ? new Date(event.event_start) : null
  const end = event.event_end ? new Date(event.event_end) : start

  if (!start) return 'upcoming'

  if (end && end < now) return 'past'
  if (start <= now && (!end || end >= now)) return 'live'
  return 'upcoming'
}

export function useEventUserState(event: Event & { id: string }): EventUserState {
  const { user, session, isLoading: authLoading } = useAuth()
  const [state, setState] = useState<Omit<EventUserState, 'timeline'>>({
    isRegistered: false,
    isConfirmedSpeaker: false,
    hasTalkSubmission: false,
    talkStatus: null,
    talkTitle: null,
    speakerEditToken: null,
    presentationUrl: null,
    presentationStoragePath: null,
    presentationType: null,
    calendarAddedAt: null,
    trackingLinkCopiedAt: null,
    speakerEmail: null,
    registrationId: null,
    registrationCalendarAddedAt: null,
    isLoading: true,
  })
  const [refreshKey, setRefreshKey] = useState(0)

  const timeline = getTimeline(event)

  // Listen for registration changes to trigger re-fetch
  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1)
    window.addEventListener('registration-changed', handler)
    return () => window.removeEventListener('registration-changed', handler)
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!user || !session?.access_token) {
      setState({
        isRegistered: false,
        isConfirmedSpeaker: false,
        hasTalkSubmission: false,
        talkStatus: null,
        talkTitle: null,
        speakerEditToken: null,
        presentationUrl: null,
        presentationStoragePath: null,
        presentationType: null,
        calendarAddedAt: null,
        trackingLinkCopiedAt: null,
        speakerEmail: null,
        registrationId: null,
        registrationCalendarAddedAt: null,
        isLoading: false,
      })
      return
    }

    let cancelled = false

    async function fetchUserState() {
      try {
        // Use the singleton client — it already manages the auth session
        const supabase = getSupabaseClient()

        // Get customer
        const { data: customer } = await supabase
          .from('customers')
          .select('id, email')
          .eq('auth_user_id', user!.id)
          .maybeSingle()

        if (!customer || cancelled) {
          if (!cancelled) setState(prev => ({ ...prev, isLoading: false }))
          return
        }

        // Get member profiles
        const { data: profiles } = await supabase
          .from('member_profiles')
          .select('id')
          .eq('customer_id', customer.id)

        if (!profiles?.length || cancelled) {
          if (!cancelled) setState(prev => ({ ...prev, isLoading: false }))
          return
        }

        const profileIds = profiles.map(p => p.id)

        // Run registration check and speaker check in parallel
        const [registrationResult, speakerResult] = await Promise.all([
          // Check registration
          event.enable_registration
            ? supabase
                .from('event_registrations')
                .select('id, calendar_added_at')
                .eq('event_id', event.event_id)
                .in('member_profile_id', profileIds)
                .neq('status', 'cancelled')
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null }),

          // Check speaker/talk submissions
          (async () => {
            const { data: speakerTalks } = await supabase
              .from('event_talk_speakers')
              .select(`
                is_primary,
                speaker:event_speakers!inner (
                  id,
                  event_uuid,
                  member_profile_id,
                  status
                ),
                talk:event_talks!inner (
                  id,
                  title,
                  status,
                  edit_token,
                  presentation_url,
                  presentation_storage_path,
                  presentation_type,
                  calendar_added_at,
                  tracking_link_copied_at
                )
              `)
              .eq('speaker.event_uuid', event.id)
              .in('speaker.member_profile_id', profileIds)
              .eq('is_primary', true)

            return speakerTalks
          })(),
        ])

        if (cancelled) return

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const registration = registrationResult.data as any
        const isRegistered = !!registration
        const speakerTalks = speakerResult || []

        // Find the most relevant talk (confirmed > approved > pending > other)
        const statusPriority: Record<string, number> = { confirmed: 0, approved: 1, pending: 2, reserve: 3, rejected: 4 }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sorted = [...speakerTalks].sort((a: any, b: any) => {
          const aPri = statusPriority[a.talk?.status] ?? 99
          const bPri = statusPriority[b.talk?.status] ?? 99
          return aPri - bPri
        })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const primaryTalk = sorted[0] as any
        const hasTalkSubmission = speakerTalks.length > 0
        const isConfirmedSpeaker = speakerTalks.some(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (st: any) => st.speaker?.status === 'confirmed' || st.talk?.status === 'confirmed'
        )

        setState({
          isRegistered,
          isConfirmedSpeaker,
          hasTalkSubmission,
          talkStatus: primaryTalk?.talk?.status || null,
          talkTitle: primaryTalk?.talk?.title || null,
          speakerEditToken: primaryTalk?.talk?.edit_token || null,
          presentationUrl: primaryTalk?.talk?.presentation_url || null,
          presentationStoragePath: primaryTalk?.talk?.presentation_storage_path || null,
          presentationType: primaryTalk?.talk?.presentation_type || null,
          calendarAddedAt: primaryTalk?.talk?.calendar_added_at || null,
          trackingLinkCopiedAt: primaryTalk?.talk?.tracking_link_copied_at || null,
          speakerEmail: customer!.email || null,
          registrationId: registration?.id || null,
          registrationCalendarAddedAt: registration?.calendar_added_at || null,
          isLoading: false,
        })
      } catch (err) {
        console.error('Error fetching event user state:', err)
        if (!cancelled) setState(prev => ({ ...prev, isLoading: false }))
      }
    }

    fetchUserState()
    return () => { cancelled = true }
  }, [user, session?.access_token, authLoading, event.id, event.event_id, event.enable_registration, refreshKey])

  return { timeline, ...state }
}
