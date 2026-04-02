'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import { getClientBrandConfig, isLightColor } from '@/config/brand'
import { stripEmojis } from '@/lib/text'
import { getSupabaseClient } from '@/lib/supabase/client'
import { GlowInput, GlowTextarea } from '@/components/ui/GlowInput'
import { PortalButton } from '@/components/ui/PortalButton'

interface UserProfile {
  email: string
  first_name: string
  last_name: string
  company: string | null
  job_title: string | null
  linkedin_url: string | null
  avatar_url: string | null
}

interface Props {
  event: Event
  brandConfig: BrandConfig
  onSuccess?: () => void
  onCancel?: () => void
  useDarkTheme?: boolean
  initialStatus?: string
  userProfile?: UserProfile | null
  confirmedDurationCounts?: Record<number, number>
  isAdditionalTalk?: boolean
}

interface SpeakerSubmissionResponse {
  success: boolean
  message?: string
  error?: string
  already_submitted?: boolean
  speaker_id?: string
  edit_token?: string
}

interface FormData {
  email: string
  first_name: string
  last_name: string
  company: string
  job_title: string
  linkedin_url: string
  talk_title: string
  talk_synopsis: string
  speaker_bio: string
  talk_duration_minutes: number | null
}

interface FormErrors {
  email?: string
  first_name?: string
  last_name?: string
  company?: string
  job_title?: string
  profile_image?: string
  talk_title?: string
  talk_synopsis?: string
  talk_duration_minutes?: string
}

export function SpeakerSubmissionForm({ event, brandConfig, onSuccess, onCancel, useDarkTheme = false, initialStatus = 'pending', userProfile, confirmedDurationCounts = {}, isAdditionalTalk = false }: Props) {
  const router = useRouter()
  const primaryColor = event.gradient_color_1 || brandConfig.primaryColor

  // Calculate available duration options based on capacity
  const durationOptions = event.talk_duration_options || []
  const availableDurationOptions = durationOptions.filter(option => {
    const confirmedCount = confirmedDurationCounts[option.duration] || 0
    return confirmedCount < option.capacity
  })

  // Theme styles based on dark/light mode
  const theme = {
    heading: 'text-white',
    subtext: 'text-white/70',
    requiredClass: 'text-[10px] font-semibold text-white/70 uppercase tracking-wide px-1.5 py-0.5 rounded ml-1.5',
    label: 'text-white',
    inputBg: useDarkTheme ? 'bg-black/40' : 'bg-white/60',
    inputText: 'text-gray-900',
    inputPlaceholder: 'placeholder-gray-500',
    inputBorder: useDarkTheme ? 'border-white/20' : 'border-white/30',
    inputFocusBorder: useDarkTheme ? 'focus:border-white/40' : 'focus:border-white/50',
    inputFocusRing: useDarkTheme ? 'focus:ring-white/20' : 'focus:ring-white/20',
    errorBg: 'bg-red-500/20',
    errorBorder: 'border-red-400/50',
    errorText: 'text-red-300',
    errorInputBorder: 'border-red-400/50',
    errorInputFocusBorder: 'focus:border-red-400',
    errorInputFocusRing: 'focus:ring-red-400/30',
    cancelText: 'text-white/70',
    cancelBorder: 'border-white/30',
    cancelHover: 'hover:bg-white/10',
    footerText: 'text-white/80',
    footerLink: 'text-white hover:text-white/90 underline',
    sectionBorder: 'border-white/20',
  }

  const [formData, setFormData] = useState<FormData>({
    email: '',
    first_name: '',
    last_name: '',
    company: '',
    job_title: '',
    linkedin_url: '',
    talk_title: '',
    talk_synopsis: '',
    speaker_bio: '',
    talk_duration_minutes: null,
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isSuccess, setIsSuccess] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)

  // Profile image state
  const [profileImage, setProfileImage] = useState<File | null>(null)
  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Check if user profile has sufficient data (name and avatar at minimum)
  const hasCompleteProfile = userProfile &&
    userProfile.first_name &&
    userProfile.last_name &&
    userProfile.avatar_url

  // Initialize form with user profile data when available
  useEffect(() => {
    if (userProfile) {
      setFormData(prev => ({
        ...prev,
        email: userProfile.email || prev.email,
        first_name: userProfile.first_name || prev.first_name,
        last_name: userProfile.last_name || prev.last_name,
        company: userProfile.company || prev.company,
        job_title: userProfile.job_title || prev.job_title,
        linkedin_url: userProfile.linkedin_url || prev.linkedin_url,
      }))
      // Set existing avatar as preview
      if (userProfile.avatar_url) {
        setProfileImagePreview(userProfile.avatar_url)
      }
    }
  }, [userProfile])

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required'
    } else if (!validateEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address'
    }

    if (!formData.first_name.trim()) {
      newErrors.first_name = 'First name is required'
    }

    if (!formData.last_name.trim()) {
      newErrors.last_name = 'Last name is required'
    }

    if (!formData.company.trim()) {
      newErrors.company = 'Company is required'
    }

    if (!formData.job_title.trim()) {
      newErrors.job_title = 'Job title is required'
    }

    // Only require profile image if user doesn't already have one
    if (!profileImage && !userProfile?.avatar_url) {
      newErrors.profile_image = 'Profile photo is required'
    }

    if (!formData.talk_title.trim()) {
      newErrors.talk_title = 'Talk title is required'
    }

    if (!formData.talk_synopsis.trim()) {
      newErrors.talk_synopsis = 'Talk synopsis is required'
    } else if (formData.talk_synopsis.trim().length < 50) {
      newErrors.talk_synopsis = 'Please provide a more detailed synopsis (at least 50 characters)'
    }

    // Validate duration selection if options are available
    if (availableDurationOptions.length > 0 && !formData.talk_duration_minutes) {
      newErrors.talk_duration_minutes = 'Please select a talk duration'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    if (errors[name as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [name]: undefined }))
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      setSubmitError('Please upload a JPEG, PNG, WebP, or GIF image')
      return
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setSubmitError('Image must be less than 5MB')
      return
    }

    setProfileImage(file)
    setSubmitError(null)

    // Create preview
    const reader = new FileReader()
    reader.onloadend = () => {
      setProfileImagePreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveImage = () => {
    setProfileImage(null)
    setProfileImagePreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const uploadProfileImage = async (): Promise<string | null> => {
    if (!profileImage) return null

    setIsUploadingImage(true)
    try {
      const supabase = getSupabaseClient()

      // Generate unique filename
      const fileExt = profileImage.name.split('.').pop() || 'jpg'
      const timestamp = Date.now()
      const randomStr = Math.random().toString(36).substring(2, 15)
      const fileName = `speaker-submissions/${timestamp}-${randomStr}.${fileExt}`

      // Upload to storage
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

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(fileName)

      return publicUrl
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

    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)

    try {
      // Upload profile image first if provided
      let avatarUrl: string | undefined
      if (profileImage) {
        const uploadedUrl = await uploadProfileImage()
        if (uploadedUrl) {
          avatarUrl = uploadedUrl
        }
      }

      const config = getClientBrandConfig()

      const response = await fetch(`${config.supabaseUrl}/functions/v1/speaker-submission`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.supabaseAnonKey,
        },
        body: JSON.stringify({
          email: formData.email.toLowerCase().trim(),
          event_id: event.event_id,
          first_name: formData.first_name.trim(),
          last_name: formData.last_name.trim(),
          company: formData.company.trim() || undefined,
          job_title: formData.job_title.trim() || undefined,
          linkedin_url: formData.linkedin_url.trim() || undefined,
          talk_title: formData.talk_title.trim(),
          talk_synopsis: formData.talk_synopsis.trim(),
          talk_duration_minutes: formData.talk_duration_minutes || undefined,
          speaker_bio: formData.speaker_bio.trim() || undefined,
          avatar_url: avatarUrl,
          source: 'event_portal',
          initial_status: initialStatus,
        }),
      })

      const result: SpeakerSubmissionResponse = await response.json()

      if (!result.success) {
        console.error('Speaker submission error:', result.error)
        setSubmitError(result.error || 'Submission failed. Please try again.')
        return
      }

      // Redirect to success page with the edit token
      const eventIdentifier = event.event_slug || event.event_id
      const successUrl = new URL(`/events/${eventIdentifier}/talks/success`, window.location.origin)
      if (result.edit_token) {
        successUrl.searchParams.set('token', result.edit_token)
      }
      if (result.already_submitted) {
        successUrl.searchParams.set('existing', 'true')
      }

      // Store form data in sessionStorage for display on success page
      sessionStorage.setItem('speakerSubmission', JSON.stringify({
        email: formData.email,
        first_name: formData.first_name,
        last_name: formData.last_name,
        company: formData.company,
        job_title: formData.job_title,
        talk_title: formData.talk_title,
        talk_synopsis: formData.talk_synopsis,
        event_title: event.event_title,
        status: initialStatus,
      }))

      onSuccess?.()
      // Show redirecting state while navigating
      setIsRedirecting(true)
      router.push(successUrl.toString())
    } catch (err) {
      console.error('Speaker submission error:', err)
      setSubmitError('An unexpected error occurred. Please try again.')
      setIsSubmitting(false)
    }
  }

  // Success state
  if (isSuccess) {
    return (
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: `${primaryColor}${useDarkTheme ? '40' : '20'}` }}>
          <svg className="w-8 h-8" style={{ color: primaryColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className={`text-2xl font-bold ${theme.heading} mb-2`}>
          {alreadySubmitted ? 'Already submitted!' : 'Application received!'}
        </h2>
        <p className="text-white/90 mb-4">
          {alreadySubmitted
            ? `You've already submitted a speaker application for ${stripEmojis(event.event_title)}.`
            : `Thank you for submitting your talk for ${stripEmojis(event.event_title)}.`}
        </p>
        <p className={`${theme.subtext} text-sm`}>
          {alreadySubmitted
            ? "We'll review your existing application and get back to you soon."
            : "We'll review your application and get back to you soon."}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div>
        <h2 className={`text-2xl sm:text-3xl font-bold ${theme.heading} mb-6`}>{isAdditionalTalk ? 'Submit another talk...' : 'Submit a talk...'}</h2>

        {submitError && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/20 border border-red-400/50">
            <p className="text-red-300 text-sm">{submitError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Personal Information Section - hidden when submitting additional talk with complete profile */}
          {!(isAdditionalTalk && hasCompleteProfile) && (
          <div>
            <h3 className={`text-lg font-semibold ${theme.label} mb-4 uppercase tracking-wide`}>About You</h3>

            {/* Show read-only profile card when user has complete profile */}
            {hasCompleteProfile ? (
              <div className={`rounded-xl p-4 ${useDarkTheme ? 'bg-black/30' : 'bg-black/20'} border ${theme.inputBorder}`}>
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  <div className={`w-16 h-16 rounded-full overflow-hidden flex-shrink-0 border-2 ${
                    useDarkTheme ? 'border-gray-600' : 'border-white/50'
                  }`}>
                    <img
                      src={userProfile.avatar_url!}
                      alt={`${userProfile.first_name} ${userProfile.last_name}`}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold ${theme.label} text-lg`}>
                      {userProfile.first_name} {userProfile.last_name}
                    </p>
                    {(userProfile.job_title || userProfile.company) && (
                      <p className={`${theme.subtext} text-sm`}>
                        {[userProfile.job_title, userProfile.company].filter(Boolean).join(' at ')}
                      </p>
                    )}
                    <p className={`${theme.subtext} text-sm`}>
                      {userProfile.email}
                    </p>
                  </div>
                </div>

                {/* Edit Profile Link */}
                <div className="mt-4 pt-3 border-t border-white/10">
                  <Link
                    href="/profile"
                    className={`inline-flex items-center gap-1.5 text-sm font-medium ${theme.subtext} hover:text-white transition-colors`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit your profile
                  </Link>
                </div>
              </div>
            ) : (
              /* Show editable form fields when profile is incomplete */
              <div className="space-y-4">
                {/* Email */}
                <div>
                  <label htmlFor="email" className={`block text-base font-medium ${theme.label} mb-2`}>
                    Email <span className={theme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                  </label>
                  <GlowInput
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    glowColor={primaryColor}
                    borderRadius="0.5rem"
                    className={`w-full text-base px-4 py-2.5 border rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors ${
                      errors.email
                        ? `${theme.errorInputBorder}`
                        : `${theme.inputBorder}`
                    }`}
                    disabled={isSubmitting}
                  />
                  {errors.email && <p className={`mt-1 text-sm ${theme.errorText}`}>{errors.email}</p>}
                </div>

                {/* Name row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="first_name" className={`block text-base font-medium ${theme.label} mb-2`}>
                      First name <span className={theme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                    </label>
                    <GlowInput
                      type="text"
                      id="first_name"
                      name="first_name"
                      value={formData.first_name}
                      onChange={handleChange}
                      glowColor={primaryColor}
                      borderRadius="0.5rem"
                      className={`w-full text-base px-4 py-2.5 border rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors ${
                        errors.first_name
                          ? `${theme.errorInputBorder}`
                          : `${theme.inputBorder}`
                      }`}
                      disabled={isSubmitting}
                    />
                    {errors.first_name && <p className={`mt-1 text-sm ${theme.errorText}`}>{errors.first_name}</p>}
                  </div>

                  <div>
                    <label htmlFor="last_name" className={`block text-base font-medium ${theme.label} mb-2`}>
                      Last name <span className={theme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                    </label>
                    <GlowInput
                      type="text"
                      id="last_name"
                      name="last_name"
                      value={formData.last_name}
                      onChange={handleChange}
                      glowColor={primaryColor}
                      borderRadius="0.5rem"
                      className={`w-full text-base px-4 py-2.5 border rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors ${
                        errors.last_name
                          ? `${theme.errorInputBorder}`
                          : `${theme.inputBorder}`
                      }`}
                      disabled={isSubmitting}
                    />
                    {errors.last_name && <p className={`mt-1 text-sm ${theme.errorText}`}>{errors.last_name}</p>}
                  </div>
                </div>

                {/* Company & Job Title */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="company" className={`block text-base font-medium ${theme.label} mb-2`}>
                      Company <span className={theme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                    </label>
                    <GlowInput
                      type="text"
                      id="company"
                      name="company"
                      value={formData.company}
                      onChange={handleChange}
                      glowColor={primaryColor}
                      borderRadius="0.5rem"
                      className={`w-full text-base px-4 py-2.5 border rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors ${
                        errors.company
                          ? `${theme.errorInputBorder}`
                          : `${theme.inputBorder}`
                      }`}
                      disabled={isSubmitting}
                    />
                    {errors.company && <p className={`mt-1 text-sm ${theme.errorText}`}>{errors.company}</p>}
                  </div>

                  <div>
                    <label htmlFor="job_title" className={`block text-base font-medium ${theme.label} mb-2`}>
                      Job title <span className={theme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                    </label>
                    <GlowInput
                      type="text"
                      id="job_title"
                      name="job_title"
                      value={formData.job_title}
                      onChange={handleChange}
                      glowColor={primaryColor}
                      borderRadius="0.5rem"
                      className={`w-full text-base px-4 py-2.5 border rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors ${
                        errors.job_title
                          ? `${theme.errorInputBorder}`
                          : `${theme.inputBorder}`
                      }`}
                      disabled={isSubmitting}
                    />
                    {errors.job_title && <p className={`mt-1 text-sm ${theme.errorText}`}>{errors.job_title}</p>}
                  </div>
                </div>

                {/* LinkedIn */}
                <div>
                  <label htmlFor="linkedin_url" className={`block text-base font-medium ${theme.label} mb-2`}>
                    LinkedIn profile
                  </label>
                  <GlowInput
                    type="url"
                    id="linkedin_url"
                    name="linkedin_url"
                    value={formData.linkedin_url}
                    onChange={handleChange}
                    glowColor={primaryColor}
                    borderRadius="0.5rem"
                    className={`w-full text-base px-4 py-2.5 border ${theme.inputBorder} rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors`}
                    disabled={isSubmitting}
                  />
                </div>

                {/* Profile Image Upload */}
                <div>
                  <label className={`block text-base font-medium ${theme.label} mb-2`}>
                    Profile photo <span className={theme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                  </label>
                  <div className="flex items-start gap-4">
                    {/* Preview or placeholder */}
                    <div
                      className={`w-20 h-20 rounded-full overflow-hidden flex-shrink-0 border-2 ${
                        useDarkTheme ? 'border-gray-600 bg-gray-700' : 'border-gray-200 bg-gray-100'
                      }`}
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
                            className={`w-8 h-8 ${useDarkTheme ? 'text-gray-500' : 'text-gray-400'}`}
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
                    </div>

                    {/* Upload controls */}
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
                          className="cursor-pointer px-3 py-1.5 text-sm font-medium rounded-lg border border-white/30 bg-white/10 text-white hover:bg-white/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {profileImage ? 'Change photo' : 'Upload photo'}
                        </button>
                        {profileImage && (
                          <button
                            type="button"
                            onClick={handleRemoveImage}
                            disabled={isSubmitting}
                            className={`cursor-pointer px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                              useDarkTheme
                                ? 'text-red-400 hover:text-red-300'
                                : 'text-red-600 hover:text-red-700'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-white/70">
                        JPG, PNG, WebP or GIF. Max 5MB.
                      </p>
                      {errors.profile_image && <p className={`mt-1 text-sm ${theme.errorText}`}>{errors.profile_image}</p>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Divider - hidden when About You section is hidden */}
          {!(isAdditionalTalk && hasCompleteProfile) && (
            <div className={`border-t ${theme.sectionBorder}`} />
          )}

          {/* Talk Information Section */}
          <div>
            <h3 className={`text-lg font-semibold ${theme.label} mb-4 uppercase tracking-wide`}>Your Talk</h3>
            <div className="space-y-4">
              {/* Talk Title */}
              <div>
                <label htmlFor="talk_title" className={`block text-base font-medium ${theme.label} mb-2`}>
                  Talk title <span className={theme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                </label>
                <GlowInput
                  type="text"
                  id="talk_title"
                  name="talk_title"
                  value={formData.talk_title}
                  onChange={handleChange}
                  placeholder="e.g., Building Scalable ML Pipelines with Kubernetes"
                  glowColor={primaryColor}
                  borderRadius="0.5rem"
                  className={`w-full text-base px-4 py-2.5 border rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors ${
                    errors.talk_title
                      ? `${theme.errorInputBorder}`
                      : `${theme.inputBorder}`
                  }`}
                  disabled={isSubmitting}
                />
                {errors.talk_title && <p className={`mt-1 text-sm ${theme.errorText}`}>{errors.talk_title}</p>}
              </div>

              {/* Talk Duration - only show if options are available */}
              {availableDurationOptions.length > 0 && (
                <div>
                  <label className={`block text-base font-medium ${theme.label} mb-2`}>
                    Talk duration <span className={theme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {availableDurationOptions.map((option) => {
                      const isSelected = formData.talk_duration_minutes === option.duration
                      return (
                        <button
                          key={option.duration}
                          type="button"
                          onClick={() => {
                            setFormData(prev => ({ ...prev, talk_duration_minutes: option.duration }))
                            if (errors.talk_duration_minutes) {
                              setErrors(prev => ({ ...prev, talk_duration_minutes: undefined }))
                            }
                          }}
                          disabled={isSubmitting}
                          className={`px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 border-2 ${
                            isSelected
                              ? ''
                              : `${theme.inputBg} ${theme.inputText} ${theme.inputBorder} hover:border-white/50`
                          } disabled:opacity-50`}
                          style={isSelected ? {
                            backgroundColor: primaryColor,
                            borderColor: primaryColor,
                            color: isLightColor(primaryColor) ? '#000000' : '#ffffff',
                          } : undefined}
                        >
                          {option.duration} min
                        </button>
                      )
                    })}
                  </div>
                  {errors.talk_duration_minutes && (
                    <p className={`mt-1 text-sm ${theme.errorText}`}>{errors.talk_duration_minutes}</p>
                  )}
                </div>
              )}

              {/* Talk Synopsis */}
              <div>
                <label htmlFor="talk_synopsis" className={`block text-base font-medium ${theme.label} mb-2`}>
                  Talk synopsis <span className={theme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                </label>
                <GlowTextarea
                  id="talk_synopsis"
                  name="talk_synopsis"
                  rows={4}
                  value={formData.talk_synopsis}
                  onChange={handleChange}
                  placeholder="Describe your talk, what attendees will learn, and why it's relevant..."
                  glowColor={primaryColor}
                  borderRadius="0.5rem"
                  className={`w-full text-base px-4 py-2.5 border rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors resize-none ${
                    errors.talk_synopsis
                      ? `${theme.errorInputBorder}`
                      : `${theme.inputBorder}`
                  }`}
                  disabled={isSubmitting}
                />
                {errors.talk_synopsis && <p className={`mt-1 text-sm ${theme.errorText}`}>{errors.talk_synopsis}</p>}
                <p className={`mt-1 text-xs ${theme.subtext}`}>
                  {formData.talk_synopsis.length}/500 characters (minimum 50)
                </p>
              </div>

              {/* Speaker Bio */}
              <div>
                <label htmlFor="speaker_bio" className={`block text-base font-medium ${theme.label} mb-2`}>
                  Speaker bio
                </label>
                <GlowTextarea
                  id="speaker_bio"
                  name="speaker_bio"
                  rows={3}
                  value={formData.speaker_bio}
                  onChange={handleChange}
                  placeholder="A brief bio about yourself and your expertise..."
                  glowColor={primaryColor}
                  borderRadius="0.5rem"
                  className={`w-full text-base px-4 py-2.5 border ${theme.inputBorder} rounded-lg ${theme.inputBg} ${theme.inputText} ${theme.inputPlaceholder} focus:outline-none transition-colors resize-none`}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          </div>

          {/* Submit buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <PortalButton
              type="submit"
              variant="primary"
              primaryColor={primaryColor}
              disabled={isSubmitting}
              isLoading={isSubmitting}
              glow={true}
              className="flex-1"
            >
              {isRedirecting ? 'Redirecting...' : isUploadingImage ? 'Uploading photo...' : isSubmitting ? 'Submitting...' : 'Submit Talk'}
            </PortalButton>
            {onCancel && (
              <PortalButton
                variant="secondary"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancel
              </PortalButton>
            )}
          </div>

        </form>
      </div>
    </div>
  )
}
