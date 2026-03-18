'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import { getClientBrandConfig, isLightColor } from '@/config/brand'
import { GlowInput } from '@/components/ui/GlowInput'
import { PortalButton } from '@/components/ui/PortalButton'
import { trackEvent } from '@/lib/analytics'
import { hasConsentFor } from '@/hooks/useConsent'
import { stripEmojis } from '@/lib/text'
import { useAuth } from '@/hooks/useAuth'

interface Props {
  event: Event
  brandConfig: BrandConfig
  onSuccess?: () => void
  onCancel?: () => void
  trackingSessionId?: string | null
  useDarkTheme?: boolean
  initialData?: {
    email?: string
    first_name?: string
    last_name?: string
    company?: string
    job_title?: string
  }
}

interface RegistrationResponse {
  success: boolean
  message?: string
  error?: string
  already_registered?: boolean
  registration_id?: string
}

interface FormData {
  email: string
  first_name: string
  last_name: string
  company: string
  job_title: string
}

interface FormErrors {
  email?: string
  first_name?: string
  last_name?: string
  company?: string
  job_title?: string
}

export function RegistrationForm({ event, brandConfig, onSuccess, onCancel, trackingSessionId, useDarkTheme = false, initialData }: Props) {
  // Use event's gradient color as primary if available
  const primaryColor = event.gradient_color_1 || brandConfig.primaryColor

  // Theme styles - matching SpeakerSubmissionForm glassmorphic style
  const theme = {
    containerBg: '',
    heading: 'text-white',
    subtext: 'text-white/70',
    requiredClass: 'text-[10px] font-semibold text-white/70 uppercase tracking-wide px-1.5 py-0.5 rounded ml-1.5',
    label: 'text-white',
    inputBg: useDarkTheme ? 'bg-black/40' : 'bg-white/60',
    inputText: 'text-gray-900',
    inputPlaceholder: 'placeholder-gray-500',
    inputBorder: useDarkTheme ? 'border-white/20' : 'border-white/30',
    errorBg: 'bg-red-500/20',
    errorBorder: 'border-red-400/50',
    errorText: 'text-red-300',
    errorInputBorder: 'border-red-400/50',
  }
  const [formData, setFormData] = useState<FormData>({
    email: initialData?.email || '',
    first_name: initialData?.first_name || '',
    last_name: initialData?.last_name || '',
    company: initialData?.company || '',
    job_title: initialData?.job_title || '',
  })
  const hasAppliedPrefill = useRef(!!initialData?.email)

  // Update form when initialData arrives asynchronously (only fill empty fields)
  useEffect(() => {
    if (!initialData?.email || hasAppliedPrefill.current) return
    hasAppliedPrefill.current = true
    setFormData(prev => ({
      email: prev.email || initialData.email || '',
      first_name: prev.first_name || initialData.first_name || '',
      last_name: prev.last_name || initialData.last_name || '',
      company: prev.company || initialData.company || '',
      job_title: prev.job_title || initialData.job_title || '',
    }))
  }, [initialData])

  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false)
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null)
  const { session } = useAuth()

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required'
    } else if (!validateEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address'
    }

    if (!formData.first_name.trim()) {
      newErrors.first_name = 'First name is required'
    }

    if (!formData.last_name.trim()) {
      newErrors.last_name = 'Last name is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    // Clear error when user starts typing
    if (errors[name as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [name]: undefined }))
    }
  }

  const sendMagicLink = useCallback(async () => {
    const email = formData.email.toLowerCase().trim()
    if (!email) return

    setIsSendingMagicLink(true)
    setMagicLinkError(null)

    try {
      const config = getClientBrandConfig()
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)

      // Redirect to the event details page (strip /register from current URL)
      const redirectUrl = typeof window !== 'undefined'
        ? window.location.href.replace(/\/register\/?$/, '')
        : undefined

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectUrl,
        },
      })

      if (error) {
        console.error('Magic link error:', error)
        setMagicLinkError('Failed to send sign-in link. Please try again.')
      } else {
        setMagicLinkSent(true)
      }
    } catch (err) {
      console.error('Magic link error:', err)
      setMagicLinkError('An unexpected error occurred. Please try again.')
    } finally {
      setIsSendingMagicLink(false)
    }
  }, [formData.email])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)

    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)

    try {
      const config = getClientBrandConfig()

      // Call the event-registration edge function
      const response = await fetch(`${config.supabaseUrl}/functions/v1/event-registration`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.supabaseAnonKey,
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          email: formData.email.toLowerCase().trim(),
          event_id: event.event_id,
          first_name: formData.first_name.trim(),
          last_name: formData.last_name.trim(),
          company: formData.company.trim() || undefined,
          job_title: formData.job_title.trim() || undefined,
          source: 'event_portal',
          metadata: {
            tracking_session_id: trackingSessionId || undefined,
          },
        }),
      })

      const result: RegistrationResponse = await response.json()

      if (!result.success) {
        console.error('Registration error:', result.error)
        if (result.error?.includes('already registered') || result.already_registered) {
          setSubmitError('You are already registered for this event. Check your email for confirmation details.')
        } else {
          setSubmitError(result.error || 'Registration failed. Please try again or contact support.')
        }
        return
      }

      // Success (including already_registered which returns success: true)
      setIsSuccess(true)
      onSuccess?.()
      window.dispatchEvent(new CustomEvent('registration-changed'))

      if (hasConsentFor('analytics')) {
        trackEvent('event_registered', {
          event_id: event.event_id,
          event_title: event.event_title,
          method: 'native_form',
        })
      }
    } catch (err) {
      console.error('Registration error:', err)
      setSubmitError('An unexpected error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Success state
  if (isSuccess) {
    return (
      <div className={`${theme.containerBg} text-center`}>
        <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" style={{ strokeDasharray: 24, strokeDashoffset: 24, animation: 'checkmark-draw 0.4s ease-out 0.2s forwards' }} />
          </svg>
        </div>
        <h2 className={`text-2xl font-bold ${theme.heading} mb-2 drop-shadow-md`}>You're registered!</h2>
        <p className="text-white/80 mb-4">
          Thank you for registering for <strong>{stripEmojis(event.event_title)}</strong>.
        </p>
        <p className={`${theme.subtext} text-sm`}>
          We've sent a confirmation email to <strong>{formData.email}</strong> with all the event details.
        </p>

        {/* Sign-in prompt — only show if user is not already signed in */}
        {!session && (
          <div className="mt-6 pt-6 border-t border-white/15">
            {magicLinkSent ? (
              <>
                <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className={`${theme.heading} font-semibold mb-1`}>Check your email</p>
                <p className={`${theme.subtext} text-sm mb-1`}>
                  We&apos;ve sent a sign-in link to <strong className="text-white">{formData.email}</strong>
                </p>
                <p className={`${theme.subtext} text-xs`}>
                  Click the link to sign in. It will expire in 1 hour.
                </p>
                <button
                  onClick={() => {
                    setMagicLinkSent(false)
                    setMagicLinkError(null)
                  }}
                  className="mt-3 text-xs text-white/50 hover:text-white/80 underline cursor-pointer transition-colors"
                >
                  Didn&apos;t receive it? Send again
                </button>
              </>
            ) : (
              <>
                <p className={`${theme.subtext} text-sm mb-3`}>
                  <strong className="text-white">Sign in to complete your registration</strong>
                  {' '}&mdash; manage your registration, add to calendar, and more.
                </p>

                {magicLinkError && (
                  <div className="mb-3 p-2 rounded-lg bg-red-500/20 border border-red-400/30 text-red-300 text-xs">
                    {magicLinkError}
                  </div>
                )}

                <button
                  onClick={sendMagicLink}
                  disabled={isSendingMagicLink}
                  className="inline-flex items-center px-5 py-2.5 text-sm font-medium text-white rounded-lg transition-all duration-200 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  style={{
                    backgroundColor: primaryColor,
                    boxShadow: `inset 0 0 0 1px rgba(255, 255, 255, 0.3)`,
                  }}
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
                      Send sign-in link
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={theme.containerBg}>
      <div>
        <h2 className={`text-2xl sm:text-3xl font-bold ${theme.heading} mb-6 drop-shadow-md`}>Register for this event</h2>

        {submitError && (
          <div className={`mb-4 p-3 ${theme.errorBg} border ${theme.errorBorder} rounded-lg ${theme.errorText} text-sm`}>
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div>
            <label htmlFor="email" className={`block text-base font-medium ${theme.label} mb-2`}>
              Email <span className={theme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
            </label>
            <GlowInput
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="you@example.com"
              glowColor={primaryColor}
              borderRadius="0.5rem"
              className={`w-full text-base px-4 py-2.5 border rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors ${
                errors.email
                  ? `${theme.errorInputBorder}`
                  : `${theme.inputBorder}`
              }`}
              disabled={isSubmitting}
            />
            {errors.email && <p className={`mt-1 text-sm ${theme.errorText}`}>{errors.email}</p>}
          </div>

          {/* Name row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="first_name" className={`block text-base font-medium ${theme.label} mb-2`}>
                First name <span className={theme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
              </label>
              <GlowInput
                type="text"
                id="first_name"
                name="first_name"
                value={formData.first_name}
                onChange={handleChange}
                glowColor={primaryColor}
                borderRadius="0.5rem"
                className={`w-full text-base px-4 py-2.5 border rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors ${
                  errors.first_name
                    ? `${theme.errorInputBorder}`
                    : `${theme.inputBorder}`
                }`}
                disabled={isSubmitting}
              />
              {errors.first_name && <p className={`mt-1 text-sm ${theme.errorText}`}>{errors.first_name}</p>}
            </div>

            <div>
              <label htmlFor="last_name" className={`block text-base font-medium ${theme.label} mb-2`}>
                Last name <span className={theme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
              </label>
              <GlowInput
                type="text"
                id="last_name"
                name="last_name"
                value={formData.last_name}
                onChange={handleChange}
                glowColor={primaryColor}
                borderRadius="0.5rem"
                className={`w-full text-base px-4 py-2.5 border rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors ${
                  errors.last_name
                    ? `${theme.errorInputBorder}`
                    : `${theme.inputBorder}`
                }`}
                disabled={isSubmitting}
              />
              {errors.last_name && <p className={`mt-1 text-sm ${theme.errorText}`}>{errors.last_name}</p>}
            </div>
          </div>

          {/* Company & Job Title row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="company" className={`block text-base font-medium ${theme.label} mb-2`}>
                Company
              </label>
              <GlowInput
                type="text"
                id="company"
                name="company"
                value={formData.company}
                onChange={handleChange}
                glowColor={primaryColor}
                borderRadius="0.5rem"
                className={`w-full text-base px-4 py-2.5 border ${theme.inputBorder} rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors`}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label htmlFor="job_title" className={`block text-base font-medium ${theme.label} mb-2`}>
                Job title
              </label>
              <GlowInput
                type="text"
                id="job_title"
                name="job_title"
                value={formData.job_title}
                onChange={handleChange}
                glowColor={primaryColor}
                borderRadius="0.5rem"
                className={`w-full text-base px-4 py-2.5 border ${theme.inputBorder} rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors`}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Submit buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <PortalButton
              variant="primary"
              primaryColor={primaryColor}
              type="submit"
              disabled={isSubmitting}
              isLoading={isSubmitting}
              glow
              className="w-full"
            >
              {isSubmitting ? 'Registering...' : (event.register_button_text || 'Register now')}
            </PortalButton>
            {onCancel && (
              <PortalButton
                variant="secondary"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancel
              </PortalButton>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
