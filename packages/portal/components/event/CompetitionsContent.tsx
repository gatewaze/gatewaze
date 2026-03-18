'use client'

import { useState, useEffect, useMemo } from 'react'
import { useEventContext } from './EventContext'
import { useAuth } from '@/hooks/useAuth'
import { useCountdown } from '@/hooks/useCountdown'
import { useCompetitionEntry } from '@/hooks/useCompetitionEntry'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { isLightColor } from '@/config/brand'
import { getSupabaseClient } from '@/lib/supabase/client'
import type { EventCompetition } from '@/types/event'
import DOMPurify from 'isomorphic-dompurify'

interface CompetitionWithEntry extends EventCompetition {
  hasEntered?: boolean
}

function CompetitionCard({ competition, index }: { competition: CompetitionWithEntry; index: number }) {
  const { useDarkText, primaryColor, theme } = useEventContext()
  const { session } = useAuth()
  const { enterCompetition, isEntering, error } = useCompetitionEntry()
  const timeLeft = useCountdown(competition.close_date)

  const [email, setEmail] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)
  const [hasEntered, setHasEntered] = useState(competition.hasEntered || false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  // Prefill email from sessionStorage on mount
  useEffect(() => {
    const prefillEmail = sessionStorage.getItem('prefill_email')
    if (prefillEmail && !session) {
      setEmail(prefillEmail)
    }
  }, [session])

  const panelTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    textColor: useDarkText ? 'text-gray-900' : 'text-white',
    textMuted: useDarkText ? 'text-gray-600' : 'text-white/70',
    textDimmed: useDarkText ? 'text-gray-500' : 'text-white/50',
    cardBg: useDarkText ? 'bg-gray-900/10' : 'bg-white/10',
    inputBg: useDarkText ? 'bg-white/50' : 'bg-white/10',
    inputBorder: useDarkText ? 'border-gray-600' : 'border-white/20',
    inputFocus: useDarkText ? 'focus:border-gray-900' : 'focus:border-white/40',
  }), [useDarkText])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const entryEmail = session?.user?.email || email.trim()
    if (!entryEmail) return

    const result = await enterCompetition(entryEmail, competition.id)

    if (result.success) {
      setShowSuccess(true)
      setHasEntered(true)

      // If user is not authenticated, automatically send magic link
      if (!session) {
        try {
          const supabase = getSupabaseClient()
          const { error: magicLinkError } = await supabase.auth.signInWithOtp({
            email: entryEmail,
            options: {
              emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
            },
          })

          if (!magicLinkError) {
            setMagicLinkSent(true)
          }
        } catch (err) {
          console.error('Error sending magic link:', err)
        }
      }
    }
  }

  const sanitizedContent = competition.content
    ? DOMPurify.sanitize(competition.content, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'h3', 'h4'],
        ALLOWED_ATTR: ['href', 'target', 'rel']
      })
    : null

  const isClosed = timeLeft.isExpired

  return (
    <div
      className="transition-opacity duration-300 ease-out space-y-5"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* Prize hero banner */}
      <div
        className="rounded-2xl p-5 sm:p-6 flex items-center gap-4"
        style={{
          backgroundColor: `${primaryColor}1A`,
          border: `1px solid ${primaryColor}4D`,
        }}
      >
        <div className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-3.77 1.522m0 0a6.003 6.003 0 01-3.77-1.522" />
          </svg>
        </div>
        <div>
          {competition.value && (
            <p className="text-3xl sm:text-4xl font-extrabold drop-shadow-md" style={{ color: primaryColor }}>
              Win {competition.value}
            </p>
          )}
          <h2 className={`text-lg sm:text-xl font-semibold ${panelTheme.textColor} mt-1`}>
            {competition.title}
          </h2>
        </div>
      </div>

      {/* Countdown Timer — own glass panel */}
      {!isClosed && competition.close_date && (
        <GlowBorder borderRadius="1rem" useDarkTheme={useDarkText} autoRotate autoRotateSpeed={20}>
          <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-5 sm:p-6`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: primaryColor }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: primaryColor }} />
              </span>
              <p className={`text-xs uppercase tracking-wider font-semibold ${panelTheme.textMuted}`}>
                Entries close {competition.close_display || 'soon'}
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:gap-3">
              {[
                { value: timeLeft.days, label: 'days' },
                { value: timeLeft.hours, label: 'hrs' },
                { value: timeLeft.minutes, label: 'min' },
                { value: timeLeft.seconds, label: 'sec' },
              ].map(({ value, label }) => (
                <div
                  key={label}
                  className={`text-center rounded-xl py-3 ${useDarkText ? 'bg-gray-900/10' : 'bg-white/10'}`}
                >
                  <div className={`text-2xl sm:text-3xl font-bold tabular-nums ${panelTheme.textColor}`}>
                    {value.toString().padStart(2, '0')}
                  </div>
                  <div className={`text-[10px] uppercase tracking-wider ${panelTheme.textMuted}`}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </GlowBorder>
      )}

      {isClosed && (
        <GlowBorder borderRadius="1rem" useDarkTheme={useDarkText}>
          <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-5 sm:p-6 text-center`}>
            <p className={`text-sm font-medium ${panelTheme.textMuted}`}>
              This competition has ended
            </p>
          </div>
        </GlowBorder>
      )}

      {/* Entry Form / Success State — own glass panel */}
      {!isClosed && (
        <GlowBorder borderRadius="1rem" useDarkTheme={useDarkText}>
          <div
            className={`backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-5 sm:p-6`}
            style={{ backgroundColor: `${primaryColor}12` }}
          >
            {hasEntered ? (
              <div className="text-center py-2">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className={`text-lg font-bold ${panelTheme.textColor}`}>
                    {session ? "You're entered!" : "Entry received!"}
                  </p>
                </div>
                {!session && magicLinkSent ? (
                  <div className="space-y-3">
                    <div className={`p-4 rounded-lg ${panelTheme.cardBg}`} style={{ border: `1px solid ${primaryColor}40` }}>
                      <p className={`text-sm font-semibold ${panelTheme.textColor} mb-2`}>
                        Check your email to complete your entry
                      </p>
                      <p className={`text-sm ${panelTheme.textMuted}`}>
                        You'll need to sign in and share your details so we can contact you if you win.
                      </p>
                    </div>
                  </div>
                ) : session ? (
                  <p className={`text-sm ${panelTheme.textMuted}`}>
                    Good luck! We'll notify you if you win.
                  </p>
                ) : null}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                {!session && (
                  <div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      required
                      className={`w-full px-4 py-2.5 rounded-lg ${panelTheme.inputBg} backdrop-blur-sm border ${panelTheme.inputBorder} ${panelTheme.inputFocus} ${panelTheme.textColor} placeholder-current placeholder-opacity-50 outline-none transition-all`}
                    />
                  </div>
                )}

                {error && (
                  <div className="p-3 rounded-lg bg-red-500/20 border border-red-400/30">
                    <p className={`text-xs ${panelTheme.textColor}`}>{error}</p>
                  </div>
                )}

                {showSuccess && (
                  <div className="p-3 rounded-lg animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ backgroundColor: `${primaryColor}33`, border: `1px solid ${primaryColor}80` }}>
                    <p className={`text-xs font-medium text-center text-white`}>
                      Successfully entered!
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isEntering || (!session && !email.trim())}
                  className="w-full px-6 py-3 rounded-lg font-semibold transition-all duration-200 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-lg"
                  style={{
                    backgroundColor: primaryColor,
                    color: isLightColor(primaryColor) ? '#000000' : '#ffffff',
                    boxShadow: `0 4px 14px 0 ${primaryColor}40`,
                  }}
                >
                  {isEntering ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Entering...
                    </span>
                  ) : (
                    'Enter competition'
                  )}
                </button>

                {!session && (
                  <p className={`text-xs text-center ${panelTheme.textMuted}`}>
                    You'll receive an email to complete your entry
                  </p>
                )}
              </form>
            )}
          </div>
        </GlowBorder>
      )}

      {/* Intro — outside glass panel */}
      {competition.intro && (
        <p className={`text-sm ${panelTheme.textMuted}`}>
          {competition.intro}
        </p>
      )}

      {/* Rich Content — outside glass panel */}
      {sanitizedContent && (
        <div
          className={`prose prose-sm max-w-none ${useDarkText ? 'prose-gray' : 'prose-invert'}`}
          style={{ color: theme.textMutedColor }}
          dangerouslySetInnerHTML={{ __html: sanitizedContent }}
        />
      )}
    </div>
  )
}

export function CompetitionsContent() {
  const { event, useDarkText, primaryColor, theme } = useEventContext()
  const { session } = useAuth()
  const [competitions, setCompetitions] = useState<CompetitionWithEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    async function fetchCompetitions() {
      const supabase = getSupabaseClient()
      const { data } = await supabase
        .from('event_competitions')
        .select('*')
        .eq('event_id', event.event_id)
        .eq('status', 'active')
        .order('sort_order', { ascending: true })

      // Check if user has entered each competition
      let competitionsWithStatus = data || []
      if (session?.user?.email) {
        const { data: entries } = await supabase
          .from('competition_entries')
          .select('competition_id')
          .eq('email', session.user.email.toLowerCase())
          .in('competition_id', competitionsWithStatus.map(c => c.id))

        const enteredIds = new Set(entries?.map(e => e.competition_id) || [])
        competitionsWithStatus = competitionsWithStatus.map(c => ({
          ...c,
          hasEntered: enteredIds.has(c.id)
        }))
      }

      setCompetitions(competitionsWithStatus)
      setIsLoading(false)
    }
    fetchCompetitions()
  }, [event.event_id, session])

  const panelTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    textColor: useDarkText ? 'text-gray-900' : 'text-white',
    textMuted: useDarkText ? 'text-gray-600' : 'text-white/70',
    cardBg: useDarkText ? 'bg-gray-900/10' : 'bg-white/10',
  }), [useDarkText])

  return (
    <div className={`transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      {/* Loading state */}
      <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
        isLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}>
        <div
          className="loader"
          style={{ '--primary-color': '#fff', '--secondary-color': primaryColor } as React.CSSProperties}
        />
      </div>

      {/* Content */}
      <div className={`transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
        {competitions.length === 0 && !isLoading ? (
          <GlowBorder borderRadius="1rem" useDarkTheme={useDarkText}>
            <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-8`}>
              <div className="text-center py-4">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${panelTheme.cardBg}`}>
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: theme.textMutedColor }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172" />
                  </svg>
                </div>
                <h2 className={`text-xl font-semibold ${panelTheme.textColor} mb-2`}>No active competitions</h2>
                <p className={panelTheme.textMuted}>
                  Check back later for competition announcements.
                </p>
              </div>
            </div>
          </GlowBorder>
        ) : (
          <div className="space-y-4">
            {competitions.map((comp, index) => (
              <CompetitionCard key={comp.id} competition={comp} index={index} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
