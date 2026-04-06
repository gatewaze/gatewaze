'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import { getClientBrandConfig } from '@/config/brand'
import { SpeakerSubmissionForm } from './SpeakerSubmissionForm'
import { EventHero, shouldUseDarkText } from './EventHero'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { PortalButton } from '@/components/ui/PortalButton'
import { useAuth } from '@/hooks/useAuth'

// Dynamic import with SSR disabled for WebGL component
const GradientBackground = dynamic(
  () => import('@/components/ui/GradientBackground').then((mod) => mod.GradientBackground),
  { ssr: false }
)

interface Props {
  event: Event
  brandConfig: BrandConfig
  initialStatus?: string
  confirmedDurationCounts?: Record<number, number>
}

interface ExistingTalk {
  id: string
  status: string
  title: string
  edit_token: string
}

interface UserProfile {
  email: string
  first_name: string
  last_name: string
  company: string | null
  job_title: string | null
  linkedin_url: string | null
  avatar_url: string | null
}

export function SpeakersPageContent({ event, brandConfig, initialStatus = 'pending', confirmedDurationCounts = {} }: Props) {
  const { session, isLoading: authLoading } = useAuth()
  const [existingTalks, setExistingTalks] = useState<ExistingTalk[]>([])
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [isCheckingSubmission, setIsCheckingSubmission] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingTalkId, setDeletingTalkId] = useState<string | null>(null)
  const hasCheckedRef = useRef(false)
  const primaryColor = brandConfig.primaryColor
  const secondaryColor = brandConfig.secondaryColor

  const useDarkText = useMemo(
    () => shouldUseDarkText(primaryColor, secondaryColor),
    [primaryColor, secondaryColor]
  )

  const theme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelText: useDarkText ? 'text-white' : 'text-gray-900',
    panelTextMuted: useDarkText ? 'text-gray-300' : 'text-gray-500',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
  }), [useDarkText])

  // Set event primary color for cookie consent banner
  useEffect(() => {
    document.documentElement.dataset.eventPrimaryColor = primaryColor
    return () => {
      delete document.documentElement.dataset.eventPrimaryColor
    }
  }, [primaryColor])

  // Check if authenticated user already has a submission for this event
  useEffect(() => {
    async function checkExistingSubmission() {
      // Only check once, and only if user is authenticated
      if (hasCheckedRef.current || authLoading || !session?.access_token) {
        return
      }

      hasCheckedRef.current = true
      setIsCheckingSubmission(true)

      try {
        const config = getClientBrandConfig()
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${session.access_token}` } }
        })

        // Get person for this auth user with profile data
        const { data: person } = await supabase
          .from('people')
          .select('id, email, attributes, avatar_storage_path')
          .eq('auth_user_id', session.user.id)
          .maybeSingle()

        if (!person) {
          setIsCheckingSubmission(false)
          return
        }

        // Build user profile from person data
        const personAttrs = (person.attributes as Record<string, string>) || {}
        let avatarUrl: string | null = null
        if (person.avatar_storage_path) {
          const { data: { publicUrl } } = supabase.storage
            .from('media')
            .getPublicUrl(person.avatar_storage_path)
          avatarUrl = publicUrl
        }

        setUserProfile({
          email: person.email,
          first_name: personAttrs.first_name || '',
          last_name: personAttrs.last_name || '',
          company: personAttrs.company || null,
          job_title: personAttrs.job_title || null,
          linkedin_url: personAttrs.linkedin_url || null,
          avatar_url: avatarUrl,
        })

        // Get people profiles for this person
        const { data: peopleProfiles } = await supabase
          .from('people_profiles')
          .select('id')
          .eq('person_id', person.id)

        if (!peopleProfiles || peopleProfiles.length === 0) {
          setIsCheckingSubmission(false)
          return
        }

        const profileIds = peopleProfiles.map(p => p.id)

        // Check if any of these profiles have a submission for this event
        // We need to get the event's UUID first since event_speakers uses event_uuid
        const { data: eventData } = await supabase
          .from('events')
          .select('id')
          .or(`event_id.eq.${event.event_id},event_slug.eq.${event.event_slug || ''}`)
          .maybeSingle()

        if (!eventData) {
          setIsCheckingSubmission(false)
          return
        }

        // Get all talks submitted by this speaker for this event
        const { data: speakerTalks } = await supabase
          .from('events_talk_speakers')
          .select(`
            is_primary,
            speaker:event_speakers!inner (
              id,
              event_uuid,
              people_profile_id
            ),
            talk:event_talks!inner (
              id,
              title,
              status,
              edit_token
            )
          `)
          .eq('speaker.event_uuid', eventData.id)
          .in('speaker.people_profile_id', profileIds)
          .eq('is_primary', true)

        if (speakerTalks && speakerTalks.length > 0) {
          const talks: ExistingTalk[] = speakerTalks.map((st: any) => ({
            id: st.talk.id,
            status: st.talk.status || 'pending',
            title: st.talk.title || '',
            edit_token: st.talk.edit_token,
          }))
          setExistingTalks(talks)
        }
      } catch (err) {
        console.error('Error checking existing submission:', err)
      } finally {
        setIsCheckingSubmission(false)
      }
    }

    checkExistingSubmission()
  }, [session, authLoading, event.event_id, event.event_slug])

  // Handle talk deletion
  const handleDeleteTalk = async (talkId: string) => {
    if (!session?.access_token) return

    setDeletingTalkId(talkId)
    try {
      const config = getClientBrandConfig()
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${session.access_token}` } }
      })

      // Delete from event_talk_speakers junction table first (foreign key constraint)
      const { error: junctionError } = await supabase
        .from('events_talk_speakers')
        .delete()
        .eq('talk_id', talkId)

      if (junctionError) {
        console.error('Error deleting talk speaker link:', junctionError)
        throw junctionError
      }

      // Delete the talk itself
      const { error: talkError } = await supabase
        .from('events_talks')
        .delete()
        .eq('id', talkId)

      if (talkError) {
        console.error('Error deleting talk:', talkError)
        throw talkError
      }

      // Remove from local state
      setExistingTalks(prev => prev.filter(t => t.id !== talkId))
      setConfirmDeleteId(null)
    } catch (err) {
      console.error('Error deleting submission:', err)
      alert('Failed to delete submission. Please try again.')
    } finally {
      setDeletingTalkId(null)
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: secondaryColor }}>
      {/* CSS Gradient fallback + WebGL Gradient - fixed to cover entire viewport including header */}
      <div
        className="fixed inset-0 h-screen overflow-hidden pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 100% 100% at 100% 100%, ${primaryColor} 0%, transparent 80%),
                       radial-gradient(ellipse 80% 80% at 0% 0%, ${secondaryColor} 0%, transparent 70%),
                       linear-gradient(135deg, ${secondaryColor} 0%, ${primaryColor}60 100%),
                       ${secondaryColor}`,
        }}
      >
        <GradientBackground
          color1={primaryColor}
          color2={secondaryColor}
          color3={event.gradient_color_3 || '#1e2837'}
        />
      </div>

      {/* Main Content */}
      <main className="relative z-10">
        {/* Event Hero */}
        <EventHero event={event} brandConfig={brandConfig} useDarkText={useDarkText} />

        {/* Form Panel */}
        <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8 pb-12 space-y-6">
          {/* Show loading state while checking for existing submission */}
          {session && isCheckingSubmission ? (
            <GlowBorder useDarkTheme={useDarkText}>
              <div className={`${theme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${theme.panelBorder} p-6 sm:p-8`}>
                <div className="text-center py-8">
                  <div
                    className="loader mx-auto mb-4"
                    style={{
                      '--primary-color': '#fff',
                      '--secondary-color': primaryColor,
                    } as React.CSSProperties}
                  />
                  <p className="text-white/70">Checking for existing submissions...</p>
                </div>
              </div>
            </GlowBorder>
          ) : (
            <>
              {/* Show existing submissions if any */}
              {existingTalks.length > 0 && (
                <GlowBorder useDarkTheme={useDarkText}>
                  <div className={`${theme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${theme.panelBorder} p-6 sm:p-8`}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: `${primaryColor}40` }}>
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-white">
                          Your submission{existingTalks.length > 1 ? 's' : ''}
                        </h2>
                        <p className="text-white/60 text-sm">
                          {existingTalks.length} talk{existingTalks.length > 1 ? 's' : ''} submitted for this event
                        </p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {existingTalks.map((talk) => (
                        <div
                          key={talk.id}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl bg-white/5 border border-white/10"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium truncate">&ldquo;{talk.title}&rdquo;</p>
                            <p className="text-white/60 text-sm">
                              Status: <span className="capitalize font-medium">{talk.status}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {confirmDeleteId === talk.id ? (
                              <>
                                <span className="text-white/60 text-sm mr-1">Delete?</span>
                                <button
                                  onClick={() => handleDeleteTalk(talk.id)}
                                  disabled={deletingTalkId === talk.id}
                                  className="cursor-pointer px-3 py-1.5 text-sm font-medium rounded-lg bg-red-500/80 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                                >
                                  {deletingTalkId === talk.id ? (
                                    <span className="flex items-center gap-1">
                                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                      </svg>
                                      Deleting
                                    </span>
                                  ) : (
                                    'Confirm'
                                  )}
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  disabled={deletingTalkId === talk.id}
                                  className="cursor-pointer px-3 py-1.5 text-sm font-medium rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <PortalButton
                                  variant="secondary"
                                  size="small"
                                  href={`/events/${event.event_slug || event.event_id}/talks/edit?token=${talk.edit_token}`}
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                  Edit
                                </PortalButton>
                                <button
                                  onClick={() => setConfirmDeleteId(talk.id)}
                                  className="cursor-pointer p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-white/60 hover:text-red-400 transition-colors"
                                  title="Delete submission"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </GlowBorder>
              )}

              {/* Show submission form if CFP is open */}
              {event.enable_call_for_speakers ? (
                <GlowBorder useDarkTheme={useDarkText}>
                  <div className={`${theme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${theme.panelBorder} p-6 sm:p-8`}>
                    <SpeakerSubmissionForm
                      event={event}
                      brandConfig={brandConfig}
                      useDarkTheme={useDarkText}
                      initialStatus={initialStatus}
                      userProfile={userProfile}
                      confirmedDurationCounts={confirmedDurationCounts}
                      isAdditionalTalk={existingTalks.length > 0}
                    />
                  </div>
                </GlowBorder>
              ) : existingTalks.length === 0 ? (
                /* CFP closed and no existing submissions */
                <GlowBorder useDarkTheme={useDarkText}>
                  <div className={`${theme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${theme.panelBorder} p-6 sm:p-8`}>
                    <div className="text-center py-8">
                      <svg
                        className={`w-16 h-16 mx-auto mb-4 ${theme.panelTextMuted}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                        />
                      </svg>
                      <h2 className={`text-xl font-semibold ${theme.panelText} mb-2`}>
                        Speaker Applications Closed
                      </h2>
                      <p className={`${theme.panelTextMuted}`}>
                        The call for speakers for this event is currently closed.
                      </p>
                      <p className={`${theme.panelTextMuted} text-sm mt-2`}>
                        Check back later or contact us for more information.
                      </p>
                    </div>
                  </div>
                </GlowBorder>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
