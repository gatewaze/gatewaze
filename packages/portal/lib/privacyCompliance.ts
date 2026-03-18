'use client'

/**
 * Privacy Compliance Utilities
 *
 * Functions for recording consent, submitting privacy requests,
 * and managing CCPA preferences.
 *
 * Client-only: uses browser APIs and Supabase RPC calls
 */

import { getSupabaseClient } from './supabase/client'

// Types matching the database schema
export interface ConsentRecord {
  id?: string
  customer_id?: number
  email: string
  consent_type: ConsentType
  consented: boolean
  consent_version?: string
  consent_method: ConsentMethod
  consent_source: string
  ip_address?: string
  user_agent?: string
  consent_text?: string
  consented_at?: string
  withdrawn_at?: string
  legal_basis?: LegalBasis
  purpose_of_processing?: string
}

export type ConsentType =
  | 'marketing_email'
  | 'marketing_sms'
  | 'marketing_push'
  | 'data_processing'
  | 'third_party_sharing'
  | 'analytics'
  | 'profiling'
  | 'event_photography'
  | 'testimonials'

export type ConsentMethod =
  | 'explicit_checkbox'
  | 'double_opt_in'
  | 'verbal'
  | 'written'
  | 'implied'
  | 'admin_entry'

export type LegalBasis =
  | 'consent'
  | 'contract'
  | 'legal_obligation'
  | 'vital_interests'
  | 'public_task'
  | 'legitimate_interests'

export type PrivacyRequestType =
  | 'data_export'
  | 'data_deletion'
  | 'data_correction'
  | 'consent_withdrawal'
  | 'data_portability'
  | 'processing_restriction'

export interface PrivacyRequest {
  request_type: PrivacyRequestType
  subject_email: string
  requester_email?: string
  requester_ip?: string
  requester_user_agent?: string
}

export interface PrivacyRequestResult {
  success: boolean
  request_id?: string
  message?: string
  error?: string
  not_found?: boolean
}

export interface CCPAPreferenceResult {
  success: boolean
  not_found?: boolean
  error?: string
}

// Cookie consent categories mapping to compliance_consent_records types
const COOKIE_TO_CONSENT_TYPE: Record<string, ConsentType> = {
  analytics: 'analytics',
  marketing: 'marketing_email',
  functional: 'data_processing',
}

// Anonymous ID key for localStorage
const ANONYMOUS_ID_KEY = 'gatewaze-anonymous-id'

/**
 * Get or create an anonymous ID for tracking consent before email is known
 */
export const getAnonymousId = (): string => {
  if (typeof localStorage === 'undefined') return ''

  let anonymousId = localStorage.getItem(ANONYMOUS_ID_KEY)
  if (!anonymousId) {
    anonymousId = `anon_${crypto.randomUUID()}`
    localStorage.setItem(ANONYMOUS_ID_KEY, anonymousId)
  }
  return anonymousId
}

/**
 * Record cookie consent choices to the compliance_consent_records table
 * Uses RPC function to bypass RLS restrictions
 * Supports anonymous users - uses anonymous ID which gets linked when email is provided
 */
export const recordCookieConsent = async (
  email: string | null | undefined,
  categories: {
    necessary: boolean
    analytics: boolean
    marketing: boolean
    functional: boolean
  },
  consentText: string
): Promise<boolean> => {
  const supabase = getSupabaseClient()

  try {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const anonymousId = getAnonymousId()
    const normalizedEmail = email ? email.toLowerCase() : null
    let allSuccessful = true

    // Record consent for each category using RPC function
    for (const [category, consentType] of Object.entries(COOKIE_TO_CONSENT_TYPE)) {
      const consented = categories[category as keyof typeof categories]

      const { error } = await supabase.rpc('record_cookie_consent', {
        p_email: normalizedEmail,
        p_consent_type: consentType,
        p_consented: consented,
        p_consent_method: 'explicit_checkbox',
        p_consent_source: 'cookie_banner',
        p_user_agent: userAgent,
        p_consent_text: consentText,
        p_legal_basis: 'consent',
        p_purpose_of_processing: `Cookie consent for ${category} purposes`,
        p_anonymous_id: anonymousId,
      })

      if (error) {
        console.error(`Failed to record ${consentType} consent:`, error)
        allSuccessful = false
      }
    }

    return allSuccessful
  } catch (error) {
    console.error('Error recording cookie consent:', error)
    return false
  }
}

/**
 * Record privacy policy acceptance
 */
export const recordPrivacyPolicyAcceptance = async (email: string, policyVersion: string): Promise<boolean> => {
  const supabase = getSupabaseClient()

  try {
    const { error } = await supabase
      .from('customers')
      .update({
        privacy_policy_accepted_at: new Date().toISOString(),
        privacy_policy_version: policyVersion,
      })
      .eq('email', email.toLowerCase())

    if (error) {
      console.error('Failed to record privacy policy acceptance:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Error recording privacy policy acceptance:', error)
    return false
  }
}

/**
 * Submit a privacy request (data export, deletion, etc.)
 */
export const submitPrivacyRequest = async (
  requestType: PrivacyRequestType,
  email: string
): Promise<PrivacyRequestResult> => {
  const supabase = getSupabaseClient()

  try {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''

    const { data, error } = await supabase.rpc('submit_privacy_request', {
      p_request_type: requestType,
      p_email: email.toLowerCase(),
      p_requester_email: email.toLowerCase(),
      p_ip_address: null,
      p_user_agent: userAgent,
    })

    if (error) {
      console.error('Failed to submit privacy request:', error)
      return {
        success: false,
        error: 'Failed to submit request. Please try again or contact us directly.',
      }
    }

    if (data?.not_found) {
      return {
        success: false,
        not_found: true,
        error: "Email address not found. We don't have any data associated with this email.",
      }
    }

    return {
      success: data?.success ?? false,
      request_id: data?.request_id,
      message: data?.message,
      error: data?.error,
    }
  } catch (error) {
    console.error('Error submitting privacy request:', error)
    return {
      success: false,
      error: 'An unexpected error occurred. Please contact us directly.',
    }
  }
}

/**
 * Set CCPA "Do Not Sell" preference
 */
export const setDoNotSell = async (email: string, doNotSell: boolean): Promise<CCPAPreferenceResult> => {
  const supabase = getSupabaseClient()

  try {
    const normalizedEmail = email.toLowerCase()

    const { data, error } = await supabase.rpc('set_ccpa_preference', {
      p_email: normalizedEmail,
      p_preference_type: 'do_not_sell',
      p_value: doNotSell,
    })

    if (error) {
      console.error('Failed to set Do Not Sell preference via RPC:', error)
      return { success: false, error: error.message }
    }

    if (data?.not_found) {
      return {
        success: false,
        not_found: true,
        error: 'Email address not found',
      }
    }

    return { success: data?.success ?? true }
  } catch (error) {
    console.error('Error setting Do Not Sell preference:', error)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

/**
 * Set CCPA "Do Not Share" preference
 */
export const setDoNotShare = async (email: string, doNotShare: boolean): Promise<CCPAPreferenceResult> => {
  const supabase = getSupabaseClient()

  try {
    const normalizedEmail = email.toLowerCase()

    const { data, error } = await supabase.rpc('set_ccpa_preference', {
      p_email: normalizedEmail,
      p_preference_type: 'do_not_share',
      p_value: doNotShare,
    })

    if (error) {
      console.error('Failed to set Do Not Share preference via RPC:', error)
      return { success: false, error: error.message }
    }

    if (data?.not_found) {
      return {
        success: false,
        not_found: true,
        error: 'Email address not found',
      }
    }

    return { success: data?.success ?? true }
  } catch (error) {
    console.error('Error setting Do Not Share preference:', error)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

/**
 * Get user's current privacy preferences
 */
export const getPrivacyPreferences = async (
  email: string
): Promise<{
  doNotSell?: boolean
  doNotShare?: boolean
  privacyPolicyAccepted?: boolean
  privacyPolicyVersion?: string
} | null> => {
  const supabase = getSupabaseClient()

  try {
    const { data, error } = await supabase
      .from('customers')
      .select('do_not_sell, do_not_share, privacy_policy_accepted_at, privacy_policy_version')
      .eq('email', email.toLowerCase())
      .maybeSingle()

    if (error) {
      console.error('Failed to get privacy preferences:', error)
      return null
    }

    if (!data) {
      return null
    }

    return {
      doNotSell: data?.do_not_sell,
      doNotShare: data?.do_not_share,
      privacyPolicyAccepted: !!data?.privacy_policy_accepted_at,
      privacyPolicyVersion: data?.privacy_policy_version,
    }
  } catch (error) {
    console.error('Error getting privacy preferences:', error)
    return null
  }
}

/**
 * Get user's consent records
 */
export const getConsentRecords = async (email: string): Promise<ConsentRecord[]> => {
  const supabase = getSupabaseClient()

  try {
    const { data, error } = await supabase.from('compliance_consent_records').select('*').eq('email', email.toLowerCase())

    if (error) {
      console.error('Failed to get consent records:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Error getting consent records:', error)
    return []
  }
}
