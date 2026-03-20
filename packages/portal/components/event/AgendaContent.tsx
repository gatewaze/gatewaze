'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { getClientBrandConfig, isLightColor } from '@/config/brand'
import { useEventContext } from './EventContext'
import { GlowBorder } from '@/components/ui/GlowBorder'

interface Track {
  id: string
  name: string
  description: string | null
  sort_order: number
}

interface Speaker {
  full_name: string
  first_name: string | null
  last_name: string | null
  company: string | null
  job_title: string | null
  avatar_url: string | null
  company_logo_url: string | null
}

interface Talk {
  id: string
  title: string
  synopsis: string | null
  session_type: string | null
  speakers: Speaker[]
}

interface AgendaEntry {
  id: string
  track_id: string
  title: string
  description: string | null
  start_time: string
  end_time: string
  entry_type: string
  location: string | null
  talk_id: string | null
  talk?: Talk | null
}

export function AgendaContent() {
  const { event, useDarkText, primaryColor, userState } = useEventContext()
  const [tracks, setTracks] = useState<Track[]>([])
  const [entries, setEntries] = useState<AgendaEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null)
  const [selectedSessionType, setSelectedSessionType] = useState<string | null>(null)
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set())
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_storageUrl, setStorageUrl] = useState('')

  const panelTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    textColor: useDarkText ? 'text-gray-900' : 'text-white',
    textMuted: useDarkText ? 'text-gray-600' : 'text-white/70',
    lineColor: useDarkText ? 'bg-gray-400/50' : 'bg-white/30',
    dotColor: useDarkText ? 'bg-gray-600' : 'bg-white/80',
    dotBorder: useDarkText ? 'border-gray-400' : 'border-white/50',
  }), [useDarkText])

  useEffect(() => {
    async function fetchAgenda() {
      setIsLoading(true)
      try {
        const config = getClientBrandConfig()
        setStorageUrl(config.supabaseUrl)
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)

        // Fetch tracks
        const { data: tracksData, error: tracksError } = await supabase
          .from('events_agenda_tracks')
          .select('id, name, description, sort_order')
          .eq('event_uuid', event.id)
          .order('sort_order', { ascending: true })

        if (tracksError) {
          console.error('Error fetching tracks:', tracksError)
          return
        }

        // Fetch entries with talk data
        const { data: entriesData, error: entriesError } = await supabase
          .from('events_agenda_entries')
          .select('id, track_id, title, description, start_time, end_time, entry_type, location, talk_id')
          .eq('event_uuid', event.id)
          .order('start_time', { ascending: true })

        if (entriesError) {
          console.error('Error fetching entries:', entriesError)
          return
        }

        // Get talk IDs that we need to fetch
        const talkIds = (entriesData || [])
          .filter(e => e.talk_id)
          .map(e => e.talk_id)

        const talksMap: Record<string, Talk> = {}

        if (talkIds.length > 0) {
          // Fetch talks with speakers using the view
          const { data: talksData, error: talksError } = await supabase
            .from('events_talks_with_speakers')
            .select('id, title, synopsis, session_type, speakers')
            .in('id', talkIds)

          if (!talksError && talksData) {
            talksData.forEach((talk: any) => {
              const speakers = (talk.speakers || []).map((s: any) => ({
                full_name: s.full_name || '',
                first_name: s.first_name || null,
                last_name: s.last_name || null,
                company: s.company || null,
                job_title: s.job_title || null,
                avatar_url: s.avatar_url || null,
                company_logo_url: s.company_logo_storage_path
                  ? `${config.supabaseUrl}/storage/v1/object/public/speaker-logos/${s.company_logo_storage_path}`
                  : null,
              }))
              talksMap[talk.id] = {
                id: talk.id,
                title: talk.title,
                synopsis: talk.synopsis,
                session_type: talk.session_type || null,
                speakers,
              }
            })
          }
        }

        // Merge talks into entries
        const enrichedEntries = (entriesData || []).map(entry => ({
          ...entry,
          talk: entry.talk_id ? talksMap[entry.talk_id] || null : null,
        }))

        setTracks(tracksData || [])
        setEntries(enrichedEntries)
      } catch (err) {
        console.error('Error fetching agenda:', err)
      } finally {
        setIsLoading(false)
      }
    }

    if (event.id) {
      fetchAgenda()
    }
  }, [event.id])

  // Filter entries by selected track and session type
  const filteredEntries = useMemo(() => {
    let result = entries
    if (selectedTrack) {
      result = result.filter(entry => entry.track_id === selectedTrack)
    }
    if (selectedSessionType) {
      result = result.filter(entry => {
        if (entry.entry_type === 'session') {
          return entry.talk?.session_type === selectedSessionType
        }
        return entry.entry_type === selectedSessionType
      })
    }
    return result
  }, [entries, selectedTrack, selectedSessionType])

  // Group entries by date
  const entriesByDate = useMemo(() => {
    const groups: Record<string, AgendaEntry[]> = {}
    filteredEntries.forEach(entry => {
      const date = new Date(entry.start_time).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      if (!groups[date]) {
        groups[date] = []
      }
      groups[date].push(entry)
    })
    return groups
  }, [filteredEntries])

  const formatTime = (timeStr: string) => {
    return new Date(timeStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  const toggleExpanded = useCallback((entryId: string) => {
    setExpandedEntries(prev => {
      const next = new Set(prev)
      if (next.has(entryId)) {
        next.delete(entryId)
      } else {
        next.add(entryId)
      }
      return next
    })
  }, [])

  const sessionTypeConfig: Record<string, { label: string; color: string }> = {
    keynote: { label: 'Keynote', color: '#e74c3c' },
    talk: { label: 'Talk', color: '#3498db' },
    lightning: { label: 'Lightning', color: '#f39c12' },
    panel: { label: 'Panel', color: '#9b59b6' },
    workshop: { label: 'Workshop', color: '#2ecc71' },
    fireside: { label: 'Fireside', color: '#e67e22' },
    break: { label: 'Break', color: primaryColor },
  }

  const getSessionTypeLabel = (sessionType: string): string => {
    return sessionTypeConfig[sessionType]?.label || sessionType
  }

  const getSessionTypeColor = (sessionType: string): string => {
    return sessionTypeConfig[sessionType]?.color || primaryColor
  }

  // Collect unique session types present in the data for the filter
  const availableSessionTypes = useMemo(() => {
    const types = new Set<string>()
    entries.forEach(entry => {
      if (entry.entry_type === 'session' && entry.talk?.session_type) {
        types.add(entry.talk.session_type)
      }
      if (entry.entry_type && entry.entry_type !== 'session' && entry.entry_type !== 'spacer') {
        types.add(entry.entry_type)
      }
    })
    // Sort by the order they appear in sessionTypeConfig, then alphabetically for unknowns
    const order = Object.keys(sessionTypeConfig)
    return Array.from(types).sort((a, b) => {
      const ai = order.indexOf(a)
      const bi = order.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.localeCompare(b)
    })
  }, [entries])

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
        <p className={panelTheme.textMuted}>Loading agenda...</p>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-16">
        <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${useDarkText ? 'bg-gray-900/10' : 'bg-white/10'} flex items-center justify-center`}>
          <svg
            className={`w-8 h-8 ${panelTheme.textMuted}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
        <p className={`text-lg ${panelTheme.textColor}`}>Agenda Coming Soon</p>
        <p className={`text-sm mt-1 ${panelTheme.textMuted}`}>
          The agenda for this event will be announced soon.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Track Filter */}
      {tracks.length > 1 && (
        <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
          <button
            onClick={() => setSelectedTrack(null)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              selectedTrack === null
                ? ''
                : `${panelTheme.textMuted} hover:bg-white/10`
            }`}
            style={selectedTrack === null ? { backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : undefined}
          >
            All Tracks
          </button>
          {tracks.map(track => (
            <button
              key={track.id}
              onClick={() => setSelectedTrack(track.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                selectedTrack === track.id
                  ? ''
                  : `${panelTheme.textMuted} hover:bg-white/10`
              }`}
              style={selectedTrack === track.id ? { backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : undefined}
            >
              {track.name}
            </button>
          ))}
        </div>
      )}

      {/* Session Type Filter */}
      {availableSessionTypes.length > 1 && (
        <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
          <button
            onClick={() => setSelectedSessionType(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer border ${
              selectedSessionType === null
                ? 'border-transparent'
                : `${panelTheme.textMuted} border-transparent hover:bg-white/10`
            }`}
            style={selectedSessionType === null ? { backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : undefined}
          >
            All Types
          </button>
          {availableSessionTypes.map(type => {
            const color = getSessionTypeColor(type)
            const isActive = selectedSessionType === type
            return (
              <button
                key={type}
                onClick={() => setSelectedSessionType(isActive ? null : type)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer border ${
                  isActive
                    ? 'border-transparent'
                    : `border-transparent hover:bg-white/10`
                }`}
                style={
                  isActive
                    ? { backgroundColor: color, color: isLightColor(color) ? '#000000' : '#ffffff' }
                    : { color: color }
                }
              >
                {getSessionTypeLabel(type)}
              </button>
            )
          })}
        </div>
      )}

      {/* Agenda Timeline */}
      {Object.entries(entriesByDate).map(([date, dateEntries], groupIdx) => {
        const isLastGroup = groupIdx === Object.entries(entriesByDate).length - 1
        return (
          <div key={date} className="space-y-0">
            {/* Date Header */}
            <div className="flex gap-4 sm:gap-6">
              <div className="relative w-6 flex-shrink-0">
                <div
                  className="absolute left-1/2 -translate-x-1/2 top-[4px] w-5 h-5 rounded-full border-[3px] bg-transparent"
                  style={{ borderColor: primaryColor }}
                >
                  <div className={`absolute inset-0 m-auto w-2 h-2 rounded-full ${useDarkText ? 'bg-gray-900' : 'bg-white'}`} />
                </div>
                {/* Dotted line from date header to first entry */}
                <div
                  className="absolute left-1/2 -translate-x-1/2"
                  style={{
                    top: 28,
                    bottom: -2,
                    width: '1px',
                    backgroundImage: useDarkText
                      ? 'linear-gradient(to bottom, rgba(0,0,0,0.25) 4px, transparent 4px)'
                      : 'linear-gradient(to bottom, rgba(255,255,255,0.4) 4px, transparent 4px)',
                    backgroundSize: '1px 8px',
                  }}
                />
              </div>
              <div className="flex-1 min-w-0 pb-4">
                <span className={`font-semibold text-base sm:text-lg ${panelTheme.textColor}`}>{date}</span>
              </div>
            </div>

            {/* Entry rows — each with time + dot + card */}
            {dateEntries.map((entry, entryIdx) => {
              const track = tracks.find(t => t.id === entry.track_id)
              const displayTitle = entry.talk?.title && entry.talk.title !== '-'
                ? entry.talk.title
                : entry.title !== '-' ? entry.title : 'Session'
              const displaySynopsis = entry.talk?.synopsis && entry.talk.synopsis !== '-'
                ? entry.talk.synopsis
                : entry.description !== '-' ? entry.description : null
              const speakers = entry.talk?.speakers || []
              const sessionType = entry.talk?.session_type

              const now = new Date()
              const entryStart = new Date(entry.start_time)
              const entryEnd = new Date(entry.end_time)
              const isHappeningNow = userState.timeline === 'live' && entryStart <= now && entryEnd >= now
              const isUserSession = userState.isConfirmedSpeaker && userState.talkTitle &&
                entry.talk?.title === userState.talkTitle
              const isLastEntry = entryIdx === dateEntries.length - 1 && isLastGroup

              return (
                <div key={entry.id} className="flex gap-4 sm:gap-6">
                  {/* Timeline column — time + dot + line */}
                  <div className="relative w-6 flex-shrink-0">
                    {/* Dotted vertical line */}
                    {!isLastEntry && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2"
                        style={{
                          top: 14,
                          bottom: -2,
                          width: '1px',
                          backgroundImage: useDarkText
                            ? 'linear-gradient(to bottom, rgba(0,0,0,0.25) 4px, transparent 4px)'
                            : 'linear-gradient(to bottom, rgba(255,255,255,0.4) 4px, transparent 4px)',
                          backgroundSize: '1px 8px',
                        }}
                      />
                    )}
                    {/* Dot — pulsing for live, colored for user's talk */}
                    {isHappeningNow ? (
                      <span className="absolute left-1/2 -translate-x-1/2 top-[7px] flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                      </span>
                    ) : (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 top-[7px] w-3 h-3 rounded-full"
                        style={{ backgroundColor: primaryColor }}
                      />
                    )}
                  </div>

                  {/* Content column — time label + card */}
                  <div className="flex-1 min-w-0 pb-4">
                    {/* Time */}
                    <div className="mb-1.5" suppressHydrationWarning>
                      <span className={`text-sm font-bold ${panelTheme.textColor}`}>
                        {formatTime(entry.start_time)}
                      </span>
                      <span className={`text-sm ${panelTheme.textMuted}`}>
                        {' '}– {formatTime(entry.end_time)}
                      </span>
                    </div>

                    {/* Card */}
                    <GlowBorder borderRadius="0.75rem" useDarkTheme={useDarkText}>
                      <div
                        className={`rounded-xl overflow-hidden p-3 sm:p-4 ${
                          useDarkText
                            ? 'bg-gray-900/[0.06] border border-gray-900/[0.08]'
                            : 'bg-white/[0.06] border border-white/[0.08]'
                        }`}
                        style={isUserSession ? { borderColor: primaryColor } : undefined}
                      >
                        {/* Badges row */}
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          {isHappeningNow && (
                            <span className="flex-shrink-0 px-2 py-0.5 text-xs font-bold rounded-full bg-red-500/20 text-red-300 uppercase tracking-wider flex items-center gap-1.5">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-400" />
                              </span>
                              Now
                            </span>
                          )}
                          {isUserSession && (
                            <span
                              className="flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded-full"
                              style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}
                            >
                              Your talk
                            </span>
                          )}
                          {entry.entry_type && entry.entry_type !== 'session' && (
                            <span
                              className="flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded-full capitalize"
                              style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}
                            >
                              {entry.entry_type}
                            </span>
                          )}
                          {entry.entry_type === 'session' && sessionType && (
                            <span
                              className="flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded-full capitalize"
                              style={{ backgroundColor: getSessionTypeColor(sessionType), color: isLightColor(getSessionTypeColor(sessionType)) ? '#000000' : '#ffffff' }}
                            >
                              {getSessionTypeLabel(sessionType)}
                            </span>
                          )}
                          {track && tracks.length > 1 && !selectedTrack && (
                            <span className={`flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded-full ${
                              useDarkText ? 'bg-gray-900/10 text-gray-500' : 'bg-white/10 text-white/50'
                            }`}>
                              {track.name}
                            </span>
                          )}
                          {entry.location && (
                            <span className={`flex-shrink-0 text-xs ${panelTheme.textMuted} flex items-center gap-1`}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              {entry.location}
                            </span>
                          )}
                        </div>

                        {/* Title */}
                        <h3 className={`text-sm sm:text-base font-semibold ${panelTheme.textColor} leading-snug`}>
                          {displayTitle}
                        </h3>

                        {/* Synopsis */}
                        {displaySynopsis && (
                          <div className="mt-1">
                            <p className={`text-sm ${panelTheme.textMuted} ${expandedEntries.has(entry.id) ? '' : 'line-clamp-2'}`}>
                              {displaySynopsis}
                            </p>
                            <button
                              onClick={() => toggleExpanded(entry.id)}
                              className={`text-xs font-medium mt-1 cursor-pointer hover:underline ${panelTheme.textMuted}`}
                            >
                              {expandedEntries.has(entry.id) ? 'Show less' : 'Show more'}
                            </button>
                          </div>
                        )}

                        {/* Speakers */}
                        {speakers.length > 0 && (
                          <div className={`flex flex-wrap gap-4 mt-3 pt-3 border-t ${
                            useDarkText ? 'border-gray-900/10' : 'border-white/10'
                          }`}>
                            {speakers.map((speaker, idx) => (
                              <div key={idx} className="flex items-center gap-3">
                                {speaker.avatar_url ? (
                                  <img
                                    src={speaker.avatar_url}
                                    alt={speaker.full_name}
                                    className="w-8 h-8 rounded-full object-cover"
                                  />
                                ) : (
                                  <div
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold"
                                    style={{ backgroundColor: `${primaryColor}40`, color: primaryColor }}
                                  >
                                    {(speaker.first_name?.charAt(0) || '') + (speaker.last_name?.charAt(0) || '')}
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className={`text-sm font-medium ${panelTheme.textColor}`}>
                                    {speaker.first_name} {speaker.last_name}
                                  </p>
                                  {(speaker.job_title || speaker.company) && (
                                    <p className={`text-xs ${panelTheme.textMuted} truncate`}>
                                      {[speaker.job_title, speaker.company].filter(Boolean).join(' at ')}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </GlowBorder>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
