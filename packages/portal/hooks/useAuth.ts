'use client'

import { useEffect, useState, useCallback } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase/client'
import { getClientBrandConfig } from '@/config/brand'

interface AuthState {
  user: User | null
  session: Session | null
  isLoading: boolean
  error: Error | null
}

interface UseAuthReturn extends AuthState {
  signInWithMagicLink: (email: string, redirectTo?: string) => Promise<{ success: boolean; error?: string }>
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
}

/**
 * Hook for managing authentication state in the event portal
 * Supports magic link authentication for members
 */
export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    isLoading: true,
    error: null,
  })

  const supabase = getSupabaseClient()

  // Initialize auth state
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      setState({
        user: session?.user ?? null,
        session: session ?? null,
        isLoading: false,
        error: error ? new Error(error.message) : null,
      })
    })

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((prev) => ({
        ...prev,
        user: session?.user ?? null,
        session: session ?? null,
        isLoading: false,
      }))
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  /**
   * Send a magic link to the user's email
   * @param email - The user's email address
   * @param redirectTo - Optional URL to redirect to after sign in (defaults to /auth/callback)
   */
  const signInWithMagicLink = useCallback(
    async (email: string, redirectTo?: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const brandConfig = getClientBrandConfig()
        // Prefer window.location.origin so magic links redirect back to the current domain
        // (critical for custom domain support where origin differs from NEXT_PUBLIC_APP_URL)
        const baseUrl = (typeof window !== 'undefined' ? window.location.origin : null)
          || process.env.NEXT_PUBLIC_APP_URL
          || `https://${brandConfig.domain}`
        const callbackUrl = `${baseUrl}/sign-in${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ''}`

        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: callbackUrl,
          },
        })

        if (error) {
          return { success: false, error: error.message }
        }

        return { success: true }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred'
        return { success: false, error: errorMessage }
      }
    },
    [supabase]
  )

  /**
   * Sign out the current user
   */
  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setState({
      user: null,
      session: null,
      isLoading: false,
      error: null,
    })
  }, [supabase])

  /**
   * Refresh the current session
   */
  const refreshSession = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }))
    const { data: { session }, error } = await supabase.auth.refreshSession()
    setState({
      user: session?.user ?? null,
      session: session ?? null,
      isLoading: false,
      error: error ? new Error(error.message) : null,
    })
  }, [supabase])

  return {
    ...state,
    signInWithMagicLink,
    signOut,
    refreshSession,
  }
}
