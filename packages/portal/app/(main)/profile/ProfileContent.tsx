'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { BrandConfig } from '@/config/brand'
import { getClientBrandConfig } from '@/config/brand'
import { useAuth } from '@/hooks/useAuth'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { GlowInput } from '@/components/ui/GlowInput'
import { PageHeader } from '@/components/ui/PageHeader'
import { PortalButton } from '@/components/ui/PortalButton'

interface Props {
  brandConfig: BrandConfig
}

interface ProfileData {
  email: string
  first_name: string
  last_name: string
  company: string
  job_title: string
  linkedin_url: string
  avatar_url: string | null
  avatar_storage_path: string | null
  marketing_consent: boolean
}

interface FormErrors {
  first_name?: string
  last_name?: string
  company?: string
  job_title?: string
}

export function ProfileContent({ brandConfig }: Props) {
  const router = useRouter()
  const { user, session, isLoading: authLoading } = useAuth()
  const primaryColor = brandConfig.primaryColor
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const secondaryColor = brandConfig.secondaryColor

  const [profileData, setProfileData] = useState<ProfileData | null>(null)
  const [isLoadingProfile, setIsLoadingProfile] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    company: '',
    job_title: '',
    linkedin_url: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Communication preferences state
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [isSavingPreferences, setIsSavingPreferences] = useState(false)
  const [preferencesSuccess, setPreferencesSuccess] = useState(false)
  const [preferencesError, setPreferencesError] = useState<string | null>(null)

  // Profile image state
  const [profileImage, setProfileImage] = useState<File | null>(null)
  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasFetchedRef = useRef(false)

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/sign-in?redirectTo=/profile')
    }
  }, [authLoading, user, router])

  // Fetch profile data
  useEffect(() => {
    async function fetchProfile() {
      if (hasFetchedRef.current || !session?.access_token) return

      hasFetchedRef.current = true

      try {
        const config = getClientBrandConfig()
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${session.access_token}` } }
        })

        // Get customer for this auth user
        const { data: customer, error: customerError } = await supabase
          .from('customers')
          .select('id, email, attributes, avatar_storage_path')
          .eq('auth_user_id', session.user.id)
          .maybeSingle()

        if (customerError) {
          console.error('Error fetching customer:', customerError)
          setLoadError('Failed to load profile')
          setIsLoadingProfile(false)
          return
        }

        if (!customer) {
          // No customer record yet - this is fine, they just haven't submitted anything
          setProfileData({
            email: session.user.email || '',
            first_name: '',
            last_name: '',
            company: '',
            job_title: '',
            linkedin_url: '',
            avatar_url: null,
            avatar_storage_path: null,
            marketing_consent: false,
          })
          setFormData({
            first_name: '',
            last_name: '',
            company: '',
            job_title: '',
            linkedin_url: '',
          })
          setIsLoadingProfile(false)
          return
        }

        // Build avatar URL from storage path if available
        let avatarUrl: string | null = null
        if (customer.avatar_storage_path) {
          const { data: { publicUrl } } = supabase.storage
            .from('media')
            .getPublicUrl(customer.avatar_storage_path)
          avatarUrl = publicUrl
        }

        const customerAttrs = (customer.attributes as Record<string, string>) || {}

        const profile: ProfileData = {
          email: customer.email,
          first_name: customerAttrs.first_name || '',
          last_name: customerAttrs.last_name || '',
          company: customerAttrs.company || '',
          job_title: customerAttrs.job_title || '',
          linkedin_url: customerAttrs.linkedin_url || '',
          avatar_url: avatarUrl,
          avatar_storage_path: customer.avatar_storage_path,
          marketing_consent: String(customerAttrs.marketing_consent) === 'true',
        }

        setProfileData(profile)
        setMarketingConsent(String(customerAttrs.marketing_consent) === 'true')
        setFormData({
          first_name: profile.first_name,
          last_name: profile.last_name,
          company: profile.company,
          job_title: profile.job_title,
          linkedin_url: profile.linkedin_url,
        })
        if (avatarUrl) {
          setProfileImagePreview(avatarUrl)
        }
        setIsLoadingProfile(false)
      } catch (err) {
        console.error('Error fetching profile:', err)
        setLoadError('Failed to load profile')
        setIsLoadingProfile(false)
      }
    }

    if (session?.access_token) {
      fetchProfile()
    }
  }, [session])

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}

    if (!formData.first_name.trim()) {
      newErrors.first_name = 'First name is required'
    }

    if (!formData.last_name.trim()) {
      newErrors.last_name = 'Last name is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    if (errors[name as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [name]: undefined }))
    }
    setSaveSuccess(false)
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      setSubmitError('Please upload a JPEG, PNG, WebP, or GIF image')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setSubmitError('Image must be less than 5MB')
      return
    }

    setProfileImage(file)
    setSubmitError(null)
    setSaveSuccess(false)

    const reader = new FileReader()
    reader.onloadend = () => {
      setProfileImagePreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveImage = () => {
    setProfileImage(null)
    // Only clear preview if there's no existing avatar
    if (!profileData?.avatar_url) {
      setProfileImagePreview(null)
    } else {
      setProfileImagePreview(profileData.avatar_url)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setSaveSuccess(false)
  }

  const uploadProfileImage = async (): Promise<string | null> => {
    if (!profileImage) return null

    setIsUploadingImage(true)
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const config = getClientBrandConfig()
      const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)

      const fileExt = profileImage.name.split('.').pop() || 'jpg'
      const timestamp = Date.now()
      const randomStr = Math.random().toString(36).substring(2, 15)
      const fileName = `profiles/${timestamp}-${randomStr}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(fileName, profileImage, {
          contentType: profileImage.type,
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        throw new Error('Failed to upload image')
      }

      return fileName
    } catch (error) {
      console.error('Error uploading image:', error)
      return null
    } finally {
      setIsUploadingImage(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    setSaveSuccess(false)

    if (!validateForm()) {
      return
    }

    if (!session?.access_token) {
      setSubmitError('You must be signed in to update your profile')
      return
    }

    setIsSubmitting(true)

    try {
      // Upload profile image first if a new one was selected
      let avatarStoragePath: string | undefined
      if (profileImage) {
        const uploadedPath = await uploadProfileImage()
        if (uploadedPath) {
          avatarStoragePath = uploadedPath
        }
      }

      const config = getClientBrandConfig()

      const response = await fetch(`${config.supabaseUrl}/functions/v1/profile-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.supabaseAnonKey,
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          first_name: formData.first_name.trim(),
          last_name: formData.last_name.trim(),
          company: formData.company.trim() || undefined,
          job_title: formData.job_title.trim() || undefined,
          linkedin_url: formData.linkedin_url.trim() || undefined,
          avatar_storage_path: avatarStoragePath,
        }),
      })

      const result = await response.json()

      if (!result.success) {
        console.error('Profile update error:', result.error)
        setSubmitError(result.error || 'Update failed. Please try again.')
        return
      }

      // Update local state with new avatar if uploaded
      if (avatarStoragePath) {
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)
        const { data: { publicUrl } } = supabase.storage
          .from('media')
          .getPublicUrl(avatarStoragePath)

        setProfileData(prev => prev ? {
          ...prev,
          avatar_url: publicUrl,
          avatar_storage_path: avatarStoragePath,
        } : null)
        setProfileImagePreview(publicUrl)
        setProfileImage(null)
      }

      setSaveSuccess(true)
      window.dispatchEvent(new CustomEvent('user-profile-updated'))
    } catch (err) {
      console.error('Profile update error:', err)
      setSubmitError('An unexpected error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSavePreferences = async (consent: boolean) => {
    if (!session?.access_token) return

    setIsSavingPreferences(true)
    setPreferencesError(null)
    setPreferencesSuccess(false)

    try {
      const config = getClientBrandConfig()

      const response = await fetch(`${config.supabaseUrl}/functions/v1/profile-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.supabaseAnonKey,
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ marketing_consent: consent }),
      })

      const result = await response.json()

      if (!result.success) {
        setPreferencesError(result.error || 'Failed to update preferences')
        setMarketingConsent(!consent) // Revert on failure
        return
      }

      setPreferencesSuccess(true)
    } catch (err) {
      console.error('Error updating preferences:', err)
      setPreferencesError('An unexpected error occurred')
      setMarketingConsent(!consent) // Revert on failure
    } finally {
      setIsSavingPreferences(false)
    }
  }

  // Loading state
  if (authLoading || (user && isLoadingProfile)) {
    return (
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-12">
        <div className="text-center">
          <div
            className="loader"
            style={{
              '--primary-color': '#fff',
              '--secondary-color': primaryColor,
            } as React.CSSProperties}
          />
          <p className="mt-4 text-white/70">Loading your profile...</p>
        </div>
      </main>
    )
  }

  // Not authenticated (will redirect)
  if (!user) {
    return null
  }

  return (
    <main className="relative z-10">
      <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8 py-12">
          {/* Header */}
          <PageHeader
            title="My Profile"
            subtitle="Manage your personal information"
          />

          {/* Error state */}
          {loadError && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-400/50 rounded-lg">
              <p className="text-red-300">{loadError}</p>
            </div>
          )}

          {/* Profile Form */}
          <GlassPanel padding="p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              {submitError && (
                <div className="p-3 bg-red-500/20 border border-red-400/50 rounded-lg text-red-300 text-sm">
                  {submitError}
                </div>
              )}

              {saveSuccess && (
                <div className="p-3 rounded-lg text-white text-sm" style={{ backgroundColor: `${primaryColor}33`, border: `1px solid ${primaryColor}80` }}>
                  Your profile has been updated successfully.
                </div>
              )}

              {/* Profile Image */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Profile photo
                </label>
                <div className="flex items-start gap-4">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSubmitting}
                    className="w-24 h-24 rounded-full overflow-hidden flex-shrink-0 border-2 cursor-pointer transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 border-white/30 bg-white/10"
                  >
                    {profileImagePreview ? (
                      <img
                        src={profileImagePreview}
                        alt="Profile preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg
                          className="w-10 h-10 text-white/40"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                          />
                        </svg>
                      </div>
                    )}
                  </button>

                  <div className="flex-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={handleImageSelect}
                      className="hidden"
                      id="profile_image"
                      disabled={isSubmitting}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSubmitting}
                        className="cursor-pointer px-3 py-1.5 text-sm font-medium rounded-lg border border-white/30 bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {profileImagePreview ? 'Change photo' : 'Upload photo'}
                      </button>
                      {profileImage && (
                        <button
                          type="button"
                          onClick={handleRemoveImage}
                          disabled={isSubmitting}
                          className="cursor-pointer px-3 py-1.5 text-sm font-medium rounded-lg text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Remove new photo
                        </button>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-white/60">
                      JPG, PNG, WebP or GIF. Max 5MB.
                    </p>
                  </div>
                </div>
              </div>

              {/* Email (read-only) */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Email
                </label>
                <div className="w-full text-sm px-4 py-2.5 border border-white/20 rounded-lg bg-white/10 text-white/60">
                  {profileData?.email}
                </div>
                <p className="mt-1 text-xs text-white/50">Email cannot be changed</p>
              </div>

              {/* Name row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="first_name" className="block text-sm font-medium text-white mb-2">
                    First name
                  </label>
                  <GlowInput
                    type="text"
                    id="first_name"
                    name="first_name"
                    value={formData.first_name}
                    onChange={handleChange}
                    glowColor={primaryColor}
                    borderRadius="0.5rem"
                    className={`w-full text-sm px-4 py-2.5 border rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors ${
                      errors.first_name ? 'border-red-400/50' : 'border-white/30'
                    }`}
                    disabled={isSubmitting}
                  />
                  {errors.first_name && <p className="mt-1 text-sm text-red-300">{errors.first_name}</p>}
                </div>

                <div>
                  <label htmlFor="last_name" className="block text-sm font-medium text-white mb-2">
                    Last name
                  </label>
                  <GlowInput
                    type="text"
                    id="last_name"
                    name="last_name"
                    value={formData.last_name}
                    onChange={handleChange}
                    glowColor={primaryColor}
                    borderRadius="0.5rem"
                    className={`w-full text-sm px-4 py-2.5 border rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors ${
                      errors.last_name ? 'border-red-400/50' : 'border-white/30'
                    }`}
                    disabled={isSubmitting}
                  />
                  {errors.last_name && <p className="mt-1 text-sm text-red-300">{errors.last_name}</p>}
                </div>
              </div>

              {/* Company & Job Title */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="company" className="block text-sm font-medium text-white mb-2">
                    Company
                  </label>
                  <GlowInput
                    type="text"
                    id="company"
                    name="company"
                    value={formData.company}
                    onChange={handleChange}
                    glowColor={primaryColor}
                    borderRadius="0.5rem"
                    className="w-full text-sm px-4 py-2.5 border border-white/30 rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label htmlFor="job_title" className="block text-sm font-medium text-white mb-2">
                    Job title
                  </label>
                  <GlowInput
                    type="text"
                    id="job_title"
                    name="job_title"
                    value={formData.job_title}
                    onChange={handleChange}
                    glowColor={primaryColor}
                    borderRadius="0.5rem"
                    className="w-full text-sm px-4 py-2.5 border border-white/30 rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {/* LinkedIn */}
              <div>
                <label htmlFor="linkedin_url" className="block text-sm font-medium text-white mb-2">
                  LinkedIn profile
                </label>
                <GlowInput
                  type="url"
                  id="linkedin_url"
                  name="linkedin_url"
                  value={formData.linkedin_url}
                  onChange={handleChange}
                  placeholder="https://linkedin.com/in/yourprofile"
                  glowColor={primaryColor}
                  borderRadius="0.5rem"
                  className="w-full text-sm px-4 py-2.5 border border-white/30 rounded-lg bg-white/60 text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"
                  disabled={isSubmitting}
                />
              </div>

              {/* Submit button */}
              <div className="pt-2">
                <PortalButton
                  variant="primary"
                  primaryColor={primaryColor}
                  type="submit"
                  disabled={isSubmitting}
                  isLoading={isSubmitting}
                  glow
                  className="w-full"
                >
                  {isUploadingImage ? 'Uploading photo...' : 'Save changes'}
                </PortalButton>
              </div>
            </form>
          </GlassPanel>

          {/* Communication Preferences */}
          <GlassPanel padding="p-6 sm:p-8" className="mt-6">
            <h2 className="text-lg font-semibold text-white mb-4">Communication Preferences</h2>

            {preferencesError && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-400/50 rounded-lg text-red-300 text-sm">
                {preferencesError}
              </div>
            )}

            {preferencesSuccess && (
              <div className="mb-4 p-3 rounded-lg text-white text-sm" style={{ backgroundColor: `${primaryColor}33`, border: `1px solid ${primaryColor}80` }}>
                Your communication preferences have been updated.
              </div>
            )}

            <label className="flex items-start gap-3 cursor-pointer">
              <div className="relative flex-shrink-0 mt-0.5">
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => {
                    setMarketingConsent(e.target.checked)
                    setPreferencesSuccess(false)
                    handleSavePreferences(e.target.checked)
                  }}
                  disabled={isSavingPreferences}
                  className="sr-only peer"
                />
                <div
                  className="w-5 h-5 rounded border-2 transition-colors"
                  style={{
                    borderColor: marketingConsent ? primaryColor : 'rgba(255,255,255,0.4)',
                    backgroundColor: marketingConsent ? primaryColor : 'transparent',
                    opacity: isSavingPreferences ? 0.5 : 1,
                  }}
                >
                  {marketingConsent && (
                    <svg className="w-full h-full text-white" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
              </div>
              <div>
                <span className="text-white text-sm font-medium">
                  Marketing emails and updates
                </span>
                <p className="text-white/50 text-xs mt-1">
                  Receive occasional updates about events, community news, and relevant content.
                </p>
              </div>
            </label>

            {isSavingPreferences && (
              <p className="text-white/50 text-xs mt-3">Saving...</p>
            )}
          </GlassPanel>
      </div>
    </main>
  )
}
