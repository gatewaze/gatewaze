'use client'

import { useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { getExistingSessionId } from '@/lib/tracking'

interface UseCompetitionEntryReturn {
  enterCompetition: (email: string, competitionId: string) => Promise<{ success: boolean; message?: string; error?: string }>
  isEntering: boolean
  error: string | null
}

/**
 * Hook for entering competitions
 * Handles the edge function call with tracking session
 */
export function useCompetitionEntry(): UseCompetitionEntryReturn {
  const [isEntering, setIsEntering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enterCompetition = async (
    email: string,
    competitionId: string
  ): Promise<{ success: boolean; message?: string; error?: string }> => {
    setIsEntering(true)
    setError(null)

    try {
      const supabase = getSupabaseClient()

      // Get tracking session ID from cookie
      const trackingSessionId = getExistingSessionId()

      // Call the competition-entry edge function
      const { data, error: functionError } = await supabase.functions.invoke('competition-entry', {
        body: {
          email: email.toLowerCase().trim(),
          competition_id: competitionId,
          source: 'event_portal',
          metadata: {
            tracking_session_id: trackingSessionId || undefined,
          },
        },
      })

      if (functionError) {
        const errorMessage = functionError.message || 'Failed to enter competition'
        setError(errorMessage)
        return { success: false, error: errorMessage }
      }

      if (!data?.success) {
        const errorMessage = data?.error || 'Failed to enter competition'
        setError(errorMessage)
        return { success: false, error: errorMessage }
      }

      return {
        success: true,
        message: data.message || 'Successfully entered competition',
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred'
      setError(errorMessage)
      return { success: false, error: errorMessage }
    } finally {
      setIsEntering(false)
    }
  }

  return {
    enterCompetition,
    isEntering,
    error,
  }
}
