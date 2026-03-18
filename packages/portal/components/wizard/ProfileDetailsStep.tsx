'use client'

import type { BrandConfig } from '@/config/brand'
import { GlowInput } from '@/components/ui/GlowInput'

export interface ProfileDetails {
  firstName: string
  lastName: string
  company: string
  jobTitle: string
  linkedInUrl: string
}

interface Props {
  brandConfig: BrandConfig
  values: ProfileDetails
  onChange: (values: ProfileDetails) => void
  errors?: Partial<Record<keyof ProfileDetails, string>>
}

/**
 * Validates a LinkedIn profile URL format.
 * Accepts formats like:
 * - https://linkedin.com/in/username
 * - https://www.linkedin.com/in/username
 * - linkedin.com/in/username
 */
export function isValidLinkedInUrl(url: string): boolean {
  if (!url.trim()) return true // Empty is valid (optional field)
  const linkedInPattern = /^(https?:\/\/)?(www\.)?linkedin\.com\/in\/[\w-]+\/?$/i
  return linkedInPattern.test(url.trim())
}

interface LinkedInValidationResult {
  valid: boolean
  exists: boolean
  error?: string
}

/**
 * Validates a LinkedIn profile URL by checking if the profile actually exists.
 * Calls the validate-linkedin-url edge function.
 */
export async function validateLinkedInUrlExists(
  url: string,
  supabaseUrl: string
): Promise<LinkedInValidationResult> {
  if (!url.trim()) {
    return { valid: true, exists: true } // Empty is valid (optional field)
  }

  // First check format locally
  if (!isValidLinkedInUrl(url)) {
    return {
      valid: false,
      exists: false,
      error: 'Invalid LinkedIn profile URL format',
    }
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/validate-linkedin-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: url.trim() }),
    })

    if (!response.ok) {
      // If the edge function fails, fall back to format validation only
      console.error('LinkedIn validation edge function error:', response.status)
      return { valid: true, exists: true }
    }

    const result: LinkedInValidationResult = await response.json()
    return result
  } catch (error) {
    // If fetch fails, fall back to format validation only
    console.error('LinkedIn validation error:', error)
    return { valid: true, exists: true }
  }
}

/**
 * Form step for collecting user profile details.
 * Fields: first name, last name, company, job title, LinkedIn URL
 */
export function ProfileDetailsStep({ brandConfig, values, onChange, errors = {} }: Props) {
  const primaryColor = brandConfig.primaryColor

  const handleChange = (field: keyof ProfileDetails) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    onChange({ ...values, [field]: e.target.value })
  }

  return (
      <div className="space-y-4">
        <p className="text-white/70 text-sm text-center mb-6">
          Please complete your profile to continue.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="firstName" className="block text-base font-medium text-white mb-1.5">
              First Name <span className="text-[#FF0000] font-medium">*</span>
            </label>
            <GlowInput
              id="firstName"
              type="text"
              value={values.firstName}
              onChange={handleChange('firstName')}
              placeholder="Your first name"
              glowColor={primaryColor}
              borderRadius="0.5rem"
              className="w-full text-base px-3 py-2 border border-white/30 rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"
              autoComplete="given-name"
            />
            {errors.firstName && (
              <p className="text-white text-xs mt-1"><span className="text-[#FF0000]">*</span> {errors.firstName}</p>
            )}
          </div>

          <div>
            <label htmlFor="lastName" className="block text-base font-medium text-white mb-1.5">
              Last Name <span className="text-[#FF0000] font-medium">*</span>
            </label>
            <GlowInput
              id="lastName"
              type="text"
              value={values.lastName}
              onChange={handleChange('lastName')}
              placeholder="Your last name"
              glowColor={primaryColor}
              borderRadius="0.5rem"
              className="w-full text-base px-3 py-2 border border-white/30 rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"
              autoComplete="family-name"
            />
            {errors.lastName && (
              <p className="text-white text-xs mt-1"><span className="text-[#FF0000]">*</span> {errors.lastName}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="company" className="block text-base font-medium text-white mb-1.5">
              Company
            </label>
            <GlowInput
              id="company"
              type="text"
              value={values.company}
              onChange={handleChange('company')}
              placeholder="Acme Inc."
              glowColor={primaryColor}
              borderRadius="0.5rem"
              className="w-full text-base px-3 py-2 border border-white/30 rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"
              autoComplete="organization"
            />
          </div>

          <div>
            <label htmlFor="jobTitle" className="block text-base font-medium text-white mb-1.5">
              Job Title
            </label>
            <GlowInput
              id="jobTitle"
              type="text"
              value={values.jobTitle}
              onChange={handleChange('jobTitle')}
              placeholder="Software Engineer"
              glowColor={primaryColor}
              borderRadius="0.5rem"
              className="w-full text-base px-3 py-2 border border-white/30 rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"
              autoComplete="organization-title"
            />
          </div>
        </div>

        <div>
          <label htmlFor="linkedInUrl" className="block text-base font-medium text-white mb-1.5">
            LinkedIn Profile URL
          </label>
          <GlowInput
            id="linkedInUrl"
            type="url"
            value={values.linkedInUrl}
            onChange={handleChange('linkedInUrl')}
            placeholder="https://linkedin.com/in/yourprofile"
            glowColor={primaryColor}
            borderRadius="0.5rem"
            className="w-full text-base px-3 py-2 border border-white/30 rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"
          />
          {errors.linkedInUrl && (
            <p className="text-white text-xs mt-1"><span className="text-[#FF0000]">*</span> {errors.linkedInUrl}</p>
          )}
        </div>
      </div>
    )
}
