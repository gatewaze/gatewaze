'use client'

import { Suspense, useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCountdown } from '@/hooks/useCountdown'
import { useEventContext } from './EventContext'
import { EventContent } from './EventContent'
import { RecommendedEventPanel } from './RecommendedEventPanel'
import { ConfirmedSpeakerTasks } from './ConfirmedSpeakerTasks'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { GlowInput } from '@/components/ui/GlowInput'
import { PortalButton } from '@/components/ui/PortalButton'
import { useAuth } from '@/hooks/useAuth'
import { useCompetitionEntry } from '@/hooks/useCompetitionEntry'
import { getClientBrandConfig, isLightColor } from '@/config/brand'
import { getSupabaseClient } from '@/lib/supabase/client'
import { encodeEmail, getEmailFromParams } from '@/lib/emailEncoding'
import { DiscountCard } from './DiscountsContent'
import type { DiscountWithCode } from './DiscountsContent'

export function AboutEventContent() {
  return (
    <Suspense fallback={null}>
      <AboutEventContentInner />
    </Suspense>
  )
}

interface Competition {
  id: string
  title: string
  value: string | null
  intro: string | null
  close_date: string | null
  close_display: string | null
}

function AboutEventContentInner() {
  const { event, useDarkText, recommendedEvent, primaryColor, eventIdentifier, userState, theme, speakerCount, competitionCount, discountCount } = useEventContext()
  const [mounted, setMounted] = useState(false)
  const [showAttendeeCalendar, setShowAttendeeCalendar] = useState(false)
  const [attendeeCalendarAdded, setAttendeeCalendarAdded] = useState(false)
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [competitionsLoaded, setCompetitionsLoaded] = useState(competitionCount === 0)
  const [discounts, setDiscounts] = useState<DiscountWithCode[]>([])
  const { session } = useAuth()
  const searchParams = useSearchParams()
  const showDiscountParam = searchParams.get('discount') === 'true'

  // Delay mounted fade-in until competitions are loaded (or immediately if none)
  useEffect(() => {
    if (competitionsLoaded) setMounted(true)
  }, [competitionsLoaded])

  // Fetch competition details for countdown
  useEffect(() => {
    if (competitionCount === 0) return
    async function fetchCompetitions() {
      try {
        const config = getClientBrandConfig()
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)
        const { data } = await supabase
          .from('events_competitions')
          .select('id, title, value, intro, close_date, close_display')
          .eq('event_id', event.event_id)
          .eq('status', 'active')
          .order('sort_order', { ascending: true })
        if (data) setCompetitions(data)
      } catch (err) {
        console.error('Error fetching competitions:', err)
      } finally {
        setCompetitionsLoaded(true)
      }
    }
    fetchCompetitions()
  }, [competitionCount, event.event_id])

  // Fetch discount details for inline display
  useEffect(() => {
    if (discountCount === 0) return
    async function fetchDiscounts() {
      try {
        const supabase = getSupabaseClient()
        const { data } = await supabase
          .from('events_discounts')
          .select('*')
          .eq('event_id', event.event_id)
          .eq('status', 'active')
          .order('sort_order', { ascending: true })
        if (data) {
          const filtered = (data as DiscountWithCode[]).filter(
            (d) => !d.hidden || showDiscountParam || !!session
          )
          setDiscounts(filtered)
        }
      } catch (err) {
        console.error('Error fetching discounts:', err)
      }
    }
    fetchDiscounts()
  }, [discountCount, event.event_id, showDiscountParam, session])

  // Sync calendar state from fetched registration data
  useEffect(() => {
    if (userState.registrationCalendarAddedAt) {
      setAttendeeCalendarAdded(true)
    }
  }, [userState.registrationCalendarAddedAt])

  const panelTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    textColor: useDarkText ? 'text-gray-900' : 'text-white',
    textMuted: useDarkText ? 'text-gray-600' : 'text-white/70',
  }), [useDarkText])

  const speakerTasksTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelText: useDarkText ? 'text-gray-900' : 'text-white',
    panelTextMuted: useDarkText ? 'text-gray-600' : 'text-white/70',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    summaryBg: useDarkText ? 'bg-gray-900/10' : 'bg-white/10',
    summaryTextMuted: useDarkText ? 'text-gray-500' : 'text-white/50',
    dividerBorder: useDarkText ? 'border-gray-700/30' : 'border-white/10',
  }), [useDarkText])

  const {
    timeline, isRegistered, isConfirmedSpeaker, hasTalkSubmission, talkTitle,
    speakerEditToken, presentationUrl, presentationStoragePath, presentationType,
    calendarAddedAt, trackingLinkCopiedAt, speakerEmail,
    registrationId,
    isLoading: userStateLoading,
  } = userState

  // Calendar URLs for attendees
  const config = getClientBrandConfig()
  const calendarBaseUrl = `${config.supabaseUrl}/functions/v1/calendar`
  const emailEncoded = speakerEmail ? encodeEmail(speakerEmail) : ''
  const eventId = event.event_id

  const attendeeCalendarUrls = useMemo(() => ({
    google: `${calendarBaseUrl}/${eventId}/google/${emailEncoded}`,
    outlook: `${calendarBaseUrl}/${eventId}/outlook/${emailEncoded}`,
    apple: `${calendarBaseUrl}/${eventId}/apple/${emailEncoded}`,
    ics: `${calendarBaseUrl}/${eventId}/ics/${emailEncoded}`,
  }), [calendarBaseUrl, eventId, emailEncoded])

  const handleAttendeeCalendarClick = useCallback(async () => {
    if (attendeeCalendarAdded || !registrationId) return
    setAttendeeCalendarAdded(true)
    try {
      const supabase = getSupabaseClient()
      await supabase
        .from('events_registrations')
        .update({ calendar_added_at: new Date().toISOString() })
        .eq('id', registrationId)
    } catch (err) {
      console.error('Error tracking calendar click:', err)
    }
  }, [attendeeCalendarAdded, registrationId])

  // Join Event panel — query string overrides for testing
  const showJoinPanelOverride = searchParams.get('showJoinPanel') === 'true'
  const simulateTimeline = searchParams.get('simulateTimeline') as 'live' | 'upcoming' | null
  const simulateRegistered = searchParams.get('simulateRegistered')

  const joinTimeline = simulateTimeline || timeline
  const joinIsRegistered = simulateRegistered !== null ? simulateRegistered === 'true' : isRegistered

  const joinEventUrl = useMemo(() => {
    const slug = event.gradual_eventslug
    if (!slug) return null
    const portalDomain = process.env.NEXT_PUBLIC_PORTAL_DOMAIN || 'home.mlops.community'
    const eventUrl = `https://${portalDomain}/public/events/${slug}`
    return `https://${portalDomain}/login?event=${slug}&returnTo=${encodeURIComponent(eventUrl)}&type=event`
  }, [event.gradual_eventslug])

  const showJoinPanel = !!event.gradual_eventslug && (
    joinTimeline === 'live' ||
    joinIsRegistered ||
    showJoinPanelOverride
  )

  return (
    <div>
      {/* Join Event Panel */}
      {showJoinPanel && (
        <div className={`mb-6 transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          <GlowBorder useDarkTheme={useDarkText}>
            <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-5 sm:p-6`}>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-0.5">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  </span>
                </div>
                <div className="flex-1">
                  {joinIsRegistered || showJoinPanelOverride ? (
                    <>
                      <p className={`font-semibold ${panelTheme.textColor}`}>
                        {joinTimeline === 'live' ? 'This event is live now' : 'Join this event'}
                      </p>
                      <p className={`text-sm ${panelTheme.textMuted} mt-0.5`}>
                        {joinTimeline === 'live'
                          ? 'Click below to join the event.'
                          : 'You\'re registered — use the link below to join when it starts.'}
                      </p>
                      <div className="mt-4">
                        <PortalButton
                          variant="primary"
                          primaryColor={primaryColor}
                          glow
                          href={joinEventUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          Join event
                        </PortalButton>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className={`font-semibold ${panelTheme.textColor}`}>This event has started</p>
                      <p className={`text-sm ${panelTheme.textMuted} mt-0.5`}>
                        You're not too late — register now to join.
                      </p>
                      <div className="mt-4">
                        <PortalButton
                          variant="primary"
                          primaryColor={primaryColor}
                          glow
                          href={`/events/${eventIdentifier}/register`}
                        >
                          Register now
                        </PortalButton>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </GlowBorder>
        </div>
      )}

      {/* Past Event Banner */}
      {timeline === 'past' && (
        <div className={`mb-6 transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          <GlowBorder useDarkTheme={useDarkText}>
            <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-5`}>
              <div className="flex items-center gap-3">
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${useDarkText ? 'bg-gray-900/10' : 'bg-white/20'}`}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: theme.textMutedColor }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className={`font-semibold ${panelTheme.textColor}`}>This event has ended</p>
                  <p className={`text-sm ${panelTheme.textMuted}`}>
                    {isRegistered ? 'Thanks for attending!' : 'Browse the details and speakers below.'}
                  </p>
                </div>
              </div>
            </div>
          </GlowBorder>
        </div>
      )}

      {/* Live Event Banner */}
      {timeline === 'live' && (
        <div className={`mb-6 transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          <GlowBorder useDarkTheme={useDarkText}>
            <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-5`}>
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3 flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </span>
                <div>
                  <p className={`font-semibold ${panelTheme.textColor}`}>This event is happening now</p>
                  {event.venue_address && (
                    <p className={`text-sm ${panelTheme.textMuted}`}>{event.venue_address}</p>
                  )}
                </div>
              </div>
            </div>
          </GlowBorder>
        </div>
      )}

      {/* Confirmed Speaker Prep Panel (upcoming/live) */}
      {!userStateLoading && isConfirmedSpeaker && timeline !== 'past' && (
        <div className={`mb-6 transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          <GlowBorder useDarkTheme={useDarkText}>
            <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-5 sm:p-6`}>
              <div className="flex items-start gap-4 mb-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className={`font-semibold ${panelTheme.textColor}`}>You're speaking at this event</p>
                  {talkTitle && (
                    <p className={`text-sm ${panelTheme.textMuted} mt-0.5`}>&ldquo;{talkTitle}&rdquo;</p>
                  )}
                </div>
              </div>

              <div className={`pt-4 ${useDarkText ? 'border-t border-gray-700/30' : 'border-t border-white/10'}`}>
                <ConfirmedSpeakerTasks
                  event={event}
                  editToken={speakerEditToken || undefined}
                  presentationUrl={presentationUrl}
                  presentationStoragePath={presentationStoragePath}
                  presentationType={presentationType}
                  speakerEmail={speakerEmail}
                  calendarAddedAt={calendarAddedAt}
                  trackingLinkCopiedAt={trackingLinkCopiedAt}
                  primaryColor={primaryColor}
                  theme={speakerTasksTheme}
                />
              </div>

              <div className="mt-4">
                <PortalButton
                  variant="secondary"
                  size="small"
                  href={`/events/${eventIdentifier}/talks`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  View your submission
                </PortalButton>
              </div>
            </div>
          </GlowBorder>
        </div>
      )}

      {/* Attendee Checklist (upcoming, registered, not a speaker) */}
      {!userStateLoading && isRegistered && !isConfirmedSpeaker && timeline === 'upcoming' && (() => {
        const hasAgenda = event.enable_agenda ?? false
        const hasSpeakers = speakerCount > 0
        const hasVenue = !!(event.venue_address || event.event_location)
        const showCalendar = !attendeeCalendarAdded && !!speakerEmail
        const hasChecklistItems = hasAgenda || hasSpeakers || hasVenue || showCalendar

        return (
          <div className={`mb-6 transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
            <GlowBorder useDarkTheme={useDarkText}>
              <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-5 sm:p-6`}>
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" style={{ strokeDasharray: 24, strokeDashoffset: 24, animation: 'checkmark-draw 0.4s ease-out 0.2s forwards' }} />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className={`font-semibold ${panelTheme.textColor}`}>You're registered for this event</p>
                    {hasChecklistItems ? (
                      <>
                        <p className={`text-sm ${panelTheme.textMuted} mt-0.5`}>Here are some things you can do to prepare:</p>
                        <div className="mt-4 space-y-3">
                          {/* Add to calendar */}
                          {showCalendar && (
                            <div>
                              <button
                                onClick={() => setShowAttendeeCalendar(!showAttendeeCalendar)}
                                className="flex items-center gap-3 cursor-pointer group w-full text-left"
                              >
                                <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${useDarkText ? 'bg-gray-900/10 group-hover:bg-gray-900/20' : 'bg-white/10 group-hover:bg-white/20'}`}>
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: theme.textMutedColor }}>
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </div>
                                <span className={`text-sm ${panelTheme.textColor} group-hover:opacity-80 transition-opacity`}>
                                  Add to your calendar
                                </span>
                              </button>
                              {showAttendeeCalendar && (
                                <div className="mt-2 ml-11 flex flex-wrap gap-2">
                                  <a
                                    href={attendeeCalendarUrls.google}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={handleAttendeeCalendarClick}
                                    className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${useDarkText ? 'bg-gray-900/10 text-gray-900 hover:bg-gray-900/20' : 'bg-white/10 text-white hover:bg-white/20'}`}
                                  >
                                    Google
                                  </a>
                                  <a
                                    href={attendeeCalendarUrls.outlook}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={handleAttendeeCalendarClick}
                                    className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${useDarkText ? 'bg-gray-900/10 text-gray-900 hover:bg-gray-900/20' : 'bg-white/10 text-white hover:bg-white/20'}`}
                                  >
                                    Outlook
                                  </a>
                                  <a
                                    href={attendeeCalendarUrls.apple}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={handleAttendeeCalendarClick}
                                    className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${useDarkText ? 'bg-gray-900/10 text-gray-900 hover:bg-gray-900/20' : 'bg-white/10 text-white hover:bg-white/20'}`}
                                  >
                                    Apple
                                  </a>
                                  <a
                                    href={attendeeCalendarUrls.ics}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={handleAttendeeCalendarClick}
                                    className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${useDarkText ? 'bg-gray-900/10 text-gray-900 hover:bg-gray-900/20' : 'bg-white/10 text-white hover:bg-white/20'}`}
                                  >
                                    Download .ics
                                  </a>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Check out the agenda */}
                          {hasAgenda && (
                            <Link
                              href={`/events/${eventIdentifier}/agenda`}
                              className="flex items-center gap-3 cursor-pointer group"
                            >
                              <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${useDarkText ? 'bg-gray-900/10 group-hover:bg-gray-900/20' : 'bg-white/10 group-hover:bg-white/20'}`}>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: theme.textMutedColor }}>
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                                </svg>
                              </div>
                              <span className={`text-sm ${panelTheme.textColor} group-hover:opacity-80 transition-opacity`}>
                                Check out the agenda
                              </span>
                            </Link>
                          )}

                          {/* See who's speaking */}
                          {hasSpeakers && (
                            <Link
                              href={`/events/${eventIdentifier}/speakers`}
                              className="flex items-center gap-3 cursor-pointer group"
                            >
                              <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${useDarkText ? 'bg-gray-900/10 group-hover:bg-gray-900/20' : 'bg-white/10 group-hover:bg-white/20'}`}>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: theme.textMutedColor }}>
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              </div>
                              <span className={`text-sm ${panelTheme.textColor} group-hover:opacity-80 transition-opacity`}>
                                See who's speaking
                              </span>
                            </Link>
                          )}

                          {/* Venue info */}
                          {hasVenue && (
                            <div className="flex items-center gap-3">
                              <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${useDarkText ? 'bg-gray-900/10' : 'bg-white/10'}`}>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: theme.textMutedColor }}>
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              </div>
                              <span className={`text-sm ${panelTheme.textMuted}`}>
                                {event.venue_address || event.event_location}
                              </span>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className={`text-sm ${panelTheme.textMuted} mt-0.5`}>We look forward to seeing you at the event.</p>
                    )}
                  </div>
                </div>
              </div>
            </GlowBorder>
          </div>
        )
      })()}

      {/* Talk Submission Status (upcoming, submitted but not confirmed) */}
      {!userStateLoading && hasTalkSubmission && !isConfirmedSpeaker && timeline !== 'past' && (
        <div className={`mb-6 transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          <GlowBorder useDarkTheme={useDarkText}>
            <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-5 sm:p-6`}>
              <div className="flex items-start gap-4">
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${useDarkText ? 'bg-yellow-500/15' : 'bg-yellow-500/20'}`}>
                  <svg className="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className={`font-semibold ${panelTheme.textColor}`}>Your talk is under review</p>
                  {talkTitle && (
                    <p className={`text-sm ${panelTheme.textMuted} mt-0.5`}>&ldquo;{talkTitle}&rdquo;</p>
                  )}
                  <div className="mt-3">
                    <PortalButton
                      variant="secondary"
                      size="small"
                      href={`/events/${eventIdentifier}/talks`}
                    >
                      View submission
                    </PortalButton>
                  </div>
                </div>
              </div>
            </div>
          </GlowBorder>
        </div>
      )}

      {/* Competitions with countdown — desktop: inline, mobile: portaled above register button */}
      {competitions.length > 0 && (
        <>
          {/* Desktop: show inline */}
          <div className={`hidden lg:block mb-10 empty:mb-0 transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
            {competitions.map((comp) => (
              <CompetitionCountdownPanel
                key={comp.id}
                competition={comp}
                eventIdentifier={eventIdentifier}
                useDarkText={useDarkText}
                primaryColor={primaryColor}
                panelTheme={panelTheme}
                isSingleCompetition={competitions.length === 1}
              />
            ))}
          </div>
          {/* Mobile: portal into slot above mobile actions */}
          <MobileCompetitionPortal mounted={mounted}>
            {competitions.map((comp) => (
              <CompetitionCountdownPanel
                key={comp.id}
                competition={comp}
                eventIdentifier={eventIdentifier}
                useDarkText={useDarkText}
                primaryColor={primaryColor}
                panelTheme={panelTheme}
                isSingleCompetition={competitions.length === 1}
              />
            ))}
          </MobileCompetitionPortal>
        </>
      )}

      {/* Discounts — desktop: inline, mobile: portaled above register button */}
      {discounts.length > 0 && (
        <>
          {/* Desktop: show inline */}
          <div className={`hidden lg:block mb-10 space-y-4 transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
            {discounts.map((discount, index) => (
              <DiscountCard key={discount.id} discount={discount} index={index} />
            ))}
          </div>
          {/* Mobile: portal into slot above mobile actions */}
          <MobileDiscountPortal mounted={mounted}>
            {discounts.map((discount, index) => (
              <DiscountCard key={discount.id} discount={discount} index={index} />
            ))}
          </MobileDiscountPortal>
        </>
      )}

      {/* Event Content */}
      <EventContent event={event} useDarkText={useDarkText} />

      {/* Recommended Event (promoted more prominently for past events) */}
      {recommendedEvent && (
        <div className={timeline === 'past' ? 'mt-8' : 'mt-10'}>
          {timeline === 'past' && (
            <p className={`text-sm font-semibold uppercase tracking-wider mb-3 ${panelTheme.textMuted}`}>
              Up Next
            </p>
          )}
          <RecommendedEventPanel
            recommendedEvent={recommendedEvent}
            useDarkText={useDarkText}
            primaryColor={primaryColor}
          />
        </div>
      )}
    </div>
  )
}

/** Portals discount cards into the mobile slot above the register button */
function MobileDiscountPortal({ mounted, children }: { mounted: boolean; children: React.ReactNode }) {
  const [portalTarget] = useState<HTMLElement | null>(
    () => typeof document !== 'undefined' ? document.getElementById('mobile-competition-slot') : null
  )

  if (!portalTarget) return null

  return createPortal(
    <div className={`mb-10 space-y-4 transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      {children}
    </div>,
    portalTarget
  )
}

/** Portals competition panel into the mobile slot above the register button */
function MobileCompetitionPortal({ mounted, children }: { mounted: boolean; children: React.ReactNode }) {
  // Find portal target synchronously so it's ready before the first paint
  const [portalTarget] = useState<HTMLElement | null>(
    () => typeof document !== 'undefined' ? document.getElementById('mobile-competition-slot') : null
  )

  if (!portalTarget) return null

  return createPortal(
    <div className={`mb-10 empty:mb-0 transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      {children}
    </div>,
    portalTarget
  )
}

function CompetitionCountdownPanel({
  competition,
  eventIdentifier,
  useDarkText,
  primaryColor,
  panelTheme,
  isSingleCompetition,
}: {
  competition: Competition
  eventIdentifier: string
  useDarkText: boolean
  primaryColor: string
  panelTheme: { panelBg: string; panelBorder: string; textColor: string; textMuted: string }
  isSingleCompetition: boolean
}) {
  const timeLeft = useCountdown(competition.close_date)
  const searchParams = useSearchParams()
  const { session } = useAuth()
  const { enterCompetition, isEntering, error } = useCompetitionEntry()
  const [email, setEmail] = useState('')
  const [hasEntered, setHasEntered] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  const brandConfig = getClientBrandConfig()
  const brandPrimary = brandConfig.primaryColor

  // Prefill email from query string (supports encoded utm_medium)
  useEffect(() => {
    if (session) return
    const qsEmail = getEmailFromParams(new URLSearchParams(searchParams.toString()))
    if (qsEmail) setEmail(qsEmail)
  }, [searchParams, session])

  // Check if user already entered
  useEffect(() => {
    if (!session?.user?.email) return
    async function checkEntry() {
      const supabase = getSupabaseClient()
      const { data } = await supabase
        .from('events_competition_entries')
        .select('id')
        .eq('competition_id', competition.id)
        .eq('email', session!.user!.email!.toLowerCase())
        .limit(1)
      if (data && data.length > 0) setHasEntered(true)
    }
    checkEntry()
  }, [session, competition.id])

  // Prefill email from sessionStorage (only if not already set by query string)
  useEffect(() => {
    if (session || email) return
    const prefillEmail = sessionStorage.getItem('prefill_email')
    if (prefillEmail) setEmail(prefillEmail)
  }, [session, email])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const entryEmail = session?.user?.email || email.trim()
    if (!entryEmail) return

    const result = await enterCompetition(entryEmail, competition.id)
    if (result.success) {
      setHasEntered(true)
      if (!session) {
        try {
          const supabase = getSupabaseClient()
          const { error: magicLinkError } = await supabase.auth.signInWithOtp({
            email: entryEmail,
            options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
          })
          if (!magicLinkError) setMagicLinkSent(true)
        } catch (err) {
          console.error('Error sending magic link:', err)
        }
      }
    }
  }

  if (timeLeft.isExpired) return null

  return (
    <GlowBorder useDarkTheme={useDarkText} className="shadow-2xl" autoRotate autoRotateSpeed={50} borderWidth={2}>
      <div
        className={`backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder}`}
      >
        {/* Intro banner with brand primary background */}
        <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-4" style={{ backgroundColor: brandPrimary }}>
          <p className="text-xl sm:text-2xl font-bold text-white text-center">
            {competition.intro || `Win ${competition.value || 'prizes'}`}
          </p>
        </div>

        {/* Content area with white-to-transparent gradient */}
        <div
          className="px-5 sm:px-6 pt-4 pb-5 sm:pb-6"
          style={{ background: 'linear-gradient(to bottom, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.15) 100%)' }}
        >

        {/* Countdown timer */}
        <p className="text-xs font-semibold text-gray-600 mb-2 text-center uppercase tracking-wide">Competition entries close in...</p>
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {[
            { value: timeLeft.days, label: 'days' },
            { value: timeLeft.hours, label: 'hrs' },
            { value: timeLeft.minutes, label: 'min' },
            { value: timeLeft.seconds, label: 'sec' },
          ].map(({ value, label }) => (
            <div
              key={label}
              className="text-center rounded-xl py-2.5 bg-white"
            >
              <div className="text-xl sm:text-2xl font-bold tabular-nums text-gray-900">
                {String(value).padStart(2, '0')}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500">
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* Inline entry form for single competition */}
        {isSingleCompetition ? (
          <div className="mt-4">
            {hasEntered ? (
              <div className="p-3 rounded-lg bg-white">
                {session ? (
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center" style={{ backgroundColor: brandPrimary, color: isLightColor(brandPrimary) ? '#000000' : '#ffffff' }}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" style={{ strokeDasharray: 24, strokeDashoffset: 24, animation: 'checkmark-draw 0.4s ease-out 0.2s forwards' }} />
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-gray-900">You&apos;re entered! Good luck!</p>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center mt-0.5" style={{ backgroundColor: brandPrimary, color: isLightColor(brandPrimary) ? '#000000' : '#ffffff' }}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Check your email to complete your entry</p>
                      <p className="text-xs text-gray-500 mt-0.5">We&apos;ve sent a link to {email}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {error && (
                  <div className="mb-3 p-3 rounded-lg bg-red-500/20 border border-red-400/30">
                    <p className={`text-xs ${panelTheme.textColor}`}>{error}</p>
                  </div>
                )}
                {!session ? (
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <GlowInput
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your email"
                        required
                        glowColor={brandPrimary}
                        glowWhenFilled
                        borderRadius="0.5rem"
                        className="w-full text-sm px-4 py-3 border-[3px] rounded-lg bg-white text-gray-900 placeholder-gray-400 border-gray-300 focus:outline-none transition-colors"
                      />
                    </div>
                    <PortalButton
                      variant="primary"
                      primaryColor={brandPrimary}
                      glow
                      type="submit"
                      disabled={isEntering}
                      className="sm:w-auto w-full"
                    >
                      {isEntering ? 'Entering...' : 'Enter now'}
                    </PortalButton>
                  </div>
                ) : (
                  <PortalButton
                    variant="primary"
                    size="small"
                    primaryColor={brandPrimary}
                    glow
                    type="submit"
                    disabled={isEntering}
                  >
                    {isEntering ? 'Entering...' : 'Enter now'}
                  </PortalButton>
                )}
              </form>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <PortalButton
              variant="primary"
              size="small"
              primaryColor={brandPrimary}
              glow
              href={`/events/${eventIdentifier}/competitions`}
            >
              Enter now
            </PortalButton>
          </div>
        )}
        </div>
      </div>
    </GlowBorder>
  )
}
