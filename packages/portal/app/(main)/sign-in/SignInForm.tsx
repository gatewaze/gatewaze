'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import type { BrandConfig } from '@/config/brand'
import { getClientBrandConfig } from '@/config/brand'
import { getEmailFromParams } from '@/lib/emailEncoding'
import { GlowInput } from '@/components/ui/GlowInput'
import { PortalButton } from '@/components/ui/PortalButton'

interface Props {
  brandConfig: BrandConfig
}

export function SignInForm({ brandConfig }: Props) {
  const { signInWithMagicLink, user, isLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') || '/'

  // Pre-fill email from URL params (email=, utm_medium=, e=) or sessionStorage
  const prefillEmail = getEmailFromParams(searchParams)
  const [email, setEmail] = useState(() => {
    if (prefillEmail) return prefillEmail
    try {
      return sessionStorage.getItem('prefill_email') || ''
    } catch {
      return ''
    }
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  // Detect hash tokens immediately to avoid flashing the sign-in form
  const [isProcessingToken, setIsProcessingToken] = useState(
    () => typeof window !== 'undefined' && window.location.hash.includes('access_token')
  )

  const primaryColor = brandConfig.primaryColor

  // Handle implicit flow redirect (when token is in URL hash)
  useEffect(() => {
    if (!isProcessingToken) return

    const hash = window.location.hash
    const params = new URLSearchParams(hash.substring(1))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    if (accessToken && refreshToken) {
      // Prefer redirectTo from URL query param, fall back to localStorage
      const destination = redirectTo !== '/'
        ? redirectTo
        : localStorage.getItem('auth_redirect_to') || '/'
      localStorage.removeItem('auth_redirect_to')

      import('@/lib/supabase/client').then(({ getSupabaseClient }) => {
        const supabase = getSupabaseClient()
        supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        }).then(() => {
          window.history.replaceState(null, '', window.location.pathname)
          router.push(destination)
        })
      })
    } else {
      setIsProcessingToken(false)
    }
  }, [isProcessingToken, redirectTo, router])

  // Redirect if already signed in
  useEffect(() => {
    if (!isLoading && user) {
      router.push(redirectTo)
    }
  }, [user, isLoading, router, redirectTo])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail) {
      setError('Please enter your email address')
      setIsSubmitting(false)
      return
    }

    try {
      // Step 1: Call people-signup to create auth user + person record
      const config = getClientBrandConfig()
      const signupResponse = await fetch(`${config.supabaseUrl}/functions/v1/people-signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.supabaseAnonKey,
        },
        body: JSON.stringify({
          email: trimmedEmail,
          source: 'event_portal_signin',
          app: 'portal',
        }),
      })

      if (!signupResponse.ok) {
        const errorText = await signupResponse.text()
        // User likely already exists - this is expected, continue to magic link
        console.log('User signup skipped:', errorText)
      } else {
        const signupData = await signupResponse.json()
        console.log('User signup result:', signupData)
      }

      // Step 2: Send magic link for authentication
      // Store redirectTo in localStorage - Supabase will redirect to its Site URL,
      // and our implicit flow handler will read this to redirect to the correct page
      localStorage.setItem('auth_redirect_to', redirectTo)

      const result = await signInWithMagicLink(trimmedEmail, redirectTo)

      if (result.success) {
        setSuccess(true)
      } else {
        setError(result.error || 'Failed to send sign-in link')
      }
    } catch (err) {
      console.error('Sign-in error:', err)
      setError('An unexpected error occurred. Please try again.')
    }

    setIsSubmitting(false)
  }

  // Show loading while checking auth state or processing token
  if (isLoading || isProcessingToken) {
    return (
      <div className="flex justify-center py-8">
        <div
          className="loader"
          style={{
            '--primary-color': '#fff',
            '--secondary-color': primaryColor,
          } as React.CSSProperties}
        />
      </div>
    )
  }

  // Success state
  if (success) {
    return (
      <div className="text-center py-4">
        <div
          className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center animate-[scale-in_0.3s_ease-out]"
          style={{ backgroundColor: primaryColor }}
        >
          <svg
            className="w-10 h-10 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            {/* Envelope body */}
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              style={{
                strokeDasharray: 80,
                strokeDashoffset: 0,
                animation: 'draw-envelope 0.6s ease-out 0.2s backwards',
              }}
            />
          </svg>
        </div>
        <style jsx>{`
          @keyframes draw-envelope {
            from {
              stroke-dashoffset: 80;
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
        <h2 className="text-xl font-semibold text-white mb-2">Check your email</h2>
        <p className="text-white/90 mb-4">
          We've sent a sign-in link to <strong className="text-white">{email}</strong>
        </p>
        <p className="text-white/70 text-sm">
          Click the link in the email to sign in.
          <br />
          The link will expire in 24 hours.
        </p>
        <PortalButton
          variant="secondary"
          size="small"
          onClick={() => {
            setSuccess(false)
            setEmail('')
          }}
          className="mt-6"
        >
          Use a different email
        </PortalButton>
      </div>
    )
  }

  return (
    <>
      {/* Logo and header - shown only in form state */}
      <div className="text-center mb-8">
        {brandConfig.logoIconUrl ? (
          <img
            src={brandConfig.logoIconUrl}
            alt={brandConfig.name}
            className="w-12 h-12 mx-auto mb-4"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center text-white font-bold text-xl" style={{ backgroundColor: brandConfig.primaryColor }}>
            {brandConfig.name.charAt(0)}
          </div>
        )}
        <h1 className="text-2xl font-semibold text-white">Sign in</h1>
        <p className="text-white/70 mt-2 text-sm sm:text-base whitespace-nowrap">
          Enter your email to receive a magic link
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-white mb-2">
            Email Address
          </label>
        <GlowInput
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          glowColor={primaryColor}
          borderRadius="0.5rem"
          className="w-full text-sm px-4 py-2.5 border border-white/30 rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"
          disabled={isSubmitting}
          autoComplete="email"
          autoFocus
        />
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/20 border border-red-400/50">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      <PortalButton
        variant="primary"
        primaryColor={primaryColor}
        type="submit"
        disabled={isSubmitting}
        isLoading={isSubmitting}
        glow
        className="w-full"
      >
        {isSubmitting ? 'Sending...' : 'Send magic link'}
      </PortalButton>

    </form>
    </>
  )
}
