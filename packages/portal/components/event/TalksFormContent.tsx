'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { SpeakerSubmissionForm } from './SpeakerSubmissionForm'
import { getSupabaseClient } from '@/lib/supabase/client'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { PortalButton } from '@/components/ui/PortalButton'
import { useAuth } from '@/hooks/useAuth'
import { useEmailPrefill } from '@/hooks/useEmailPrefill'
import { useEventContext } from './EventContext'

interface ExistingTalk {
  id: string
  status: string
  title: string
  edit_token: string | null
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

interface Props {
  initialStatus?: string
  confirmedDurationCounts?: Record<number, number>
}

export function TalksFormContent({ initialStatus = 'pending', confirmedDurationCounts = {} }: Props) {
  const { event, brandConfig, useDarkText, primaryColor, userState, eventIdentifier, basePath } = useEventContext()
  const { session, isLoading: authLoading } = useAuth()
  const { prefillProfile } = useEmailPrefill(eventIdentifier)
  const [existingTalks, setExistingTalks] = useState<ExistingTalk[]>([])
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [isCheckingSubmission, setIsCheckingSubmission] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingTalkId, setDeletingTalkId] = useState<string | null>(null)
  const hasCheckedRef = useRef(false)

  const panelTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelText: useDarkText ? 'text-white' : 'text-gray-900',
    panelTextMuted: useDarkText ? 'text-gray-300' : 'text-gray-500',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
  }), [useDarkText])

  // Check if authenticated user already has a submission for this event
  useEffect(() => {
    async function checkExistingSubmission() {
      if (hasCheckedRef.current || authLoading || !session?.access_token) {
        return
      }

      hasCheckedRef.current = true
      setIsCheckingSubmission(true)

      try {
        const supabase = getSupabaseClient()

        const { data: person } = await supabase
          .from('people')
          .select('id, email, attributes, avatar_storage_path')
          .eq('auth_user_id', session.user.id)
          .maybeSingle()

        if (!person) {
          setIsCheckingSubmission(false)
          return
        }

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

        const { data: peopleProfiles } = await supabase
          .from('people_profiles')
          .select('id')
          .eq('person_id', person.id)

        if (!peopleProfiles || peopleProfiles.length === 0) {
          setIsCheckingSubmission(false)
          return
        }

        const profileIds = peopleProfiles.map(p => p.id)

        const { data: eventData } = await supabase
          .from('events')
          .select('id')
          .or(`event_id.eq.${event.event_id},event_slug.eq.${event.event_slug || ''}`)
          .maybeSingle()

        if (!eventData) {
          setIsCheckingSubmission(false)
          return
        }

        const { data: speakerTalks } = await supabase
          .from('events_talk_speakers')
          .select(`
            is_primary,
            speaker:events_speakers!inner (
              id,
              event_uuid,
              people_profile_id
            ),
            talk:events_talks!inner (
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
          // Supabase types !inner joins as arrays even when the relation
          // is structurally 1:1, so cast through unknown and unwrap arrays
          // defensively at the boundary.
          type RawSpeakerTalk = {
            talk: {
              id: string; status?: string | null; title?: string | null;
              synopsis?: string | null; duration_minutes?: number | null;
              rejection_reason?: string | null; edit_token?: string | null;
            } | Array<{
              id: string; status?: string | null; title?: string | null;
              synopsis?: string | null; duration_minutes?: number | null;
              rejection_reason?: string | null; edit_token?: string | null;
            }>
          }
          const talks: ExistingTalk[] = (speakerTalks as unknown as RawSpeakerTalk[])
            .map((st) => (Array.isArray(st.talk) ? st.talk[0] : st.talk))
            .filter((t): t is NonNullable<typeof t> => Boolean(t))
            .map((talk) => ({
              id: talk.id,
              status: talk.status || 'pending',
              title: talk.title || '',
              edit_token: talk.edit_token ?? null,
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

  const handleDeleteTalk = async (talkId: string) => {
    if (!session?.access_token) return

    setDeletingTalkId(talkId)
    try {
      const supabase = getSupabaseClient()

      const { error: junctionError } = await supabase
        .from('events_talk_speakers')
        .delete()
        .eq('talk_id', talkId)

      if (junctionError) throw junctionError

      const { error: talkError } = await supabase
        .from('events_talks')
        .delete()
        .eq('id', talkId)

      if (talkError) throw talkError

      setExistingTalks(prev => prev.filter(t => t.id !== talkId))
      setConfirmDeleteId(null)
    } catch (err) {
      console.error('Error deleting submission:', err)
      alert('Failed to delete submission. Please try again.')
    } finally {
      setDeletingTalkId(null)
    }
  }

  const isPast = userState.timeline === 'past'

  // For past events with no existing submissions, show a closed state
  if (isPast && existingTalks.length === 0 && !isCheckingSubmission) {
    return (
      <GlowBorder useDarkTheme={useDarkText}>
        <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
          <div className="text-center py-8">
            <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${useDarkText ? 'bg-gray-900/10' : 'bg-white/20'}`}>
              <svg className={`w-8 h-8 ${panelTheme.panelTextMuted}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className={`text-xl font-semibold ${panelTheme.panelText} mb-2`}>
              This event has ended
            </h2>
            <p className={panelTheme.panelTextMuted}>
              Speaker applications are no longer being accepted for this event.
            </p>
          </div>
        </div>
      </GlowBorder>
    )
  }

  return (
    <div className="space-y-6">
      {/* Show loading state while checking for existing submission */}
      {session && isCheckingSubmission ? (
        <GlowBorder useDarkTheme={useDarkText}>
          <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
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
              <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
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
                              {deletingTalkId === talk.id ? 'Deleting...' : 'Confirm'}
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
                              href={`${basePath}/talks/edit?token=${talk.edit_token}`}
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

          {/* Show submission form if CFP is open and event is not past */}
          {event.enable_call_for_speakers && !isPast ? (
            <GlowBorder useDarkTheme={useDarkText}>
              <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
                <SpeakerSubmissionForm
                  event={event}
                  brandConfig={brandConfig}
                  useDarkTheme={useDarkText}
                  initialStatus={initialStatus}
                  userProfile={userProfile || (prefillProfile ? {
                    email: prefillProfile.email,
                    first_name: prefillProfile.first_name,
                    last_name: prefillProfile.last_name,
                    company: prefillProfile.company || null,
                    job_title: prefillProfile.job_title || null,
                    linkedin_url: null,
                    avatar_url: null,
                  } : null)}
                  confirmedDurationCounts={confirmedDurationCounts}
                  isAdditionalTalk={existingTalks.length > 0}
                />
              </div>
            </GlowBorder>
          ) : existingTalks.length === 0 ? (
            <GlowBorder useDarkTheme={useDarkText}>
              <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
                <div className="text-center py-8">
                  <svg
                    className={`w-16 h-16 mx-auto mb-4 ${panelTheme.panelTextMuted}`}
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
                  <h2 className={`text-xl font-semibold ${panelTheme.panelText} mb-2`}>
                    Speaker Applications Closed
                  </h2>
                  <p className={panelTheme.panelTextMuted}>
                    The call for speakers for this event is currently closed.
                  </p>
                  <p className={`${panelTheme.panelTextMuted} text-sm mt-2`}>
                    Check back later or contact us for more information.
                  </p>
                </div>
              </div>
            </GlowBorder>
          ) : null}
        </>
      )}
    </div>
  )
}
