'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useUserEnrichment } from '@/hooks/useUserEnrichment'
import { getClientBrandConfig } from '@/config/brand'
import type { BrandConfig } from '@/config/brand'
import { ProfileWizard, WizardStep } from './ProfileWizard'
import { ProfileDetailsStep, ProfileDetails, validateLinkedInUrlExists } from './ProfileDetailsStep'
import { PreferencesStep } from './PreferencesStep'

interface Props {
  brandConfig: BrandConfig
}

interface CustomerData {
  id: string
  attributes: Record<string, string>
}

/**
 * Wrapper component that checks if a user's profile is complete
 * and shows a wizard to complete it if not.
 */
export function ProfileCompletionWizard({ brandConfig }: Props) {
  const { user, session } = useAuth()
  const { enrichUser } = useUserEnrichment()
  const [showWizard, setShowWizard] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_customerData, setCustomerData] = useState<CustomerData | null>(null)
  const [profileDetails, setProfileDetails] = useState<ProfileDetails>({
    firstName: '',
    lastName: '',
    company: '',
    jobTitle: '',
    linkedInUrl: '',
  })
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileDetails, string>>>({})
  const [isLoading, setIsLoading] = useState(true)
  const hasCheckedRef = useRef(false)
  const lastUserIdRef = useRef<string | null>(null)

  // Check if profile is complete on mount and when user changes
  useEffect(() => {
    async function checkProfileCompletion() {
      // Reset hasChecked if user changed (e.g., new login)
      if (user && lastUserIdRef.current !== user.id) {
        hasCheckedRef.current = false
        lastUserIdRef.current = user.id
      }

      if (hasCheckedRef.current || !session?.access_token || !user) {
        setIsLoading(false)
        return
      }
      hasCheckedRef.current = true

      try {
        const config = getClientBrandConfig()
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${session.access_token}` } }
        })

        const { data: customer } = await supabase
          .from('customers')
          .select('id, attributes')
          .eq('auth_user_id', user.id)
          .maybeSingle()

        if (customer) {
          let attrs = (customer.attributes as Record<string, string>) || {}
          setCustomerData({
            id: customer.id,
            attributes: attrs,
          })

          // Check if required fields are missing (first_name, last_name, company, job_title)
          const isMissingRequired = !attrs.first_name || !attrs.last_name || !attrs.company || !attrs.job_title
          const isMissingConsent = attrs.marketing_consent === undefined || attrs.marketing_consent === null

          // If profile fields are missing, try enrichment first
          if (isMissingRequired && user.email) {
            try {
              const enrichmentData = await enrichUser(user.email)
              if (enrichmentData) {
                // Merge enrichment data into attrs (don't overwrite existing values)
                if (!attrs.first_name && enrichmentData.first_name) attrs = { ...attrs, first_name: enrichmentData.first_name }
                if (!attrs.last_name && enrichmentData.last_name) attrs = { ...attrs, last_name: enrichmentData.last_name }
                if (!attrs.company && enrichmentData.company) attrs = { ...attrs, company: enrichmentData.company }
                if (!attrs.job_title && enrichmentData.job_title) attrs = { ...attrs, job_title: enrichmentData.job_title }
                if (!attrs.linkedin_url && enrichmentData.linkedin_url) attrs = { ...attrs, linkedin_url: enrichmentData.linkedin_url }
              }
            } catch {
              // Enrichment failure is non-critical, continue with existing data
            }
          }

          // Pre-populate form with existing + enriched data
          setProfileDetails({
            firstName: attrs.first_name || '',
            lastName: attrs.last_name || '',
            company: attrs.company || '',
            jobTitle: attrs.job_title || '',
            linkedInUrl: attrs.linkedin_url || '',
          })

          // Pre-populate marketing consent if already set
          if (String(attrs.marketing_consent) === 'true') {
            setMarketingConsent(true)
          }

          // Re-check after enrichment - require all 4 fields
          const stillMissingRequired = !attrs.first_name || !attrs.last_name || !attrs.company || !attrs.job_title
          if (stillMissingRequired || isMissingConsent) {
            setShowWizard(true)
          }
        } else {
          // No customer record - show wizard to create one
          setShowWizard(true)
        }
      } catch (err) {
        console.error('Error checking profile completion:', err)
      } finally {
        setIsLoading(false)
      }
    }

    if (session?.access_token && user) {
      checkProfileCompletion()
    } else {
      setIsLoading(false)
      hasCheckedRef.current = false
      lastUserIdRef.current = null
    }
  }, [session, user, enrichUser])

  // Handle wizard completion
  const handleComplete = useCallback(async () => {
    if (!session?.access_token || !user) return

    try {
      const config = getClientBrandConfig()

      // Call user-signup to update customer attributes
      const response = await fetch(`${config.supabaseUrl}/functions/v1/user-signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: user.email,
          source: 'event_portal_profile_completion',
          app: 'portal',
          user_metadata: {
            first_name: profileDetails.firstName.trim(),
            last_name: profileDetails.lastName.trim(),
            company: profileDetails.company.trim() || undefined,
            job_title: profileDetails.jobTitle.trim() || undefined,
            linkedin_url: profileDetails.linkedInUrl.trim() || undefined,
            marketing_consent: marketingConsent,
          },
        }),
      })

      if (!response.ok) {
        console.error('Failed to update profile:', await response.text())
        throw new Error('Failed to update profile')
      }

      const data = await response.json()
      console.log('Profile updated:', data)

      setShowWizard(false)
    } catch (err) {
      console.error('Error updating profile:', err)
      throw err
    }
  }, [session, user, profileDetails, marketingConsent])

  // Validation function for the details step - returns errors or true
  const validateDetails = useCallback(async (): Promise<true | Record<string, string>> => {
    const newErrors: Record<string, string> = {}

    if (!profileDetails.firstName.trim()) {
      newErrors.firstName = 'First name is required'
    }
    if (!profileDetails.lastName.trim()) {
      newErrors.lastName = 'Last name is required'
    }

    // Validate LinkedIn URL if provided
    if (profileDetails.linkedInUrl.trim()) {
      const config = getClientBrandConfig()
      const linkedInResult = await validateLinkedInUrlExists(
        profileDetails.linkedInUrl,
        config.supabaseUrl
      )

      if (!linkedInResult.valid) {
        newErrors.linkedInUrl = linkedInResult.error || 'Please enter a valid LinkedIn profile URL'
      } else if (!linkedInResult.exists) {
        newErrors.linkedInUrl = linkedInResult.error || 'This LinkedIn profile does not exist'
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return newErrors
    }

    setErrors({})
    return true
  }, [profileDetails])

  // Don't render anything while loading or if wizard shouldn't show
  if (isLoading || !showWizard) {
    return null
  }

  // Build wizard steps
  const steps: WizardStep[] = [
    {
      id: 'details',
      title: 'Complete Your Profile',
      component: (
        <ProfileDetailsStep
          brandConfig={brandConfig}
          values={profileDetails}
          onChange={setProfileDetails}
          errors={errors}
        />
      ),
      countInProgress: true,
      validate: validateDetails,
    },
    {
      id: 'preferences',
      title: 'Communication Preferences',
      component: (
        <PreferencesStep
          brandConfig={brandConfig}
          marketingConsent={marketingConsent}
          onChange={setMarketingConsent}
        />
      ),
    },
  ]

  return (
    <ProfileWizard
      brandConfig={brandConfig}
      steps={steps}
      onComplete={handleComplete}
    />
  )
}
