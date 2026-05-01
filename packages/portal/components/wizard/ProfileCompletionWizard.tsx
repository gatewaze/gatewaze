'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useUserEnrichment } from '@/hooks/useUserEnrichment'
import { getClientBrandConfig } from '@/config/brand'
import type { BrandConfig } from '@/config/brand'
import { ProfileWizard, WizardStep } from './ProfileWizard'
import { ProfileDetailsStep, ProfileDetails, validateLinkedInUrlExists } from './ProfileDetailsStep'
import { PreferencesStep } from './PreferencesStep'
import type { PeopleAttributeConfig } from '@gatewaze/shared/types/people'
import { DEFAULT_PEOPLE_ATTRIBUTES } from '@gatewaze/shared/types/people'

interface Props {
  brandConfig: BrandConfig
}

interface PersonData {
  id: string
  attributes: Record<string, string>
}

/** Map from attribute key to ProfileDetails field name */
const ATTR_KEY_TO_FIELD: Record<string, keyof ProfileDetails> = {
  first_name: 'firstName',
  last_name: 'lastName',
  company: 'company',
  job_title: 'jobTitle',
  linkedin_url: 'linkedInUrl',
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
  const [_personData, setPersonData] = useState<PersonData | null>(null)
  const [profileDetails, setProfileDetails] = useState<ProfileDetails>({
    firstName: '',
    lastName: '',
    company: '',
    jobTitle: '',
    linkedInUrl: '',
  })
  const [attributeConfig, setAttributeConfig] = useState<PeopleAttributeConfig[]>(DEFAULT_PEOPLE_ATTRIBUTES)
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

        // Fetch people_attributes config and person data in parallel
        const [{ data: attrSetting }, { data: person }] = await Promise.all([
          supabase
            .from('platform_settings')
            .select('value')
            .eq('key', 'people_attributes')
            .maybeSingle(),
          supabase
            .from('people')
            .select('id, attributes')
            .eq('auth_user_id', user.id)
            .maybeSingle(),
        ])

        // Parse attribute config
        let attrConfig = DEFAULT_PEOPLE_ATTRIBUTES
        if (attrSetting?.value) {
          try {
            const parsed = JSON.parse(attrSetting.value)
            if (Array.isArray(parsed) && parsed.length > 0) {
              attrConfig = parsed
            }
          } catch { /* use defaults */ }
        }
        setAttributeConfig(attrConfig)

        // Determine which fields are required based on config
        const requiredKeys = attrConfig
          .filter((a: PeopleAttributeConfig) => a.enabled && a.required)
          .map((a: PeopleAttributeConfig) => a.key)

        if (person) {
          let attrs = (person.attributes as Record<string, string>) || {}
          setPersonData({
            id: person.id,
            attributes: attrs,
          })

          // Check if any required fields are missing
          const isMissingRequired = requiredKeys.some((key: string) => !attrs[key])
          const isMissingConsent = attrs.marketing_consent === undefined || attrs.marketing_consent === null

          // If profile fields are missing, try enrichment first
          if (isMissingRequired && user.email) {
            try {
              const enrichmentData = await enrichUser(user.email)
              if (enrichmentData) {
                // Merge enrichment data into attrs (don't overwrite existing values)
                for (const key of requiredKeys) {
                  if (!attrs[key] && (enrichmentData as Record<string, string>)[key]) {
                    attrs = { ...attrs, [key]: (enrichmentData as Record<string, string>)[key] }
                  }
                }
                if (!attrs.linkedin_url && enrichmentData.linkedin_url) {
                  attrs = { ...attrs, linkedin_url: enrichmentData.linkedin_url }
                }
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

          // Re-check after enrichment
          const stillMissingRequired = requiredKeys.some((key: string) => !attrs[key])
          if (stillMissingRequired || isMissingConsent) {
            setShowWizard(true)
          }
        } else {
          // No person record - show wizard to create one
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

      // Call people-signup to update person attributes
      const response = await fetch(`${config.supabaseUrl}/functions/v1/people-signup`, {
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

    // Validate all required fields from config
    for (const attr of attributeConfig) {
      if (!attr.enabled || !attr.required) continue
      const fieldName = ATTR_KEY_TO_FIELD[attr.key]
      if (fieldName && !profileDetails[fieldName]?.trim()) {
        newErrors[fieldName] = `${attr.label} is required`
      }
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
  }, [profileDetails, attributeConfig])

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
          attributeConfig={attributeConfig}
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
