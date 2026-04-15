'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { getClientBrandConfig, isLightColor } from '@/config/brand'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { PortalButton } from '@/components/ui/PortalButton'
import { ConfirmedSpeakerTasks } from '@/components/event/ConfirmedSpeakerTasks'
import { useAuth } from '@/hooks/useAuth'
import { useEventContext } from '@/components/event/EventContext'

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
  const { event, eventIdentifier, basePath, primaryColor, useDarkText } = useEventContext()
  const { session, isLoading: authLoading } = useAuth()

  // Require sign-in if accessing via token without an active session
  const requiresSignIn = editToken && !session && !authLoading

  // State for magic link sending
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null)

  // Send magic link to the speaker's email
  const sendMagicLink = useCallback(async () => {
    if (!speakerEmail) return

    setIsSendingMagicLink(true)
    setMagicLinkError(null)

    try {
      const config = getClientBrandConfig()
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)

      // Use a redirect URL with the token in the path (not query params)
      // This is more reliable with Supabase's redirect handling
      // The /events/[identifier]/talks/success/[token] route will redirect to the main success page
      const redirectUrl = editToken
        ? `${window.location.origin}${basePath}/talks/success/${editToken}`
        : `${window.location.origin}${basePath}/talks/success`

      const { error } = await supabase.auth.signInWithOtp({
        email: speakerEmail,
        options: {
          emailRedirectTo: redirectUrl,
        },
      })

      if (error) {
        console.error('Magic link error:', error)
        setMagicLinkError('Failed to send magic link. Please try again.')
      } else {
        setMagicLinkSent(true)
      }
    } catch (err) {
      console.error('Magic link error:', err)
      setMagicLinkError('An unexpected error occurred. Please try again.')
    } finally {
      setIsSendingMagicLink(false)
    }
  }, [speakerEmail, editToken, basePath])

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
            {magicLinkSent ? (
              <>
                {/* Success: Magic link sent */}
                <div
                  className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}
                >
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>

                <h1 className={`text-2xl font-bold ${theme.panelText} mb-2`}>
                  Check your email
                </h1>
                <p className={`${theme.panelTextMuted} mb-2 max-w-md mx-auto`}>
                  We&apos;ve sent a magic link to:
                </p>
                <p className={`${theme.panelText} font-medium mb-4`}>
                  {speakerEmail}
                </p>
                <p className={`${theme.panelTextMuted} text-sm max-w-md mx-auto`}>
                  Click the link in your email to sign in and view your submission. The link will expire in 1 hour.
                </p>

                <button
                  onClick={() => {
                    setMagicLinkSent(false)
                    setMagicLinkError(null)
                  }}
                  className={`mt-6 text-sm ${theme.panelTextMuted} hover:${theme.panelText} underline cursor-pointer transition-colors`}
                >
                  Didn&apos;t receive it? Send again
                </button>
              </>
            ) : (
              <>
                {/* Initial: Request magic link */}
                <div
                  className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}
                >
                  <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none">
                    {/* Lock body */}
                    <rect
                      x="5" y="11" width="14" height="10" rx="2"
                      fill="currentColor"
                      className="opacity-90"
                    />
                    {/* Keyhole */}
                    <circle cx="12" cy="16" r="1.5" fill={primaryColor} />
                    {/* Lock shackle with animation */}
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
                    0% {
                      transform: translateY(-3px);
                      opacity: 0.7;
                    }
                    50% {
                      transform: translateY(0);
                      opacity: 1;
                    }
                    100% {
                      transform: translateY(0);
                      opacity: 1;
                    }
                  }
                  .animate-lock-shackle {
                    animation: lock-shackle 1s ease-out forwards;
                  }
                `}</style>

                <h1 className={`text-2xl font-bold ${theme.panelText} mb-2`}>
                  Verify your identity
                </h1>
                <p className={`${theme.panelTextMuted} mb-4 max-w-md mx-auto`}>
                  To view your speaker submission, we&apos;ll send a magic link to:
                </p>
                <p className={`${theme.panelText} font-medium text-lg mb-6`}>
                  {maskedEmail || speakerEmail}
                </p>

                {magicLinkError && (
                  <div className="mb-4 p-3 rounded-lg bg-red-500/20 border border-red-400/30 text-red-200 text-sm">
                    {magicLinkError}
                  </div>
                )}

                <PortalButton
                  variant="primary"
                  primaryColor={primaryColor}
                  onClick={sendMagicLink}
                  disabled={isSendingMagicLink || !speakerEmail}
                  glow={true}
                  className="inline-flex cursor-pointer"
                >
                  {isSendingMagicLink ? (
                    <>
                      <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Sending...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Send magic link
                    </>
                  )}
                </PortalButton>
              </>
            )}
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
              href={`${basePath}/talks/edit?token=${editToken}`}
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
