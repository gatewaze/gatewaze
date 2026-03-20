'use client'

import type { BrandConfig } from '@/config/brand'
import { GlowInput } from '@/components/ui/GlowInput'
import type { PeopleAttributeConfig } from '@gatewaze/shared/types/people'
import { DEFAULT_PEOPLE_ATTRIBUTES } from '@gatewaze/shared/types/people'

export interface ProfileDetails {
  firstName: string
  lastName: string
  company: string
  jobTitle: string
  linkedInUrl: string
  [key: string]: string
}

interface Props {
  brandConfig: BrandConfig
  values: ProfileDetails
  onChange: (values: ProfileDetails) => void
  errors?: Partial<Record<keyof ProfileDetails, string>>
  attributeConfig?: PeopleAttributeConfig[]
}

/** Map attribute keys to ProfileDetails field names */
const ATTR_KEY_TO_FIELD: Record<string, keyof ProfileDetails> = {
  first_name: 'firstName',
  last_name: 'lastName',
  company: 'company',
  job_title: 'jobTitle',
  linkedin_url: 'linkedInUrl',
}

const FIELD_PLACEHOLDERS: Record<string, string> = {
  firstName: 'Your first name',
  lastName: 'Your last name',
  company: 'Acme Inc.',
  jobTitle: 'Software Engineer',
  linkedInUrl: 'https://linkedin.com/in/yourprofile',
}

const FIELD_AUTOCOMPLETE: Record<string, string> = {
  firstName: 'given-name',
  lastName: 'family-name',
  company: 'organization',
  jobTitle: 'organization-title',
}

const FIELD_INPUT_TYPE: Record<string, string> = {
  linkedInUrl: 'url',
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
 * Fields are rendered dynamically based on the people attributes configuration.
 */
export function ProfileDetailsStep({ brandConfig, values, onChange, errors = {}, attributeConfig }: Props) {
  const primaryColor = brandConfig.primaryColor
  const config = attributeConfig || DEFAULT_PEOPLE_ATTRIBUTES

  // Get enabled attributes in config order
  const enabledAttrs = config.filter(a => a.enabled)

  const handleChange = (field: keyof ProfileDetails) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    onChange({ ...values, [field]: e.target.value })
  }

  // Group fields into rows of 2 for side-by-side layout (except linkedin which is full-width)
  const renderField = (attr: PeopleAttributeConfig) => {
    const fieldName = ATTR_KEY_TO_FIELD[attr.key] || attr.key
    const fieldId = String(fieldName)
    const placeholder = FIELD_PLACEHOLDERS[fieldName] || attr.label
    const autoComplete = FIELD_AUTOCOMPLETE[fieldName]
    const inputType = FIELD_INPUT_TYPE[fieldName] || 'text'

    return (
      <div key={attr.key}>
        <label htmlFor={fieldId} className="block text-base font-medium text-white mb-1.5">
          {attr.label}{attr.required ? <span className="text-[#FF0000] font-medium"> *</span> : ''}
        </label>
        <GlowInput
          id={fieldId}
          type={inputType}
          value={values[fieldName] || ''}
          onChange={handleChange(fieldName)}
          placeholder={placeholder}
          glowColor={primaryColor}
          borderRadius="0.5rem"
          className="w-full text-base px-3 py-2 border border-white/30 rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"
          {...(autoComplete ? { autoComplete } : {})}
        />
        {errors[fieldName] && (
          <p className="text-white text-xs mt-1"><span className="text-[#FF0000]">*</span> {errors[fieldName]}</p>
        )}
      </div>
    )
  }

  // Separate LinkedIn (full-width) from the rest (paired in 2-column grid)
  const pairedAttrs = enabledAttrs.filter(a => a.key !== 'linkedin_url')
  const linkedInAttr = enabledAttrs.find(a => a.key === 'linkedin_url')

  // Chunk paired attrs into groups of 2
  const rows: PeopleAttributeConfig[][] = []
  for (let i = 0; i < pairedAttrs.length; i += 2) {
    rows.push(pairedAttrs.slice(i, i + 2))
  }

  return (
    <div className="space-y-4">
      <p className="text-white/70 text-sm text-center mb-6">
        Please complete your profile to continue.
      </p>

      {rows.map((row, i) => (
        <div key={i} className={`grid gap-4 ${row.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {row.map(attr => renderField(attr))}
        </div>
      ))}

      {linkedInAttr && (
        <div>
          {renderField(linkedInAttr)}
        </div>
      )}
    </div>
  )
}
