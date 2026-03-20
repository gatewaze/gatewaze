'use client'

import { useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { getClientBrandConfig } from '@/config/brand'

interface CheckCodeResult {
  has_code: boolean
  code: string | null
}

interface IssueCodeResult {
  success: boolean
  code: string | null
  message: string
  sold_out?: boolean
}

interface UseDiscountCodeReturn {
  claimCode: (email: string, eventId: string) => Promise<IssueCodeResult>
  claimLumaCode: (email: string, discountId: string) => Promise<IssueCodeResult>
  checkExistingCode: (email: string, eventId: string) => Promise<CheckCodeResult>
  getAvailableCount: (eventId: string) => Promise<number>
  isClaiming: boolean
  error: string | null
}

/**
 * Hook for discount code claiming
 * Uses the existing RPC functions: check_user_existing_code, issue_code_to_user, get_available_codes_count
 */
export function useDiscountCode(): UseDiscountCodeReturn {
  const [isClaiming, setIsClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkExistingCode = async (email: string, eventId: string): Promise<CheckCodeResult> => {
    const supabase = getSupabaseClient()

    try {
      const { data, error: rpcError } = await supabase.rpc('events_check_user_existing_code', {
        p_user_email: email.toLowerCase().trim(),
        p_event_id: eventId,
      })

      if (rpcError) {
        console.error('Error checking existing code:', rpcError)
        return { has_code: false, code: null }
      }

      return data?.[0] || { has_code: false, code: null }
    } catch (err) {
      console.error('Error in checkExistingCode:', err)
      return { has_code: false, code: null }
    }
  }

  const getAvailableCount = async (eventId: string): Promise<number> => {
    const supabase = getSupabaseClient()

    try {
      const { data, error: rpcError } = await supabase.rpc('events_get_available_codes_count', {
        p_event_id: eventId,
      })

      if (rpcError) {
        console.error('Error getting available count:', rpcError)
        return 0
      }

      return data || 0
    } catch (err) {
      console.error('Error in getAvailableCount:', err)
      return 0
    }
  }

  const claimCode = async (email: string, eventId: string): Promise<IssueCodeResult> => {
    setIsClaiming(true)
    setError(null)

    const supabase = getSupabaseClient()

    try {
      const normalizedEmail = email.toLowerCase().trim()

      // First check if user already has a code
      const existing = await checkExistingCode(normalizedEmail, eventId)
      if (existing.has_code && existing.code) {
        setIsClaiming(false)
        return {
          success: true,
          code: existing.code,
          message: 'Code already issued',
        }
      }

      // Check if codes are available
      const availableCount = await getAvailableCount(eventId)
      if (availableCount === 0) {
        setIsClaiming(false)
        setError('No discount codes available')
        return {
          success: false,
          code: null,
          message: 'Sold out',
        }
      }

      // Issue code atomically
      const { data, error: rpcError } = await supabase.rpc('events_issue_code_to_user', {
        p_user_email: normalizedEmail,
        p_event_id: eventId,
      })

      if (rpcError) {
        console.error('Error issuing code:', rpcError)
        setError(rpcError.message || 'Failed to issue code')
        setIsClaiming(false)
        return {
          success: false,
          code: null,
          message: rpcError.message || 'Error issuing code',
        }
      }

      setIsClaiming(false)

      return data || {
        success: false,
        code: null,
        message: 'Unknown error',
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.error('Error in claimCode:', err)
      setError(errorMessage)
      setIsClaiming(false)
      return {
        success: false,
        code: null,
        message: errorMessage,
      }
    }
  }

  const claimLumaCode = async (email: string, discountId: string): Promise<IssueCodeResult> => {
    setIsClaiming(true)
    setError(null)

    try {
      const normalizedEmail = email.toLowerCase().trim()
      const config = getClientBrandConfig()
      const edgeFunctionUrl = `${config.supabaseUrl}/functions/v1/issue-luma-discount-code`

      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, discount_id: discountId }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        const message = data.error || 'Failed to issue code'
        setError(message)
        setIsClaiming(false)
        return { success: false, code: null, message, sold_out: data.sold_out ?? false }
      }

      setIsClaiming(false)
      return { success: true, code: data.code, message: data.message || 'Code issued' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      setIsClaiming(false)
      return { success: false, code: null, message }
    }
  }

  return {
    claimCode,
    claimLumaCode,
    checkExistingCode,
    getAvailableCount,
    isClaiming,
    error,
  }
}
