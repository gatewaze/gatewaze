'use client'

import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import type { AISearchResult } from '@/hooks/useEventSearch'
import type { UserLocation } from '@/lib/location'
import { getDistanceToEventByCity } from '@/lib/location'
import { EventTimelineCard } from './EventTimelineCard'
import { TimelineSearch } from './TimelineSearch'

interface Props {
  results: AISearchResult[]
  events: Event[]
  query: string
  onSearch: (query: string) => void
  onClear: () => void
  isSearching: boolean
  brandConfig: BrandConfig
  userLocation: UserLocation | null
}

interface EventWithMatch extends Event {
  matchReason: string
  relevanceScore: number
  distanceKm: number | null
}

export function SearchResults({
  results,
  events,
  query,
  onSearch,
  onClear,
  isSearching,
  brandConfig,
  userLocation,
}: Props) {
  // Map results to full event objects with match info
  const matchedEvents: EventWithMatch[] = results
    .map((result) => {
      const event = events.find((e) => e.event_id === result.event_id)
      if (!event) return null

      const distanceKm = getDistanceToEventByCity(userLocation, event.event_city)

      return {
        ...event,
        matchReason: result.match_reason,
        relevanceScore: result.relevance_score,
        distanceKm,
      }
    })
    .filter((e): e is EventWithMatch => e !== null)

  // Separate upcoming and past, preserving relevance order from API
  const upcomingEvents = matchedEvents.filter((e) => {
    const result = results.find((r) => r.event_id === e.event_id)
    return result?.is_upcoming
  })

  const pastEvents = matchedEvents.filter((e) => {
    const result = results.find((r) => r.event_id === e.event_id)
    return !result?.is_upcoming
  })

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header with heading and search field */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h2 className="text-white text-2xl sm:text-3xl font-semibold">
          Results for &ldquo;{query}&rdquo;
        </h2>
        <TimelineSearch
          onSearch={onSearch}
          onClear={onClear}
          isSearching={isSearching}
          primaryColor={brandConfig.primaryColor}
          initialQuery={query}
        />
      </div>

      {/* No Results */}
      {matchedEvents.length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: `rgba(var(--panel-tint,0,0,0),var(--glass-opacity,0.05))`, backdropFilter: `blur(var(--glass-blur,4px))`, border: `1px solid rgba(var(--panel-tint,0,0,0),var(--glass-border-opacity,0.1))` }}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <h2 className="text-white/60 text-2xl mb-2" style={{ fontWeight: 'var(--font-weight-heading, 600)' }}>No matching events</h2>
          <p className="text-white/60 text-base">Try different keywords or browse all events</p>
        </div>
      )}

      {/* Upcoming Events Section — flat list, relevance order */}
      {upcomingEvents.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: brandConfig.primaryColor }}
            />
            <h3 className="text-white font-semibold text-lg">Upcoming events</h3>
            <span className="text-white/50 text-base">({upcomingEvents.length})</span>
          </div>
          <div className="space-y-3">
            {upcomingEvents.map((event) => (
              <EventTimelineCard
                key={event.event_id}
                event={event}
                brandConfig={brandConfig}
                userLocation={userLocation}
                showDate
              />
            ))}
          </div>
        </div>
      )}

      {/* Past Events Section — flat list, relevance order */}
      {pastEvents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-3 h-3 rounded-full bg-white/30" />
            <h3 className="text-white/70 font-semibold text-lg">Past events</h3>
            <span className="text-white/40 text-base">({pastEvents.length})</span>
          </div>
          <div className="space-y-3 opacity-80">
            {pastEvents.map((event) => (
              <EventTimelineCard
                key={event.event_id}
                event={event}
                brandConfig={brandConfig}
                userLocation={userLocation}
                showDate
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
