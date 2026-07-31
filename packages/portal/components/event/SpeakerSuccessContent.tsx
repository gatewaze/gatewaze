'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { isLightColor } from '@/config/brand'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { PortalButton } from '@/components/ui/PortalButton'
import { ConfirmedSpeakerTasks } from '@/components/event/ConfirmedSpeakerTasks'
import { useAuth } from '@/hooks/useAuth'
import { useEventContext } from '@/components/event/EventContext'
import { signInHref } from '@/lib/signInHref'

interface Props {
  editToken?: string
  isExisting?: boolean
  isUpdated?: boolean
  statusReset?: boolean
  speakerStatus?: string | null
  speakerAvatarUrl?: string | null
  talkTitle?: string | null
  presentationUrl?: string | null
  presentationStoragePath?: string | null
  presentationType?: string | null
  speakerEmail?: string | null
  calendarAddedAt?: string | null
  trackingLinkCopiedAt?: string | null
}

interface SubmissionData {
  email: string
  first_name: string
  last_name: string
  company: string
  job_title: string
  talk_title: string
  talk_synopsis: string
  event_title: string
  status?: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SpeakerSuccessContent({ editToken, isExisting, isUpdated, statusReset, speakerStatus, speakerAvatarUrl, talkTitle: _talkTitle, presentationUrl, presentationStoragePath, presentationType, speakerEmail, calendarAddedAt, trackingLinkCopiedAt }: Props) {
  const { event, basePath, primaryColor, useDarkText } = useEventContext()
  const { session, isLoading: authLoading } = useAuth()

  // Require sign-in if accessing via token without an active session
  const requiresSignIn = editToken && !session && !authLoading

  // Sign-in URL that lands back on this success page after auth. The sign-in
  // page picks the right auth flow for the brand (LFID SSO auto-fires on
  // ?sso=1 when it's the sole provider; magic-link otherwise). Previously
  // this component hard-called supabase.auth.signInWithOtp, which broke on
  // brands (AAIF) that have turned magic-link off in favour of LFID.
  const signInRedirect = signInHref(
    editToken
      ? `${basePath}/talks/success/${editToken}`
      : `${basePath}/talks/success`,
  )

  // Theme for the panel
  const theme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelText: useDarkText ? 'text-white' : 'text-white',
    panelTextMuted: useDarkText ? 'text-gray-300' : 'text-white/70',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    summaryBg: 'bg-black/20',
    summaryTextMuted: useDarkText ? 'text-white/60' : 'text-white/60',
    dividerBorder: useDarkText ? 'border-white/20' : 'border-white/30',
  }), [useDarkText])

  // Get submission data from sessionStorage
  const [submissionData, setSubmissionData] = useState<SubmissionData | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('speakerSubmission')
    if (stored) {
      try {
        setSubmissionData(JSON.parse(stored))
      } catch (e) {
        console.error('Failed to parse submission data:', e)
      }
    }
  }, [])

  // Show loading state while checking auth status
  if (editToken && authLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div
            className="loader mx-auto mb-4"
            style={{
              '--primary-color': '#fff',
              '--secondary-color': primaryColor,
            } as React.CSSProperties}
          />
          <p className="text-white/70">Loading...</p>
        </div>
      </div>
    )
  }

  // Show sign-in prompt if accessing via email link without recent submission
  if (requiresSignIn) {
    // Mask email for display (show first 2 chars + ... + domain)
    const maskedEmail = speakerEmail
      ? `${speakerEmail.slice(0, 2)}${'*'.repeat(Math.min(speakerEmail.indexOf('@') - 2, 5))}${speakerEmail.slice(speakerEmail.indexOf('@'))}`
      : null

    return (
      <GlowBorder useDarkTheme={useDarkText}>
        <div className={`${theme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${theme.panelBorder} p-6 sm:p-8`}>
          <div className="text-center">
            <div
              className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center"
              style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}
            >
              <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" className="opacity-90" />
                <circle cx="12" cy="16" r="1.5" fill={primaryColor} />
                <path
                  d="M8 11V7a4 4 0 1 1 8 0v4"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                  className="animate-lock-shackle"
                />
              </svg>
            </div>
            <style jsx>{`
              @keyframes lock-shackle {
                0%   { transform: translateY(-3px); opacity: 0.7; }
                50%  { transform: translateY(0);    opacity: 1; }
                100% { transform: translateY(0);    opacity: 1; }
              }
              .animate-lock-shackle {
                animation: lock-shackle 1s ease-out forwards;
              }
            `}</style>

            <h1 className={`text-2xl font-bold ${theme.panelText} mb-2`}>
              Verify your identity
            </h1>
            <p className={`${theme.panelTextMuted} mb-4 max-w-md mx-auto`}>
              Sign in to view your speaker submission
              {maskedEmail ? <> for <span className={`${theme.panelText} font-medium`}>{maskedEmail}</span></> : null}.
            </p>

            <PortalButton
              variant="primary"
              primaryColor={primaryColor}
              onClick={() => { window.location.href = signInRedirect }}
              glow={true}
              className="inline-flex cursor-pointer"
            >
              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
              </svg>
              Sign in to continue
            </PortalButton>
          </div>
        </div>
      </GlowBorder>
    )
  }

  return (
  <>
    <GlowBorder useDarkTheme={useDarkText}>
      <div className={`${theme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${theme.panelBorder} p-6 sm:p-8`}>
        {/* Success Icon */}
        <div className="text-center mb-6">
          <div
            className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center animate-[scale-in_0.3s_ease-out]"
            style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}
          >
            <svg
              className="w-10 h-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
                style={{
                  strokeDasharray: 24,
                  strokeDashoffset: 0,
                  animation: 'draw-check 0.4s ease-out 0.2s backwards',
                }}
              />
            </svg>
          </div>
          <style jsx>{`
            @keyframes draw-check {
              from {
                stroke-dashoffset: 24;
              }
              to {
                stroke-dashoffset: 0;
              }
            }
            @keyframes scale-in {
              from {
                transform: scale(0);
                opacity: 0;
              }
              to {
                transform: scale(1);
                opacity: 1;
              }
            }
          `}</style>
          <h1 className={`text-2xl sm:text-3xl font-bold ${theme.panelText}`}>
            {isUpdated ? 'Submission updated!' : isExisting ? 'Already submitted!' : 'Application received!'}
          </h1>
        </div>

        {/* Submission Summary */}
        {submissionData && (
          <div className="rounded-xl p-4 sm:p-6 mb-6" style={{ backgroundColor: 'rgba(0, 0, 0, 0.2)' }}>
            <h2 className={`text-lg font-semibold ${theme.panelText} mb-4`}>Your submission</h2>

            <div className="space-y-4">
              {/* Speaker Info with Photo */}
              <div className="flex items-start gap-4">
                {/* Profile Photo */}
                <div className="flex-shrink-0">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden border-2 border-white/20 bg-black/20">
                    {speakerAvatarUrl ? (
                      <img
                        src={speakerAvatarUrl}
                        alt={`${submissionData.first_name} ${submissionData.last_name}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg
                          className="w-8 h-8 text-white/40"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>

                {/* Speaker Details */}
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className={`text-xs uppercase tracking-wide ${theme.summaryTextMuted} mb-1`}>Name</p>
                    <p className={`${theme.panelText} font-medium`}>
                      {submissionData.first_name} {submissionData.last_name}
                    </p>
                  </div>
                  <div>
                    <p className={`text-xs uppercase tracking-wide ${theme.summaryTextMuted} mb-1`}>Email</p>
                    <p className={`${theme.panelText} font-medium`}>{submissionData.email}</p>
                  </div>
                  <div>
                    <p className={`text-xs uppercase tracking-wide ${theme.summaryTextMuted} mb-1`}>Company</p>
                    <p className={`${theme.panelText} font-medium`}>{submissionData.company}</p>
                  </div>
                  <div>
                    <p className={`text-xs uppercase tracking-wide ${theme.summaryTextMuted} mb-1`}>Job Title</p>
                    <p className={`${theme.panelText} font-medium`}>{submissionData.job_title}</p>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className={`border-t ${theme.dividerBorder}`} />

              {/* Talk Info */}
              <div>
                <p className={`text-xs uppercase tracking-wide ${theme.summaryTextMuted} mb-1`}>Talk Title</p>
                <p className={`${theme.panelText} font-semibold text-lg`}>{submissionData.talk_title}</p>
              </div>

              <div>
                <p className={`text-xs uppercase tracking-wide ${theme.summaryTextMuted} mb-1`}>Synopsis</p>
                <p className={`${theme.panelText} whitespace-pre-wrap`}>{submissionData.talk_synopsis}</p>
              </div>
            </div>
          </div>
        )}

        {/* Status Reset Warning */}
        {statusReset && (
          <div className="rounded-lg p-4 mb-6 bg-yellow-500/20 border border-yellow-400/30">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="font-medium text-yellow-300">Status reset</p>
                <p className="text-sm text-yellow-200/80">
                  Your talk content was changed, so your submission status has been reset to pending for re-review.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Status Notice */}
        {(() => {
          // Prefer server-fetched status, then sessionStorage, then default to pending
          const status = speakerStatus || submissionData?.status || 'pending'
          const statusConfig = {
            pending: {
              badge: 'bg-yellow-500/20 text-yellow-300',
              label: 'Pending',
              title: "What's next?",
              message: 'Your application is now pending review. We\'ll notify you by email once a decision has been made.',
            },
            approved: {
              badge: 'bg-blue-500/20 text-blue-300',
              label: 'Approved',
              title: 'Congratulations!',
              message: 'Your talk has been approved. We\'ll be in touch with next steps soon.',
            },
            confirmed: {
              badge: 'bg-blue-500/20 text-blue-300',
              label: 'Confirmed',
              title: 'You\'re confirmed!',
              message: 'Your talk is confirmed for the event. We\'ll send you more details closer to the date.',
            },
            reserve: {
              badge: 'bg-purple-500/20 text-purple-300',
              label: 'Reserve',
              title: 'On the reserve list',
              message: 'You\'re on our reserve list. We\'ll contact you if a slot becomes available.',
            },
            rejected: {
              badge: 'bg-red-500/20 text-red-300',
              label: 'Not selected',
              title: 'Thank you',
              message: 'Unfortunately, your talk was not selected for this event. We hope you\'ll apply again in the future.',
            },
          }
          const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending

          return (
            <div
              className="rounded-lg p-4 mb-6 border border-white/20"
              style={{ backgroundColor: `${primaryColor}33` }}
            >
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <p className="font-medium text-white">{config.title}</p>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.badge}`}>
                      {config.label}
                    </span>
                  </div>
                  <p className="text-sm text-white/90">
                    {config.message}
                  </p>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Actions */}
        {editToken && (
          <div className="flex flex-col sm:flex-row gap-3">
            <PortalButton
              variant="primary"
              primaryColor={primaryColor}
              href={`${basePath}/talks/edit${editToken ? `?token=${editToken}` : ""}`}
              className="flex-1"
            >
              Edit submission
            </PortalButton>
          </div>
        )}

        {/* Sign-in suggestion - only show if not signed in */}
        {!session && (
          <div className={`mt-6 pt-6 border-t ${theme.dividerBorder} flex items-center justify-center`}>
            <span className={`text-sm ${theme.panelTextMuted} mr-3`}>
              Want to track all your submissions?
            </span>
            <Link
              href="/sign-in"
              className={`inline-flex items-center gap-1 text-sm font-medium ${theme.panelText} hover:opacity-80 transition-colors`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
              </svg>
              Sign in
            </Link>
          </div>
        )}
      </div>
    </GlowBorder>

      {/* Confirmed Speaker Tasks - Separate panel below */}
      {speakerStatus === 'confirmed' && (
        <div className="mt-6">
          <GlowBorder useDarkTheme={useDarkText}>
            <div className={`${theme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${theme.panelBorder} p-6 sm:p-8`}>
              <h2 className={`text-lg font-semibold ${theme.panelText} mb-4`}>Speaker tasks</h2>
              <ConfirmedSpeakerTasks
                event={event}
                editToken={editToken}
                presentationUrl={presentationUrl}
                presentationStoragePath={presentationStoragePath}
                presentationType={presentationType}
                speakerEmail={speakerEmail}
                calendarAddedAt={calendarAddedAt}
                trackingLinkCopiedAt={trackingLinkCopiedAt}
                primaryColor={primaryColor}
                theme={theme}
              />
            </div>
          </GlowBorder>
        </div>
      )}
    </>
  )
}
