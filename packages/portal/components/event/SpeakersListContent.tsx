'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { getClientBrandConfig, isLightColor } from '@/config/brand'
import { useEventContext } from './EventContext'
import { GlowBorder } from '@/components/ui/GlowBorder'

interface Speaker {
  id: string
  speaker_title: string | null
  speaker_bio: string | null
  is_featured: boolean
  full_name: string
  first_name: string | null
  last_name: string | null
  company: string | null
  job_title: string | null
  linkedin_url: string | null
  avatar_url: string | null
  company_logo_storage_path: string | null
}

export function SpeakersListContent() {
  const { event, useDarkText, primaryColor, eventIdentifier, userState } = useEventContext()
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [storageUrl, setStorageUrl] = useState('')

  const panelTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    textColor: useDarkText ? 'text-gray-900' : 'text-white',
    textMuted: useDarkText ? 'text-gray-600' : 'text-white/70',
  }), [useDarkText])

  useEffect(() => {
    async function fetchSpeakers() {
      setIsLoading(true)
      try {
        const config = getClientBrandConfig()
        setStorageUrl(config.supabaseUrl)
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)

        // Get speakers with 'confirmed' status for this event
        const { data, error } = await supabase
          .from('events_speakers_with_details')
          .select('*')
          .eq('event_uuid', event.id)
          .eq('status', 'confirmed')
          .order('is_featured', { ascending: false })
          .order('sort_order', { ascending: true })
          .order('full_name', { ascending: true })

        if (error) {
          console.error('Error fetching speakers:', error)
          return
        }

        // If no confirmed speakers, fall back to placeholder speakers
        if (!data || data.length === 0) {
          const { data: placeholderData, error: placeholderError } = await supabase
            .from('events_speakers_with_details')
            .select('*')
            .eq('event_uuid', event.id)
            .eq('status', 'placeholder')
            .order('is_featured', { ascending: false })
            .order('sort_order', { ascending: true })
            .order('full_name', { ascending: true })

          if (!placeholderError && placeholderData && placeholderData.length > 0) {
            setSpeakers(placeholderData)
            return
          }
        }

        setSpeakers(data || [])
      } catch (err) {
        console.error('Error fetching speakers:', err)
      } finally {
        setIsLoading(false)
      }
    }

    if (event.id) {
      fetchSpeakers()
    }
  }, [event.id])

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div
          className="loader mx-auto mb-4"
          style={{
            '--primary-color': '#fff',
            '--secondary-color': primaryColor,
          } as React.CSSProperties}
        />
        <p className={panelTheme.textMuted}>Loading speakers...</p>
      </div>
    )
  }

  if (speakers.length === 0) {
    const placeholderCount = 6
    const placeholders = Array.from({ length: placeholderCount }, (_, i) => i)

    return (
      <div className="space-y-6">
        <h1 className={`text-2xl sm:text-3xl font-bold ${panelTheme.textColor}`}>Speakers</h1>
        <p className={panelTheme.textMuted}>
          The speaker lineup will be announced soon. Stay tuned!
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {placeholders.map((i) => (
            <GlowBorder key={i} useDarkTheme={useDarkText} className="h-full">
              <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-4 h-full flex flex-col`}>
                <div className="flex items-start gap-4 flex-1">
                  <div className="flex-shrink-0">
                    <div
                      className="w-20 h-20 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${primaryColor}20` }}
                    >
                      <svg className="w-10 h-10" style={{ color: `${primaryColor}60` }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className={`font-semibold text-base ${panelTheme.textMuted}`}>
                      Speaker TBA
                    </h3>
                    <p className={`text-sm ${panelTheme.textMuted} mt-0.5 opacity-60`}>
                      To be announced
                    </p>
                  </div>
                </div>
              </div>
            </GlowBorder>
          ))}
        </div>

        {event.enable_call_for_speakers && (
          <div className={`py-4 ${panelTheme.textMuted}`}>
            <p>
              <Link
                href={`/events/${eventIdentifier}/talks`}
                className="underline hover:opacity-80 transition-opacity cursor-pointer text-white"
              >
                Interested in speaking? Submit a talk.
              </Link>
            </p>
          </div>
        )}
      </div>
    )
  }

  // Separate featured and regular speakers
  const featuredSpeakers = speakers.filter(s => s.is_featured)
  const regularSpeakers = speakers.filter(s => !s.is_featured)

  const isPast = userState.timeline === 'past'

  return (
    <div className="space-y-6">
      <h1 className={`text-2xl sm:text-3xl font-bold ${panelTheme.textColor}`}>Speakers</h1>
      {isPast && (
        <p className={`${panelTheme.textMuted} -mt-2`}>
          {speakers.length} speaker{speakers.length !== 1 ? 's' : ''} presented at this event.
        </p>
      )}

      {/* Confirmed speaker indicator */}
      {!userState.isLoading && userState.isConfirmedSpeaker && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${useDarkText ? 'bg-gray-900/10' : 'bg-white/10'}`}>
          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className={`text-base font-medium ${panelTheme.textColor}`}>
            You're in the lineup
          </span>
        </div>
      )}

      {/* Featured Speakers */}
      {featuredSpeakers.length > 0 && (
        <div>
          <h2 className={`text-lg font-semibold ${panelTheme.textColor} mb-4`}>
            Featured Speakers
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {featuredSpeakers.map((speaker) => (
              <SpeakerCard
                key={speaker.id}
                speaker={speaker}
                useDarkText={useDarkText}
                primaryColor={primaryColor}
                panelTheme={panelTheme}
                isFeatured
                storageUrl={storageUrl}
              />
            ))}
          </div>
        </div>
      )}

      {/* Regular Speakers */}
      {regularSpeakers.length > 0 && (
        <div>
          {featuredSpeakers.length > 0 && (
            <h2 className={`text-lg font-semibold ${panelTheme.textColor} mb-4`}>
              Speakers
            </h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {regularSpeakers.map((speaker) => (
              <SpeakerCard
                key={speaker.id}
                speaker={speaker}
                useDarkText={useDarkText}
                primaryColor={primaryColor}
                panelTheme={panelTheme}
                storageUrl={storageUrl}
              />
            ))}
          </div>
        </div>
      )}

      {/* Call for speakers notice (hide for past events) */}
      {event.enable_call_for_speakers && !isPast && (
        <div className={`py-4 ${panelTheme.textMuted}`}>
          <p>
            ...more speakers coming soon.{' '}
            <Link
              href={`/events/${eventIdentifier}/talks`}
              className="underline hover:opacity-80 transition-opacity cursor-pointer text-white"
            >
              Interested in speaking? Submit a talk.
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}

interface SpeakerCardProps {
  speaker: Speaker
  useDarkText: boolean
  primaryColor: string
  panelTheme: {
    panelBg: string
    panelBorder: string
    textColor: string
    textMuted: string
  }
  isFeatured?: boolean
  storageUrl: string
}

function SpeakerCard({ speaker, useDarkText, primaryColor, panelTheme, isFeatured, storageUrl }: SpeakerCardProps) {
  const initials = [speaker.first_name, speaker.last_name]
    .filter(Boolean)
    .map(n => n?.charAt(0).toUpperCase())
    .join('')
    || speaker.full_name?.charAt(0).toUpperCase()
    || '?'

  // Construct company logo URL from storage path
  const companyLogoUrl = speaker.company_logo_storage_path
    ? `${storageUrl}/storage/v1/object/public/speaker-logos/${speaker.company_logo_storage_path}`
    : null

  return (
    <GlowBorder useDarkTheme={useDarkText} className="h-full">
      <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-4 h-full flex flex-col group`}>
        <div className="flex items-start gap-4 flex-1">
          {/* Avatar */}
          <div className="flex-shrink-0">
            {speaker.avatar_url ? (
              <img
                src={speaker.avatar_url}
                alt={speaker.full_name}
                className={`${isFeatured ? 'w-24 h-24' : 'w-20 h-20'} rounded-lg object-cover grayscale contrast-[1.1] group-hover:grayscale-0 group-hover:contrast-100 transition-all duration-300`}
              />
            ) : (
              <div
                className={`${isFeatured ? 'w-24 h-24 text-3xl' : 'w-20 h-20 text-2xl'} rounded-lg flex items-center justify-center font-semibold`}
                style={{ backgroundColor: `${primaryColor}40`, color: primaryColor }}
              >
                {initials}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className={`font-semibold ${panelTheme.textColor} truncate ${isFeatured ? 'text-lg' : 'text-base'}`}>
                {speaker.full_name}
              </h3>
              {speaker.linkedin_url && (
                <a
                  href={speaker.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex-shrink-0 ${panelTheme.textMuted} hover:text-[#0A66C2] transition-colors cursor-pointer`}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                </a>
              )}
            </div>
            {(speaker.job_title || speaker.company) && (
              <p className={`text-sm ${panelTheme.textMuted} mt-0.5`}>
                {[speaker.job_title, speaker.company].filter(Boolean).join(' at ')}
              </p>
            )}
            {speaker.speaker_title && (
              <p className={`text-sm mt-1 ${panelTheme.textMuted} line-clamp-2`}>
                {speaker.speaker_title}
              </p>
            )}
          </div>
        </div>
        {/* Company Logo - centered at bottom */}
        {companyLogoUrl && (
          <div className="flex justify-center mt-3 pt-3 border-t border-white/10">
            <img
              src={companyLogoUrl}
              alt={speaker.company ? `${speaker.company} logo` : 'Company logo'}
              className="max-h-6 max-w-28 w-auto object-contain"
              style={{ filter: useDarkText ? 'brightness(0)' : 'brightness(0) invert(1)' }}
            />
          </div>
        )}
      </div>
    </GlowBorder>
  )
}
