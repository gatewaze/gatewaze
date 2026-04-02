'use client'

import { useState, useCallback } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { getClientBrandConfig } from '@/config/brand'

interface EnrichmentData {
  first_name?: string
  last_name?: string
  job_title?: string
  company?: string
  linkedin_url?: string
  city?: string
  country?: string
  state?: string
  timezone?: string
  company_domain?: string
  company_industry?: string
  company_employees?: number
}

interface UseUserEnrichmentReturn {
  enrichUser: (email: string) => Promise<EnrichmentData | null>
  isEnriching: boolean
  error: string | null
}

/**
 * Hook for enriching user data via the user-enrichment edge function.
 * Used during sign-in to populate missing profile fields.
 */
export function useUserEnrichment(): UseUserEnrichmentReturn {
  const [isEnriching, setIsEnriching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enrichUser = useCallback(async (email: string): Promise<EnrichmentData | null> => {
    if (!email) {
      return null
    }

    setIsEnriching(true)
    setError(null)

    try {
      const supabase = getSupabaseClient()
      const brandConfig = getClientBrandConfig()

      // Call the user-enrichment edge function in sync mode
      const { data, error: fnError } = await supabase.functions.invoke('people-enrichment', {
        body: {
          email,
          mode: 'sync', // Synchronous mode returns data immediately
        },
      })

      if (fnError) {
        throw new Error(fnError.message || 'Enrichment failed')
      }

      if (!data || !data.summary) {
        return null
      }

      // Extract relevant fields from the enrichment summary
      const enrichmentData: EnrichmentData = {
        first_name: data.summary.first_name,
        last_name: data.summary.last_name,
        job_title: data.summary.job_title,
        company: data.summary.company,
        linkedin_url: data.summary.linkedin_url,
        city: data.summary.city,
        country: data.summary.country,
        state: data.summary.state,
        timezone: data.summary.timezone,
        company_domain: data.summary.company_domain,
        company_industry: data.summary.company_industry,
        company_employees: data.summary.company_employees,
      }

      // Filter out undefined values
      const filteredData: EnrichmentData = Object.fromEntries(
        Object.entries(enrichmentData).filter(([, value]) => value !== undefined && value !== null)
      )

      return Object.keys(filteredData).length > 0 ? filteredData : null
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to enrich user data'
      setError(errorMessage)
      console.error('User enrichment error:', err)
      return null
    } finally {
      setIsEnriching(false)
    }
  }, [])

  return {
    enrichUser,
    isEnriching,
    error,
  }
}

/**
 * Update a user's profile with enrichment data, only filling in missing fields.
 */
export async function updateProfileWithEnrichment(
  userId: string,
  currentProfile: Record<string, unknown>,
  enrichmentData: EnrichmentData
): Promise<boolean> {
  try {
    const supabase = getSupabaseClient()

    // Only update fields that are currently empty
    const updates: Record<string, unknown> = {}

    if (!currentProfile.first_name && enrichmentData.first_name) {
      updates.first_name = enrichmentData.first_name
    }
    if (!currentProfile.last_name && enrichmentData.last_name) {
      updates.last_name = enrichmentData.last_name
    }
    if (!currentProfile.job_title && enrichmentData.job_title) {
      updates.job_title = enrichmentData.job_title
    }
    if (!currentProfile.company && enrichmentData.company) {
      updates.company = enrichmentData.company
    }
    if (!currentProfile.linkedin_url && enrichmentData.linkedin_url) {
      updates.linkedin_url = enrichmentData.linkedin_url
    }
    if (!currentProfile.city && enrichmentData.city) {
      updates.city = enrichmentData.city
    }
    if (!currentProfile.country && enrichmentData.country) {
      updates.country = enrichmentData.country
    }
    if (!currentProfile.timezone && enrichmentData.timezone) {
      updates.timezone = enrichmentData.timezone
    }

    if (Object.keys(updates).length === 0) {
      // Nothing to update
      return true
    }

    // Update the person profile
    const { error } = await supabase
      .from('people_profiles')
      .update(updates)
      .eq('user_id', userId)

    if (error) {
      console.error('Failed to update profile with enrichment:', error)
      return false
    }

    return true
  } catch (err) {
    console.error('Error updating profile with enrichment:', err)
    return false
  }
}
