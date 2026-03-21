'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { useConsent } from '@/hooks/useConsent'
import { useTrackingCapture } from '@/hooks/useTrackingCapture'
import { useAuth } from '@/hooks/useAuth'
import { useEmailPrefill } from '@/hooks/useEmailPrefill'
import { markSessionRedirected, createTrackingSession, captureTrackingParams } from '@/lib/tracking'
import { CLICK_ID_PARAMS } from '@/config/platforms'
import { getClientBrandConfig, isLightColor } from '@/config/brand'
import { stripEmojis } from '@/lib/text'
import { createClient } from '@supabase/supabase-js'
import { useEventContext } from './EventContext'
import { RegistrationForm } from './RegistrationForm'
import { GlowBorder } from '@/components/ui/GlowBorder'

type AutoRegState = 'checking' | 'registering' | 'done' | 'none'

interface PersonData {
  email?: string
  first_name?: string
  last_name?: string
}

export function RegisterContent() {
  const { event, brandConfig, useDarkText, primaryColor, userState, eventIdentifier } = useEventContext()
  const { categories } = useConsent()
  const { user, session: authSession, isLoading: authLoading } = useAuth()
  const { prefillProfile } = useEmailPrefill(eventIdentifier)
  const [showNativeForm, setShowNativeForm] = useState(event.enable_native_registration ?? false)
  const [autoRegState, setAutoRegState] = useState<AutoRegState>('checking')
  const [autoRegEmail, setAutoRegEmail] = useState<string>('')
  const [personData, setPersonData] = useState<PersonData | null>(null)
  const autoRegAttempted = useRef(false)

  const panelTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    textColor: useDarkText ? 'text-gray-900' : 'text-white',
    textMuted: useDarkText ? 'text-gray-600' : 'text-white/70',
  }), [useDarkText])

  // Capture tracking if marketing consent given
  const { session } = useTrackingCapture({
    eventId: event.event_id,
    hasConsent: categories.marketing,
  })

  // Auto-registration for logged-in users with complete profiles
  useEffect(() => {
    if (authLoading || autoRegAttempted.current) return
    if (!event.enable_native_registration || !event.enable_registration) {
      setAutoRegState('none')
      return
    }
    if (!user || !authSession) {
      setAutoRegState('none')
      return
    }

    autoRegAttempted.current = true

    const attemptAutoReg = async () => {
      try {
        const config = getClientBrandConfig()
        const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${authSession.access_token}` } },
        })

        // Fetch person profile
        const { data: person } = await supabase
          .from('people')
          .select('email, attributes')
          .eq('auth_user_id', user.id)
          .maybeSingle()

        if (!person) {
          setAutoRegState('none')
          return
        }

        const attrs = (person.attributes as Record<string, string>) || {}
        const email = person.email || user.email || ''
        const firstName = attrs.first_name || ''
        const lastName = attrs.last_name || ''

        // Store person data for form pre-fill fallback
        setPersonData({ email, first_name: firstName, last_name: lastName })

        if (!email || !firstName || !lastName) {
          // Missing required fields — fall back to form (pre-filled)
          setAutoRegState('none')
          return
        }

        // All required data present — auto-register
        setAutoRegState('registering')
        setAutoRegEmail(email)

        const response = await fetch(`${config.supabaseUrl}/functions/v1/event-registration`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': config.supabaseAnonKey,
            'Authorization': `Bearer ${config.supabaseAnonKey}`,
          },
          body: JSON.stringify({
            email: email.toLowerCase().trim(),
            event_id: event.event_id,
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            company: attrs.company?.trim() || undefined,
            job_title: attrs.job_title?.trim() || undefined,
            source: 'event_portal',
            metadata: {
              tracking_session_id: session?.sessionId || undefined,
              auto_registered: true,
            },
          }),
        })

        const result = await response.json()

        if (result.success) {
          setAutoRegState('done')
          window.dispatchEvent(new CustomEvent('registration-changed'))
        } else {
          // Registration failed — fall back to form
          setAutoRegState('none')
        }
      } catch {
        setAutoRegState('none')
      }
    }

    attemptAutoReg()
  }, [authLoading, user, authSession, event.enable_native_registration, event.enable_registration, event.event_id, session?.sessionId])

  // Handle register button click (for external registration)
  const handleExternalRegister = async () => {
    if (!event.event_link) return

    // Read stored tracking params from sessionStorage
    let storedParams: { clickIds: Record<string, string>; utmParams: Record<string, string> } | null = null
    try {
      const raw = sessionStorage.getItem('tracking_params')
      if (raw) storedParams = JSON.parse(raw)
    } catch { /* ignore */ }

    // Use existing tracking session, or create one from stored params
    let sessionId: string | null = session?.sessionId || null
    if (!sessionId && storedParams && categories.marketing) {
      const searchParams = new URLSearchParams()
      for (const [k, v] of Object.entries(storedParams.clickIds)) searchParams.set(k, v)
      for (const [k, v] of Object.entries(storedParams.utmParams)) searchParams.set(k, v)
      const trackingParams = captureTrackingParams(searchParams)
      const newSession = await createTrackingSession({
        eventId: event.event_id,
        trackingParams,
        hasConsent: true,
      })
      if (newSession) sessionId = newSession.sessionId
    }

    // Mark session as redirected
    if (sessionId) {
      await markSessionRedirected(sessionId)
    }

    // Build redirect URL with tracking params encoded
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
  }

  // Handle successful native registration
  const handleRegistrationSuccess = () => {
    // Form shows its own success state
  }

  // Past event — registration no longer available
  if (userState.timeline === 'past') {
    return (
      <GlowBorder useDarkTheme={useDarkText}>
        <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
          <div className="text-center py-8">
            <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${useDarkText ? 'bg-gray-900/10' : 'bg-white/20'}`}>
              <svg className={`w-8 h-8 ${panelTheme.textMuted}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className={`text-xl font-semibold ${panelTheme.textColor} mb-2`}>
              This event has ended
            </h2>
            <p className={panelTheme.textMuted}>
              Registration is no longer available for this event.
            </p>
          </div>
        </div>
      </GlowBorder>
    )
  }

  // Already registered — show confirmation
  if (!userState.isLoading && userState.isRegistered && autoRegState !== 'done') {
    return (
      <GlowBorder useDarkTheme={useDarkText}>
        <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" style={{ strokeDasharray: 24, strokeDashoffset: 24, animation: 'checkmark-draw 0.4s ease-out 0.2s forwards' }} />
              </svg>
            </div>
            <h2 className={`text-2xl font-bold ${panelTheme.textColor} mb-2`}>You're registered</h2>
            <p className="text-white/80 mb-4">
              You're already registered for <strong>{stripEmojis(event.event_title)}</strong>.
            </p>
            <p className={`${panelTheme.textMuted} text-sm`}>
              We look forward to seeing you at the event.
            </p>
          </div>
        </div>
      </GlowBorder>
    )
  }

  // Auto-registration loading state
  if (event.enable_native_registration && event.enable_registration && (autoRegState === 'checking' || autoRegState === 'registering')) {
    return (
      <GlowBorder useDarkTheme={useDarkText}>
        <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
          <div className="text-center py-8">
            <div
              className="loader mx-auto"
              style={{
                '--primary-color': '#fff',
                '--secondary-color': primaryColor,
              } as React.CSSProperties}
            />
            <p className={`mt-4 ${panelTheme.textMuted}`}>
              {autoRegState === 'registering' ? 'Registering you...' : 'Checking your details...'}
            </p>
          </div>
        </div>
      </GlowBorder>
    )
  }

  // Auto-registration success state
  if (autoRegState === 'done') {
    return (
      <GlowBorder useDarkTheme={useDarkText}>
        <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
              <svg className="w-8 h-8 animate-[checkmark_0.4s_ease-out_forwards]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" style={{ strokeDasharray: 24, strokeDashoffset: 24, animation: 'checkmark-draw 0.4s ease-out 0.2s forwards' }} />
              </svg>
            </div>
            <h2 className={`text-2xl font-bold ${panelTheme.textColor} mb-2`}>You're registered!</h2>
            <p className="text-white/80 mb-4">
              Thank you for registering for <strong>{stripEmojis(event.event_title)}</strong>.
            </p>
            <p className={`${panelTheme.textMuted} text-sm`}>
              We've sent a confirmation email to <strong>{autoRegEmail}</strong> with all the event details.
            </p>
          </div>
        </div>
      </GlowBorder>
    )
  }

  if (!event.enable_registration) {
    return (
      <GlowBorder useDarkTheme={useDarkText}>
        <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
          <div className="text-center py-8">
            <svg
              className={`w-16 h-16 mx-auto mb-4 ${panelTheme.textMuted}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <h2 className={`text-xl font-semibold ${panelTheme.textColor} mb-2`}>
              Registration closed
            </h2>
            <p className={panelTheme.textMuted}>
              Registration for this event is currently closed.
            </p>
            <p className={`${panelTheme.textMuted} text-sm mt-2`}>
              Check back later or contact the organizer for more information.
            </p>
          </div>
        </div>
      </GlowBorder>
    )
  }

  // Native registration form
  if (event.enable_native_registration && showNativeForm) {
    return (
      <GlowBorder useDarkTheme={useDarkText}>
        <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
          <RegistrationForm
            event={event}
            brandConfig={brandConfig}
            onSuccess={handleRegistrationSuccess}
            onCancel={() => setShowNativeForm(false)}
            trackingSessionId={session?.sessionId}
            useDarkTheme={useDarkText}
            initialData={personData || prefillProfile || undefined}
          />
        </div>
      </GlowBorder>
    )
  }

  // External registration link
  return (
    <GlowBorder useDarkTheme={useDarkText}>
      <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
        <div className="text-center">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: `${primaryColor}30` }}
          >
            <svg
              className="w-8 h-8"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              style={{ color: primaryColor }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
              />
            </svg>
          </div>

          <h2 className={`text-xl font-semibold ${panelTheme.textColor} mb-2`}>
            Register for {stripEmojis(event.event_title)}
          </h2>

          <p className={`${panelTheme.textMuted} mb-6`}>
            {event.luma_event_id
              ? "Click below to complete your registration on Luma."
              : "Click below to complete your registration."}
          </p>

          {event.enable_native_registration ? (
            <button
              onClick={() => setShowNativeForm(true)}
              className="w-full px-8 py-4 text-lg font-semibold text-white rounded-xl hover:shadow-lg hover:brightness-110 transition-all duration-200 transform hover:scale-[1.02] cursor-pointer"
              style={{
                backgroundColor: primaryColor,
                boxShadow: `inset 0 0 0 1px rgba(255, 255, 255, 0.5), 0 10px 15px -3px rgba(0, 0, 0, 0.1)`,
              }}
            >
              {event.register_button_text || 'Register now'}
            </button>
          ) : event.event_link ? (
            <button
              onClick={handleExternalRegister}
              className="w-full px-8 py-4 text-lg font-semibold text-white rounded-xl hover:shadow-lg hover:brightness-110 transition-all duration-200 transform hover:scale-[1.02] cursor-pointer"
              style={{
                backgroundColor: primaryColor,
                boxShadow: `inset 0 0 0 1px rgba(255, 255, 255, 0.5), 0 10px 15px -3px rgba(0, 0, 0, 0.1)`,
              }}
            >
              Continue to registration
            </button>
          ) : (
            <p className={panelTheme.textMuted}>
              Registration link not available.
            </p>
          )}

          <p className={`text-xs ${panelTheme.textMuted} mt-4`}>
            By registering, you agree to the event terms and conditions.
          </p>
        </div>
      </div>
    </GlowBorder>
  )
}
