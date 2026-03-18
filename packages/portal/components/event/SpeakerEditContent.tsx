'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getClientBrandConfig, isLightColor } from '@/config/brand'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { GlowInput, GlowTextarea } from '@/components/ui/GlowInput'
import { PortalButton } from '@/components/ui/PortalButton'
import { useAuth } from '@/hooks/useAuth'
import { useEventContext } from './EventContext'

interface Props {
  editToken?: string
  confirmedDurationCounts?: Record<number, number>
}

interface SpeakerData {
  id: string
  status: string
  talk_id?: string
  talk_title: string
  talk_synopsis: string
  talk_duration_minutes: number | null
  speaker_bio: string | null
  speaker_title: string | null
  first_name: string
  last_name: string
  email: string
  company: string | null
  job_title: string | null
  linkedin_url: string | null
  avatar_url: string | null
}

interface FormData {
  first_name: string
  last_name: string
  company: string
  job_title: string
  linkedin_url: string
  talk_title: string
  talk_synopsis: string
  talk_duration_minutes: number | null
  speaker_bio: string
}

interface FormErrors {
  first_name?: string
  last_name?: string
  company?: string
  job_title?: string
  profile_image?: string
  talk_title?: string
  talk_synopsis?: string
  talk_duration_minutes?: string
}

export function SpeakerEditContent({ editToken, confirmedDurationCounts = {} }: Props) {
  const router = useRouter()
  const { event, useDarkText, primaryColor, eventIdentifier } = useEventContext()
  const { session, isLoading: authLoading } = useAuth()

  const durationOptions = event.talk_duration_options || []

  const panelTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelText: useDarkText ? 'text-white' : 'text-gray-900',
    panelTextMuted: useDarkText ? 'text-gray-300' : 'text-gray-500',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    heading: 'text-white',
    subtext: 'text-white/70',
    requiredClass: 'text-[10px] font-semibold text-white/70 uppercase tracking-wide px-1.5 py-0.5 rounded ml-1.5',
    label: 'text-white',
    inputBg: useDarkText ? 'bg-black/40' : 'bg-white/60',
    inputText: 'text-gray-900',
    inputPlaceholder: 'placeholder-gray-500',
    inputBorder: useDarkText ? 'border-white/20' : 'border-white/30',
    errorBg: 'bg-red-500/20',
    errorBorder: 'border-red-400/50',
    errorText: 'text-red-300',
    errorInputBorder: 'border-red-400/50',
    sectionBorder: 'border-white/20',
  }), [useDarkText])

  // State
  const [speakerData, setSpeakerData] = useState<SpeakerData | null>(null)
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formData, setFormData] = useState<FormData>({
    first_name: '',
    last_name: '',
    company: '',
    job_title: '',
    linkedin_url: '',
    talk_title: '',
    talk_synopsis: '',
    talk_duration_minutes: null,
    speaker_bio: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Profile image state
  const [profileImage, setProfileImage] = useState<File | null>(null)
  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(null)
  const [existingAvatarUrl, setExistingAvatarUrl] = useState<string | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasFetchedRef = useRef(false)

  // Fetch speaker data
  useEffect(() => {
    async function fetchSpeakerData() {
      if (hasFetchedRef.current) return

      if (!editToken && authLoading) return

      if (!editToken && !session) {
        setLoadError('Please sign in to edit your submission')
        setIsLoadingData(false)
        return
      }

      try {
        const config = getClientBrandConfig()
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
          global: { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} }
        })

        let talkData: any = null
        let speakerRecordData: any = null
        let memberProfile: any = null

        if (editToken) {
          const { data: talk, error: talkError } = await supabase
            .from('event_talks')
            .select(`
              id,
              title,
              synopsis,
              duration_minutes,
              status,
              edit_token,
              event_talk_speakers!inner (
                speaker_id,
                is_primary,
                speaker:event_speakers!speaker_id (
                  id,
                  speaker_bio,
                  speaker_title,
                  edit_token,
                  member_profiles!inner (
                    id,
                    customer_id,
                    customers!inner (
                      id,
                      email,
                      auth_user_id,
                      attributes,
                      avatar_source,
                      avatar_storage_path
                    )
                  )
                )
              )
            `)
            .eq('edit_token', editToken)
            .maybeSingle()

          if (!talkError && talk) {
            talkData = talk
            const primaryTalkSpeaker = (talk.event_talk_speakers as any[])?.find((ts: any) => ts.is_primary) || talk.event_talk_speakers?.[0]
            if (primaryTalkSpeaker?.speaker) {
              speakerRecordData = primaryTalkSpeaker.speaker
              memberProfile = speakerRecordData.member_profiles
            }
          }
        }

        if (!talkData && !speakerRecordData) {
          let speakerQuery = supabase
            .from('event_speakers')
            .select(`
              id,
              status,
              talk_title,
              talk_synopsis,
              talk_duration_minutes,
              speaker_bio,
              speaker_title,
              edit_token,
              member_profiles!inner (
                id,
                customer_id,
                customers!inner (
                  id,
                  email,
                  auth_user_id,
                  attributes,
                  avatar_source,
                  avatar_storage_path
                )
              )
            `)

          if (editToken) {
            speakerQuery = speakerQuery.eq('edit_token', editToken)
          } else if (event.id) {
            speakerQuery = speakerQuery.eq('event_uuid', event.id)
          }

          const { data, error } = await speakerQuery.maybeSingle()

          if (error) {
            console.error('Error fetching speaker data:', error)
            setLoadError('Failed to load submission data')
            setIsLoadingData(false)
            return
          }

          if (!data) {
            setLoadError('Submission not found')
            setIsLoadingData(false)
            return
          }

          speakerRecordData = data
          memberProfile = data.member_profiles
        }

        if (!speakerRecordData) {
          setLoadError('Submission not found')
          setIsLoadingData(false)
          return
        }

        const typedMemberProfile = memberProfile as unknown as {
          id: string
          customer_id: string
          customers: {
            id: string
            email: string
            auth_user_id: string | null
            attributes: Record<string, string> | null
            avatar_source: string | null
            avatar_storage_path: string | null
          }
        }

        const customerAttrs = typedMemberProfile?.customers?.attributes || {}

        let avatarUrl: string | null = null
        if (typedMemberProfile?.customers?.avatar_storage_path) {
          const { data: { publicUrl } } = supabase.storage
            .from('media')
            .getPublicUrl(typedMemberProfile.customers.avatar_storage_path)
          avatarUrl = publicUrl
        }

        const speaker: SpeakerData = {
          id: speakerRecordData.id,
          talk_id: talkData?.id,
          status: talkData?.status || speakerRecordData.status,
          talk_title: talkData?.title || speakerRecordData.talk_title || '',
          talk_synopsis: talkData?.synopsis || speakerRecordData.talk_synopsis || '',
          talk_duration_minutes: talkData?.duration_minutes ?? speakerRecordData.talk_duration_minutes,
          speaker_bio: speakerRecordData.speaker_bio,
          speaker_title: speakerRecordData.speaker_title,
          first_name: customerAttrs.first_name || '',
          last_name: customerAttrs.last_name || '',
          email: typedMemberProfile?.customers?.email || '',
          company: customerAttrs.company,
          job_title: customerAttrs.job_title,
          linkedin_url: customerAttrs.linkedin_url,
          avatar_url: avatarUrl,
        }

        setSpeakerData(speaker)
        setExistingAvatarUrl(avatarUrl)
        setFormData({
          first_name: speaker.first_name,
          last_name: speaker.last_name,
          company: speaker.company || '',
          job_title: speaker.job_title || '',
          linkedin_url: speaker.linkedin_url || '',
          talk_title: speaker.talk_title,
          talk_synopsis: speaker.talk_synopsis,
          talk_duration_minutes: speaker.talk_duration_minutes,
          speaker_bio: speaker.speaker_bio || '',
        })
        hasFetchedRef.current = true
        setIsLoadingData(false)
      } catch (err) {
        console.error('Error fetching speaker:', err)
        setLoadError('Failed to load submission data')
        setIsLoadingData(false)
      }
    }

    fetchSpeakerData()
  }, [editToken, session, authLoading, event.id])

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}

    if (!formData.first_name.trim()) newErrors.first_name = 'First name is required'
    if (!formData.last_name.trim()) newErrors.last_name = 'Last name is required'
    if (!formData.company.trim()) newErrors.company = 'Company is required'
    if (!formData.job_title.trim()) newErrors.job_title = 'Job title is required'
    if (!formData.talk_title.trim()) newErrors.talk_title = 'Talk title is required'
    if (!formData.talk_synopsis.trim()) {
      newErrors.talk_synopsis = 'Talk synopsis is required'
    } else if (formData.talk_synopsis.trim().length < 50) {
      newErrors.talk_synopsis = 'Please provide a more detailed synopsis (at least 50 characters)'
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
    if (errors.profile_image) {
      setErrors(prev => ({ ...prev, profile_image: undefined }))
    }

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
      const { createClient } = await import('@supabase/supabase-js')
      const config = getClientBrandConfig()
      const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)

      const fileExt = profileImage.name.split('.').pop() || 'jpg'
      const timestamp = Date.now()
      const randomStr = Math.random().toString(36).substring(2, 15)
      const fileName = `speaker-submissions/${timestamp}-${randomStr}.${fileExt}`

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

    if (!validateForm()) return
    if (!speakerData) {
      setSubmitError('No speaker data loaded')
      return
    }

    setIsSubmitting(true)

    try {
      let avatarUrl: string | undefined
      if (profileImage) {
        const uploadedUrl = await uploadProfileImage()
        if (uploadedUrl) {
          avatarUrl = uploadedUrl
        }
      }

      const config = getClientBrandConfig()

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'apikey': config.supabaseAnonKey,
      }

      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const requestBody: Record<string, any> = {
        speaker_id: speakerData.id,
        talk_id: speakerData.talk_id,
        edit_token: editToken,
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        company: formData.company.trim() || undefined,
        job_title: formData.job_title.trim() || undefined,
        linkedin_url: formData.linkedin_url.trim() || undefined,
        talk_title: formData.talk_title.trim(),
        talk_synopsis: formData.talk_synopsis.trim(),
        talk_duration_minutes: formData.talk_duration_minutes || undefined,
        speaker_bio: formData.speaker_bio.trim() || undefined,
      }

      if (avatarUrl) {
        requestBody.avatar_url = avatarUrl
      }

      const response = await fetch(`${config.supabaseUrl}/functions/v1/speaker-update`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      })

      const result = await response.json()

      if (!result.success) {
        console.error('Speaker update error:', result.error)
        setSubmitError(result.error || 'Update failed. Please try again.')
        return
      }

      const newStatus = result.status_changed ? 'pending' : speakerData.status
      sessionStorage.setItem('speakerSubmission', JSON.stringify({
        email: speakerData.email,
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        company: formData.company.trim(),
        job_title: formData.job_title.trim(),
        talk_title: formData.talk_title.trim(),
        talk_synopsis: formData.talk_synopsis.trim(),
        event_title: event.event_title,
        status: newStatus,
      }))

      setIsRedirecting(true)
      const successUrl = `/events/${eventIdentifier}/talks/success?token=${editToken}&updated=true${result.status_changed ? '&status_reset=true' : ''}`
      router.push(successUrl)
    } catch (err) {
      console.error('Speaker update error:', err)
      setSubmitError('An unexpected error occurred. Please try again.')
      setIsSubmitting(false)
    }
  }

  // Loading state
  if (isLoadingData || authLoading) {
    return (
      <div className="text-center py-12">
        <div
          className="loader mx-auto mb-4"
          style={{
            '--primary-color': '#fff',
            '--secondary-color': primaryColor,
          } as React.CSSProperties}
        />
        <p className={panelTheme.panelTextMuted}>Loading submission...</p>
      </div>
    )
  }

  // Error state
  if (loadError) {
    return (
      <GlowBorder borderRadius="1rem" useDarkTheme={useDarkText}>
        <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8 text-center`}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center bg-red-500/30">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className={`text-xl font-bold ${panelTheme.panelText} mb-2`}>{loadError}</h2>
          {loadError.includes('sign in') ? (
            <div className="mt-4 space-y-3">
              <Link
                href={`/sign-in?redirectTo=/events/${eventIdentifier}/talks/edit${editToken ? `?token=${editToken}` : ''}`}
                className="block px-6 py-3 font-semibold rounded-lg transition-all hover:opacity-90 cursor-pointer"
                style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}
              >
                Sign In
              </Link>
              <Link
                href={`/events/${eventIdentifier}`}
                className="block px-6 py-3 font-medium rounded-lg border transition-colors border-white/30 text-white hover:bg-white/10 cursor-pointer"
              >
                Back to event
              </Link>
            </div>
          ) : (
            <Link
              href={`/events/${eventIdentifier}`}
              className="inline-block mt-4 px-6 py-3 font-medium rounded-lg border transition-colors border-white/30 text-white hover:bg-white/10 cursor-pointer"
            >
              Back to event
            </Link>
          )}
        </div>
      </GlowBorder>
    )
  }

  // Cannot edit rejected submissions
  if (speakerData?.status === 'rejected') {
    return (
      <GlowBorder borderRadius="1rem" useDarkTheme={useDarkText}>
        <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8 text-center`}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center bg-gray-500/30">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 className={`text-xl font-bold ${panelTheme.panelText} mb-2`}>Cannot edit</h2>
          <p className={panelTheme.panelTextMuted}>
            This submission has been rejected and cannot be edited.
          </p>
          <Link
            href={`/events/${eventIdentifier}`}
            className="inline-block mt-6 px-6 py-3 font-medium rounded-lg border transition-colors border-white/30 text-white hover:bg-white/10 cursor-pointer"
          >
            Back to event
          </Link>
        </div>
      </GlowBorder>
    )
  }

  // Edit form
  return (
    <GlowBorder borderRadius="1rem" useDarkTheme={useDarkText}>
      <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
        {/* Header */}
        <div className="mb-6">
          <h1 className={`text-2xl sm:text-3xl font-bold ${panelTheme.heading} mb-2`}>
            Edit submission
          </h1>

          {/* Status badge */}
          <div className="mt-3">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              speakerData?.status === 'approved' ? 'bg-blue-500/20 text-blue-300' :
              speakerData?.status === 'confirmed' ? 'bg-blue-500/20 text-blue-300' :
              speakerData?.status === 'reserve' ? 'bg-purple-500/20 text-purple-300' :
              'bg-yellow-500/20 text-yellow-300'
            }`}>
              Status: {speakerData?.status || 'pending'}
            </span>
          </div>

          {/* Warning about status reset */}
          {(speakerData?.status === 'approved' || speakerData?.status === 'confirmed') && (
            <div className="mt-4 rounded-lg p-3 bg-yellow-500/20 border border-yellow-400/30">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-sm text-yellow-200/90">
                  Changing your talk title or synopsis will reset your status to pending for re-review.
                </p>
              </div>
            </div>
          )}
        </div>

        {submitError && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/20 border border-red-400/50">
            <p className="text-red-300 text-sm">{submitError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Personal Information Section */}
          <div>
            <h3 className={`text-lg font-semibold ${panelTheme.label} mb-4 uppercase tracking-wide`}>About You</h3>
            <div className="space-y-4">
              {/* Email (read-only) */}
              <div>
                <label className={`block text-base font-medium ${panelTheme.label} mb-2`}>
                  Email
                </label>
                <div className={`w-full text-base px-4 py-2.5 border ${panelTheme.inputBorder} rounded-lg ${panelTheme.inputBg} text-gray-500`}>
                  {speakerData?.email}
                </div>
                <p className={`mt-1 text-xs ${panelTheme.subtext}`}>Email cannot be changed</p>
              </div>

              {/* Name row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="first_name" className={`block text-base font-medium ${panelTheme.label} mb-2`}>
                    First name <span className={panelTheme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                  </label>
                  <GlowInput
                    type="text"
                    id="first_name"
                    name="first_name"
                    value={formData.first_name}
                    onChange={handleChange}
                    glowColor={primaryColor}
                    borderRadius="0.5rem"
                    className={`w-full text-base px-4 py-2.5 border rounded-lg ${panelTheme.inputBg} ${panelTheme.inputText} ${panelTheme.inputPlaceholder} focus:outline-none transition-colors ${
                      errors.first_name ? panelTheme.errorInputBorder : panelTheme.inputBorder
                    }`}
                    disabled={isSubmitting}
                  />
                  {errors.first_name && <p className={`mt-1 text-sm ${panelTheme.errorText}`}>{errors.first_name}</p>}
                </div>

                <div>
                  <label htmlFor="last_name" className={`block text-base font-medium ${panelTheme.label} mb-2`}>
                    Last name <span className={panelTheme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                  </label>
                  <GlowInput
                    type="text"
                    id="last_name"
                    name="last_name"
                    value={formData.last_name}
                    onChange={handleChange}
                    glowColor={primaryColor}
                    borderRadius="0.5rem"
                    className={`w-full text-base px-4 py-2.5 border rounded-lg ${panelTheme.inputBg} ${panelTheme.inputText} ${panelTheme.inputPlaceholder} focus:outline-none transition-colors ${
                      errors.last_name ? panelTheme.errorInputBorder : panelTheme.inputBorder
                    }`}
                    disabled={isSubmitting}
                  />
                  {errors.last_name && <p className={`mt-1 text-sm ${panelTheme.errorText}`}>{errors.last_name}</p>}
                </div>
              </div>

              {/* Company & Job Title */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="company" className={`block text-base font-medium ${panelTheme.label} mb-2`}>
                    Company <span className={panelTheme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                  </label>
                  <GlowInput
                    type="text"
                    id="company"
                    name="company"
                    value={formData.company}
                    onChange={handleChange}
                    glowColor={primaryColor}
                    borderRadius="0.5rem"
                    className={`w-full text-base px-4 py-2.5 border rounded-lg ${panelTheme.inputBg} ${panelTheme.inputText} ${panelTheme.inputPlaceholder} focus:outline-none transition-colors ${
                      errors.company ? panelTheme.errorInputBorder : panelTheme.inputBorder
                    }`}
                    disabled={isSubmitting}
                  />
                  {errors.company && <p className={`mt-1 text-sm ${panelTheme.errorText}`}>{errors.company}</p>}
                </div>

                <div>
                  <label htmlFor="job_title" className={`block text-base font-medium ${panelTheme.label} mb-2`}>
                    Job title <span className={panelTheme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
                  </label>
                  <GlowInput
                    type="text"
                    id="job_title"
                    name="job_title"
                    value={formData.job_title}
                    onChange={handleChange}
                    glowColor={primaryColor}
                    borderRadius="0.5rem"
                    className={`w-full text-base px-4 py-2.5 border rounded-lg ${panelTheme.inputBg} ${panelTheme.inputText} ${panelTheme.inputPlaceholder} focus:outline-none transition-colors ${
                      errors.job_title ? panelTheme.errorInputBorder : panelTheme.inputBorder
                    }`}
                    disabled={isSubmitting}
                  />
                  {errors.job_title && <p className={`mt-1 text-sm ${panelTheme.errorText}`}>{errors.job_title}</p>}
                </div>
              </div>

              {/* LinkedIn */}
              <div>
                <label htmlFor="linkedin_url" className={`block text-base font-medium ${panelTheme.label} mb-2`}>
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
                  className={`w-full text-base px-4 py-2.5 border ${panelTheme.inputBorder} rounded-lg ${panelTheme.inputBg} ${panelTheme.inputText} ${panelTheme.inputPlaceholder} focus:outline-none transition-colors`}
                  disabled={isSubmitting}
                />
              </div>

              {/* Profile Image Upload */}
              <div>
                <label className={`block text-base font-medium ${panelTheme.label} mb-2`}>
                  Profile photo
                </label>
                <div className="flex items-start gap-4">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSubmitting}
                    className={`w-20 h-20 rounded-full overflow-hidden flex-shrink-0 border-2 cursor-pointer transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 ${
                      useDarkText ? 'border-gray-600 bg-gray-700' : 'border-gray-200 bg-gray-100'
                    }`}
                  >
                    {profileImagePreview || existingAvatarUrl ? (
                      <img
                        src={profileImagePreview || existingAvatarUrl || ''}
                        alt="Profile preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg
                          className={`w-8 h-8 ${useDarkText ? 'text-gray-500' : 'text-gray-400'}`}
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
                        className="cursor-pointer px-3 py-1.5 text-sm font-medium rounded-lg border border-white/30 bg-white/10 text-white hover:bg-white/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {profileImage || existingAvatarUrl ? 'Change photo' : 'Upload photo'}
                      </button>
                      {(profileImage || profileImagePreview) && (
                        <button
                          type="button"
                          onClick={handleRemoveImage}
                          disabled={isSubmitting}
                          className="cursor-pointer px-3 py-1.5 text-sm font-medium rounded-lg transition-colors text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-white/70">
                      JPG, PNG, WebP or GIF. Max 5MB.
                    </p>
                    {errors.profile_image && <p className={`mt-1 text-sm ${panelTheme.errorText}`}>{errors.profile_image}</p>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className={`border-t ${panelTheme.sectionBorder}`} />

          {/* Talk Information Section */}
          <div>
            <h3 className={`text-lg font-semibold ${panelTheme.label} mb-4 uppercase tracking-wide`}>Your Talk</h3>
            <div className="space-y-4">
              {/* Talk Title */}
              <div>
                <label htmlFor="talk_title" className={`block text-base font-medium ${panelTheme.label} mb-2`}>
                  Talk title <span className={panelTheme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
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
                  className={`w-full text-base px-4 py-2.5 border rounded-lg ${panelTheme.inputBg} ${panelTheme.inputText} ${panelTheme.inputPlaceholder} focus:outline-none transition-colors ${
                    errors.talk_title ? panelTheme.errorInputBorder : panelTheme.inputBorder
                  }`}
                  disabled={isSubmitting}
                />
                {errors.talk_title && <p className={`mt-1 text-sm ${panelTheme.errorText}`}>{errors.talk_title}</p>}
              </div>

              {/* Talk Duration */}
              {durationOptions.length > 0 && (
                <div>
                  <label className={`block text-base font-medium ${panelTheme.label} mb-2`}>
                    Talk duration
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {durationOptions.map((option) => {
                      const isSelected = formData.talk_duration_minutes === option.duration
                      const confirmedCount = confirmedDurationCounts[option.duration] || 0
                      const isCurrentSelection = speakerData?.talk_duration_minutes === option.duration
                      const hasCapacity = confirmedCount < option.capacity
                      const isAvailable = isCurrentSelection || hasCapacity

                      if (!isAvailable) return null

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
                          className={`px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 border-2 cursor-pointer ${
                            isSelected
                              ? 'shadow-md'
                              : `${panelTheme.inputBg} ${panelTheme.inputText} ${panelTheme.inputBorder} hover:border-white/50`
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
                    <p className={`mt-1 text-sm ${panelTheme.errorText}`}>{errors.talk_duration_minutes}</p>
                  )}
                </div>
              )}

              {/* Talk Synopsis */}
              <div>
                <label htmlFor="talk_synopsis" className={`block text-base font-medium ${panelTheme.label} mb-2`}>
                  Talk synopsis <span className={panelTheme.requiredClass} style={{ backgroundColor: `${primaryColor}50` }}>required</span>
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
                  className={`w-full text-base px-4 py-2.5 border rounded-lg ${panelTheme.inputBg} ${panelTheme.inputText} ${panelTheme.inputPlaceholder} focus:outline-none transition-colors resize-none ${
                    errors.talk_synopsis ? panelTheme.errorInputBorder : panelTheme.inputBorder
                  }`}
                  disabled={isSubmitting}
                />
                {errors.talk_synopsis && <p className={`mt-1 text-sm ${panelTheme.errorText}`}>{errors.talk_synopsis}</p>}
                <p className={`mt-1 text-xs ${panelTheme.subtext}`}>
                  {formData.talk_synopsis.length}/500 characters (minimum 50)
                </p>
              </div>

              {/* Speaker Bio */}
              <div>
                <label htmlFor="speaker_bio" className={`block text-base font-medium ${panelTheme.label} mb-2`}>
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
                  className={`w-full text-base px-4 py-2.5 border ${panelTheme.inputBorder} rounded-lg ${panelTheme.inputBg} ${panelTheme.inputText} ${panelTheme.inputPlaceholder} focus:outline-none transition-colors resize-none`}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          </div>

          {/* Submit buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <PortalButton
              variant="primary"
              primaryColor={primaryColor}
              type="submit"
              disabled={isSubmitting}
              isLoading={isSubmitting}
              glow={true}
              className="flex-1"
            >
              {isRedirecting ? 'Redirecting...' : isUploadingImage ? 'Uploading photo...' : 'Save changes'}
            </PortalButton>
            <PortalButton
              variant="secondary"
              href={`/events/${eventIdentifier}/talks/success?token=${editToken}`}
            >
              Cancel
            </PortalButton>
          </div>
        </form>
      </div>
    </GlowBorder>
  )
}
