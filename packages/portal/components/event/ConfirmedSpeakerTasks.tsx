'use client'

import { useState, useRef, useCallback } from 'react'
import { getClientBrandConfig, isLightColor } from '@/config/brand'
import { getSupabaseClient } from '@/lib/supabase/client'
import { encodeEmail } from '@/lib/emailEncoding'
import { PortalButton } from '@/components/ui/PortalButton'
import type { Event } from '@/types/event'

interface Props {
  event: Event
  editToken?: string
  presentationUrl?: string | null
  presentationStoragePath?: string | null
  presentationType?: string | null
  speakerEmail?: string | null
  calendarAddedAt?: string | null
  trackingLinkCopiedAt?: string | null
  primaryColor: string
  theme: {
    panelBg: string
    panelText: string
    panelTextMuted: string
    panelBorder: string
    summaryBg: string
    summaryTextMuted: string
    dividerBorder: string
  }
}


export function ConfirmedSpeakerTasks({
  event,
  editToken,
  presentationUrl,
  presentationStoragePath,
  presentationType,
  speakerEmail,
  calendarAddedAt,
  trackingLinkCopiedAt,
  primaryColor,
  theme,
}: Props) {
  const [showCalendarOptions, setShowCalendarOptions] = useState(false)
  const [calendarAdded, setCalendarAdded] = useState(!!calendarAddedAt)
  const [showPresentationForm, setShowPresentationForm] = useState(false)
  const [presentationLink, setPresentationLink] = useState('')
  const [presentationFile, setPresentationFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Promote your talk state
  const [showPromoteSection, setShowPromoteSection] = useState(false)
  const [trackingLink, setTrackingLink] = useState<string | null>(null)
  const [isGeneratingLink, setIsGeneratingLink] = useState(false)
  const [promoteLinkError, setPromoteLinkError] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(!!trackingLinkCopiedAt)

  const config = getClientBrandConfig()
  const calendarBaseUrl = `${config.supabaseUrl}/functions/v1/calendar`
  const emailEncoded = speakerEmail ? encodeEmail(speakerEmail) : ''
  const eventId = event.event_id

  // Determine if presentation has been provided (from database, not local form state)
  const hasPresentation = !!(presentationUrl || presentationStoragePath)

  // Build presentation view URL
  const presentationViewUrl = (() => {
    if (presentationUrl) return presentationUrl
    if (presentationStoragePath) {
      const supabase = getSupabaseClient()
      const { data: { publicUrl } } = supabase.storage
        .from('presentation-decks')
        .getPublicUrl(presentationStoragePath)
      return publicUrl
    }
    return null
  })()

  // Track calendar click
  const handleCalendarClick = async () => {
    if (!editToken || calendarAdded) return

    try {
      const response = await fetch(`${config.supabaseUrl}/functions/v1/speaker-submissions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          apikey: config.supabaseAnonKey,
        },
        body: JSON.stringify({
          edit_token: editToken,
          calendar_added_at: new Date().toISOString(),
        }),
      })

      if (response.ok) {
        setCalendarAdded(true)
      }
    } catch (error) {
      console.error('Error tracking calendar click:', error)
    }
  }

  // Calendar URLs
  const calendarUrls = {
    google: `${calendarBaseUrl}/${eventId}/google/${emailEncoded}`,
    outlook: `${calendarBaseUrl}/${eventId}/outlook/${emailEncoded}`,
    apple: `${calendarBaseUrl}/${eventId}/apple/${emailEncoded}`,
    ics: `${calendarBaseUrl}/${eventId}/ics/${emailEncoded}`,
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type (PDF, PPT, PPTX)
    const allowedTypes = [
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Please upload a PDF or PowerPoint file')
      return
    }

    // Validate file size (50MB max)
    if (file.size > 50 * 1024 * 1024) {
      setUploadError('File must be less than 50MB')
      return
    }

    setPresentationFile(file)
    setUploadError(null)
  }

  const handleSubmitPresentation = async () => {
    if (!editToken) return

    setIsUploading(true)
    setUploadError(null)

    try {
      let uploadedUrl: string | null = null
      let storagePath: string | null = null
      let type: 'link' | 'pdf' | 'powerpoint' = 'link'

      if (presentationFile) {
        // Upload file to storage
        const supabase = getSupabaseClient()
        const fileExt = presentationFile.name.split('.').pop()?.toLowerCase() || 'pdf'
        const timestamp = Date.now()
        const randomStr = Math.random().toString(36).substring(2, 15)
        const fileName = `talks/${timestamp}-${randomStr}-presentation.${fileExt}`

        const { error: uploadErr } = await supabase.storage
          .from('presentation-decks')
          .upload(fileName, presentationFile, {
            contentType: presentationFile.type,
            cacheControl: '3600',
            upsert: false,
          })

        if (uploadErr) {
          throw new Error('Failed to upload presentation')
        }

        storagePath = fileName
        type = presentationFile.type === 'application/pdf' ? 'pdf' : 'powerpoint'
      } else if (presentationLink.trim()) {
        uploadedUrl = presentationLink.trim()
        type = 'link'
      } else {
        setUploadError('Please provide a link or upload a file')
        return
      }

      // Update the talk record via edge function
      const response = await fetch(`${config.supabaseUrl}/functions/v1/speaker-submissions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          apikey: config.supabaseAnonKey,
        },
        body: JSON.stringify({
          edit_token: editToken,
          presentation_url: uploadedUrl,
          presentation_storage_path: storagePath,
          presentation_type: type,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save presentation')
      }

      setUploadSuccess(true)
      setShowPresentationForm(false)
    } catch (error: any) {
      console.error('Error saving presentation:', error)
      setUploadError(error.message || 'Failed to save presentation')
    } finally {
      setIsUploading(false)
    }
  }

  // Generate tracking link
  const handleGenerateTrackingLink = useCallback(async () => {
    if (!editToken || trackingLink) return

    setIsGeneratingLink(true)
    setPromoteLinkError(null)

    try {
      const response = await fetch('/api/speaker-tracking-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ edit_token: editToken }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to generate tracking link')
      }

      const data = await response.json()
      if (data.success && data.short_url) {
        setTrackingLink(data.short_url)
      } else {
        throw new Error(data.error || 'Failed to generate tracking link')
      }
    } catch (error: any) {
      console.error('Error generating tracking link:', error)
      setPromoteLinkError(error.message || 'Failed to generate tracking link')
    } finally {
      setIsGeneratingLink(false)
    }
  }, [editToken, trackingLink])

  // Copy tracking link to clipboard and persist to database
  const handleCopyLink = useCallback(async () => {
    if (!trackingLink) return

    try {
      await navigator.clipboard.writeText(trackingLink)
      setLinkCopied(true)

      // Persist the copy event to the database (only if not already persisted)
      if (!trackingLinkCopiedAt && editToken) {
        try {
          await fetch(`${config.supabaseUrl}/functions/v1/speaker-submissions`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              apikey: config.supabaseAnonKey,
            },
            body: JSON.stringify({
              edit_token: editToken,
              tracking_link_copied_at: new Date().toISOString(),
            }),
          })
        } catch (err) {
          console.error('Error persisting tracking link copy:', err)
        }
      }
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }, [trackingLink, trackingLinkCopiedAt, editToken, config.supabaseUrl, config.supabaseAnonKey])

  // Completed check icon
  const CheckIcon = () => (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  )

  // Completed circle
  const CompletedCircle = () => (
    <div
      className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5"
      style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}
    >
      <CheckIcon />
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Task 1: Speaking slot confirmed */}
      <div className="flex items-start gap-3">
        <CompletedCircle />
        <div className="flex-1">
          <p className={`font-medium ${theme.panelText}`}>Speaking slot confirmed</p>
          <p className={`text-sm ${theme.panelTextMuted}`}>
            We will contact you very soon with the exact time of your talk and full logistics.
          </p>
        </div>
      </div>

      {/* Task 2: Add to calendar */}
      <div className="flex items-start gap-3">
        {calendarAdded ? (
          <CompletedCircle />
        ) : (
          <button
            onClick={() => setShowCalendarOptions(!showCalendarOptions)}
            className={`cursor-pointer flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors ${
              showCalendarOptions ? 'border-white/50 bg-white/20' : 'border-white/30 hover:border-white/50'
            }`}
          >
            {showCalendarOptions && (
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>
        )}
        <div className="flex-1">
          <button
            onClick={() => !calendarAdded && setShowCalendarOptions(!showCalendarOptions)}
            className={`cursor-pointer font-medium ${theme.panelText} text-left hover:opacity-80 transition-opacity ${calendarAdded ? 'cursor-default' : ''}`}
            disabled={calendarAdded}
          >
            Add to calendar
          </button>
          <p className={`text-sm ${theme.panelTextMuted}`}>
            {calendarAdded
              ? 'Event added to your calendar'
              : 'Add the event to your calendar so you do not miss it'}
          </p>

          {showCalendarOptions && !calendarAdded && (
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={calendarUrls.google}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleCalendarClick}
                className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm6.75 6.75h-1.5v1.5h1.5v1.5h-1.5v6h-1.5v-6h-3v6h-1.5v-6h-3v6H6.75v-6h-1.5v-1.5h1.5v-1.5h-1.5V6.75h1.5v1.5h3v-1.5h1.5v1.5h3v-1.5h1.5v-1.5h1.5v1.5z" />
                </svg>
                Google Calendar
              </a>
              <a
                href={calendarUrls.outlook}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleCalendarClick}
                className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88zM24 12v9.38q0 .46-.33.8-.33.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6.01V2.38q0-.46.33-.8.33-.32.8-.32H23.2q.46 0 .8.33.32.33.32.8V12z" />
                </svg>
                Outlook
              </a>
              <a
                href={calendarUrls.apple}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleCalendarClick}
                className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
                </svg>
                Apple Calendar
              </a>
              <a
                href={calendarUrls.ics}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleCalendarClick}
                className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Download .ics
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Task 3: Provide presentation */}
      <div className="flex items-start gap-3">
        {(hasPresentation || uploadSuccess) ? (
          <CompletedCircle />
        ) : (
          <button
            onClick={() => setShowPresentationForm(!showPresentationForm)}
            className={`cursor-pointer flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors ${
              showPresentationForm ? 'border-white/50 bg-white/20' : 'border-white/30 hover:border-white/50'
            }`}
          >
            {showPresentationForm && (
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>
        )}
        <div className="flex-1">
          <button
            onClick={() => !hasPresentation && !uploadSuccess && setShowPresentationForm(!showPresentationForm)}
            className={`cursor-pointer font-medium ${theme.panelText} text-left hover:opacity-80 transition-opacity ${(hasPresentation || uploadSuccess) ? 'cursor-default' : ''}`}
            disabled={hasPresentation || uploadSuccess}
          >
            Provide your talk presentation
          </button>
          <p className={`text-sm ${theme.panelTextMuted}`}>
            {(hasPresentation || uploadSuccess)
              ? 'Presentation has been submitted'
              : 'Upload your slides or provide a link to your presentation'}
          </p>

          {/* Show existing presentation info with view link */}
          {(presentationUrl || presentationStoragePath) && presentationViewUrl && (
            <div className="mt-2 p-2 rounded-lg bg-white/10">
              <p className={`text-sm ${theme.panelText}`}>
                <a
                  href={presentationViewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cursor-pointer text-white underline hover:opacity-80 transition-opacity inline-flex items-center gap-1"
                >
                  {presentationType === 'link' ? (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      View presentation link
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      View {presentationType === 'pdf' ? 'PDF' : 'PowerPoint'} presentation
                    </>
                  )}
                </a>
              </p>
            </div>
          )}

          {showPresentationForm && !hasPresentation && !uploadSuccess && (
            <div className="mt-3 space-y-3">
              {/* Link input */}
              <div>
                <label className={`block text-sm ${theme.panelTextMuted} mb-1`}>
                  Presentation URL (Google Slides, Canva, etc.)
                </label>
                <input
                  type="url"
                  value={presentationLink}
                  onChange={(e) => setPresentationLink(e.target.value)}
                  placeholder="https://docs.google.com/presentation/..."
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white/10 text-white placeholder-white/40 border border-white/20 focus:border-white/40 focus:outline-none"
                  disabled={isUploading || !!presentationFile}
                />
              </div>

              <div className={`text-center text-sm ${theme.panelTextMuted}`}>or</div>

              {/* File upload */}
              <div>
                <label className={`block text-sm ${theme.panelTextMuted} mb-1`}>
                  Upload PDF or PowerPoint
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.ppt,.pptx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={isUploading}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || !!presentationLink.trim()}
                    className="cursor-pointer px-3 py-2 text-sm font-medium rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {presentationFile ? 'Change file' : 'Choose file'}
                  </button>
                  {presentationFile && (
                    <span className={`text-sm ${theme.panelText}`}>
                      {presentationFile.name}
                    </span>
                  )}
                </div>
                <p className={`mt-1 text-xs ${theme.panelTextMuted}`}>
                  PDF or PowerPoint, max 50MB
                </p>
              </div>

              {/* Error message */}
              {uploadError && (
                <p className="text-sm text-red-300">{uploadError}</p>
              )}

              {/* Submit button */}
              <PortalButton
                variant="primary"
                primaryColor={primaryColor}
                onClick={handleSubmitPresentation}
                disabled={isUploading || (!presentationLink.trim() && !presentationFile)}
                isLoading={isUploading}
                size="small"
                className="w-full"
              >
                {isUploading ? 'Saving...' : 'Save Presentation'}
              </PortalButton>
            </div>
          )}
        </div>
      </div>

      {/* Task 4: Promote your talk */}
      <div className="flex items-start gap-3">
        {linkCopied ? (
          <CompletedCircle />
        ) : (
          <button
            onClick={() => {
              if (!showPromoteSection) {
                setShowPromoteSection(true)
                if (!trackingLink) {
                  handleGenerateTrackingLink()
                }
              } else {
                setShowPromoteSection(false)
              }
            }}
            className={`cursor-pointer flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors ${
              showPromoteSection ? 'border-white/50 bg-white/20' : 'border-white/30 hover:border-white/50'
            }`}
          >
            {showPromoteSection && (
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>
        )}
        <div className="flex-1">
          <button
            onClick={() => {
              if (!linkCopied) {
                setShowPromoteSection(!showPromoteSection)
                if (!showPromoteSection && !trackingLink) {
                  handleGenerateTrackingLink()
                }
              }
            }}
            className={`cursor-pointer font-medium ${theme.panelText} text-left hover:opacity-80 transition-opacity ${linkCopied ? 'cursor-default' : ''}`}
            disabled={linkCopied}
          >
            Promote your talk
          </button>
          <p className={`text-sm ${theme.panelTextMuted}`}>
            {linkCopied
              ? 'Tracking link shared'
              : 'Share your unique tracking link to drive registrations'}
          </p>

          {showPromoteSection && (
            <div className="mt-3">
              {isGeneratingLink ? (
                <div className="flex items-center gap-2">
                  <div
                    className="loader w-4 h-4"
                    style={{
                      '--primary-color': '#fff',
                      '--secondary-color': primaryColor,
                    } as React.CSSProperties}
                  />
                  <span className={`text-sm ${theme.panelTextMuted}`}>Generating your tracking link...</span>
                </div>
              ) : promoteLinkError ? (
                <div className="space-y-2">
                  <p className="text-sm text-red-300">{promoteLinkError}</p>
                  <button
                    onClick={handleGenerateTrackingLink}
                    className="cursor-pointer text-sm text-white underline hover:opacity-80 transition-opacity"
                  >
                    Try again
                  </button>
                </div>
              ) : trackingLink ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={trackingLink}
                    readOnly
                    className="flex-1 px-3 py-2 text-sm rounded-lg bg-white/10 text-white border border-white/20 focus:outline-none select-all"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <PortalButton
                    variant="secondary"
                    size="small"
                    onClick={handleCopyLink}
                    className="py-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                    Copy
                  </PortalButton>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
