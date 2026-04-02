'use client'

import type { BrandConfig } from '@/config/brand'
import { GlowInput, GlowTextarea } from '@/components/ui/GlowInput'
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
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    onChange({ ...values, [field]: e.target.value })
  }

  const inputClassName = "w-full text-base px-3 py-2 border border-white/30 rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"

  // Group fields into rows of 2 for side-by-side layout (except linkedin which is full-width)
  const renderField = (attr: PeopleAttributeConfig) => {
    const fieldName = ATTR_KEY_TO_FIELD[attr.key] || attr.key
    const fieldId = String(fieldName)
    const placeholder = FIELD_PLACEHOLDERS[fieldName] || attr.label
    const autoComplete = FIELD_AUTOCOMPLETE[fieldName]
    const inputType = FIELD_INPUT_TYPE[fieldName] || 'text'
    const attrType = attr.type || 'string'

    const label = (
      <label htmlFor={fieldId} className="block text-base font-medium text-white mb-1.5">
        {attr.label}{attr.required ? <span className="text-[#FF0000] font-medium"> *</span> : ''}
      </label>
    )

    const error = errors[fieldName] && (
      <p className="text-white text-xs mt-1"><span className="text-[#FF0000]">*</span> {errors[fieldName]}</p>
    )

    if (attrType === 'text') {
      return (
        <div key={attr.key}>
          {label}
          <GlowTextarea
            id={fieldId}
            value={values[fieldName] || ''}
            onChange={handleChange(fieldName)}
            placeholder={placeholder}
            glowColor={primaryColor}
            borderRadius="0.5rem"
            rows={3}
            className={inputClassName}
          />
          {error}
        </div>
      )
    }

    if (attrType === 'select') {
      return (
        <div key={attr.key}>
          {label}
          <div className="relative" style={{ borderRadius: '0.5rem' }}>
            <select
              id={fieldId}
              value={values[fieldName] || ''}
              onChange={handleChange(fieldName)}
              className={`${inputClassName} appearance-none cursor-pointer`}
              style={{ borderRadius: '0.5rem' }}
            >
              <option value="">{`Select ${attr.label}...`}</option>
              {(attr.options || []).map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          {error}
        </div>
      )
    }

    if (attrType === 'multi-select') {
      const selected: string[] = values[fieldName] ? (() => { try { return JSON.parse(values[fieldName]) } catch { return [] } })() : []
      return (
        <div key={attr.key}>
          {label}
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-white/30 bg-white/60 p-2 min-h-[38px]">
            {(attr.options || []).map(opt => {
              const isSelected = selected.includes(opt)
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    const next = isSelected ? selected.filter(s => s !== opt) : [...selected, opt]
                    onChange({ ...values, [fieldName]: JSON.stringify(next) })
                  }}
                  className={`px-2.5 py-1 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                    isSelected
                      ? 'text-white'
                      : 'bg-white/50 text-gray-700 hover:bg-white/70'
                  }`}
                  style={isSelected ? { backgroundColor: primaryColor } : undefined}
                >
                  {opt}
                </button>
              )
            })}
            {(attr.options || []).length === 0 && (
              <span className="text-sm text-gray-500">No options configured</span>
            )}
          </div>
          {error}
        </div>
      )
    }

    // Default: string type
    return (
      <div key={attr.key}>
        {label}
        <GlowInput
          id={fieldId}
          type={inputType}
          value={values[fieldName] || ''}
          onChange={handleChange(fieldName)}
          placeholder={placeholder}
          glowColor={primaryColor}
          borderRadius="0.5rem"
          className={inputClassName}
          {...(autoComplete ? { autoComplete } : {})}
        />
        {error}
      </div>
    )
  }

  // Fields that should be full-width: linkedin, text type, multi-select type
  const isFullWidth = (a: PeopleAttributeConfig) =>
    a.key === 'linkedin_url' || a.type === 'text' || a.type === 'multi-select'

  // Build rows: full-width items get their own row, others pair up
  const rows: PeopleAttributeConfig[][] = []
  let i = 0
  while (i < enabledAttrs.length) {
    if (isFullWidth(enabledAttrs[i])) {
      rows.push([enabledAttrs[i]])
      i++
    } else if (i + 1 < enabledAttrs.length && !isFullWidth(enabledAttrs[i + 1])) {
      rows.push([enabledAttrs[i], enabledAttrs[i + 1]])
      i += 2
    } else {
      rows.push([enabledAttrs[i]])
      i++
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-white/70 text-sm text-center mb-6">
        Please complete your profile to continue.
      </p>

      {rows.map((row, ri) => (
        <div key={ri} className={`grid gap-4 ${row.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {row.map(attr => renderField(attr))}
        </div>
      ))}
    </div>
  )
}
