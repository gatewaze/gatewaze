'use client'

import { useMemo, useState, useCallback, useEffect, Suspense } from 'react'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import { type ViewMode } from './TimelineTabs'
import { TimelineHeader } from './TimelineHeader'
import { EventTimelineGroup } from './EventTimelineGroup'
import { EventCalendar } from './EventCalendar'
import { EventMap } from './EventMap'
import { EventFilters } from './EventFilters'
import { SearchResults } from './SearchResults'
import { groupEventsByDate } from './utils'
import { useEventSearch } from '@/hooks/useEventSearch'
import { useEventFilters } from '@/hooks/useEventFilters'
import { useIpInfo } from '@/hooks/useIpInfo'
import { getDistanceToEventByCity, usesImperialUnits } from '@/lib/location'

// Near Me radius: 100 miles (~161 km) for imperial, 100 km for metric
const NEAR_ME_RADIUS_IMPERIAL_KM = 100 / 0.621371 // ~161 km
const NEAR_ME_RADIUS_METRIC_KM = 100

interface Props {
  events: Event[]
  upcomingEvents: Event[]
  pastEvents: Event[]
  brandConfig: BrandConfig
  view: ViewMode
  basePath?: string
  initialSearchQuery?: string
}

export function TimelineContent({ events, upcomingEvents, pastEvents, brandConfig, view, basePath, initialSearchQuery }: Props) {
  return (
    <Suspense fallback={null}>
      <TimelineContentInner
        events={events}
        upcomingEvents={upcomingEvents}
        pastEvents={pastEvents}
        brandConfig={brandConfig}
        view={view}
        basePath={basePath}
        initialSearchQuery={initialSearchQuery}
      />
    </Suspense>
  )
}

function TimelineContentInner({ events, upcomingEvents, pastEvents, brandConfig, view, basePath, initialSearchQuery }: Props) {
  const [nearMe, setNearMe] = useState(false)

  // Get user's location from IP
  const { userLocation, isLoading: locationLoading } = useIpInfo()

  // Search functionality
  const { searchResults, isSearching, searchQuery, performSearch, clearSearch } = useEventSearch(
    brandConfig.id,
    userLocation
  )

  // Auto-trigger search if loaded from /events/search/[query] URL
  useEffect(() => {
    if (initialSearchQuery) {
      performSearch(initialSearchQuery)
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Filter functionality
  const {
    region,
    eventType,
    topics,
    hasActiveFilters,
    filterSuffix,
    toggleType,
    toggleRegion,
    toggleTopic,
    clearFilters,
    filterEvents,
  } = useEventFilters()

  const isShowingSearchResults = searchResults !== null
  // When loaded from a search URL, don't render the timeline while waiting for results
  // (avoids hydration mismatch from locale-dependent date formatting)
  const isInitialSearchPending = !!initialSearchQuery && !isShowingSearchResults

  // Apply filters to events
  const filteredUpcoming = useMemo(() => filterEvents(upcomingEvents), [filterEvents, upcomingEvents])
  const filteredPast = useMemo(() => filterEvents(pastEvents), [filterEvents, pastEvents])
  const filteredAll = useMemo(() => filterEvents(events), [filterEvents, events])

  // Determine which events to show
  const activeEvents = view === 'upcoming' ? filteredUpcoming : view === 'past' ? filteredPast : []
  const isPastView = view === 'past'

  // Near Me: filter to events within radius, then sort by distance
  const imperial = usesImperialUnits(userLocation?.country || '')
  const nearMeRadiusKm = imperial ? NEAR_ME_RADIUS_IMPERIAL_KM : NEAR_ME_RADIUS_METRIC_KM

  const nearMeEvents = useMemo(() => {
    if (!nearMe || !userLocation) {
      return activeEvents
    }

    return activeEvents
      .map((event) => ({
        event,
        distance: getDistanceToEventByCity(userLocation, event.event_city),
      }))
      .filter(({ distance }) => distance !== null && distance <= nearMeRadiusKm)
      .sort((a, b) => a.distance! - b.distance!)
      .map(({ event }) => event)
  }, [activeEvents, nearMe, userLocation, nearMeRadiusKm])

  const groupedEvents = useMemo(
    () => groupEventsByDate(nearMeEvents, isPastView),
    [nearMeEvents, isPastView]
  )

  // Show Near Me option only on list views when location is available
  const showNearMe = (view === 'upcoming' || view === 'past') && !locationLoading && userLocation !== null

  const handleToggleNearMe = useCallback(() => {
    setNearMe((prev) => !prev)
  }, [])

  // Sync URL when searching
  const handleSearch = useCallback(
    (query: string) => {
      performSearch(query)
      const slug = encodeURIComponent(query.trim()).replace(/%20/g, '-')
      const searchPath = `${basePath || '/events'}/search/${slug}`
      window.history.replaceState(null, '', searchPath)
    },
    [performSearch, basePath]
  )

  const handleClearSearch = useCallback(() => {
    clearSearch()
    // Navigate back to the current view URL
    const viewPath = `${basePath || '/events'}/${view}`
    window.history.replaceState(null, '', viewPath)
  }, [clearSearch, basePath, view])

  return (
    <div className="w-full">
      {/* Header with tabs + search — hidden when showing search results (search moves into SearchResults) */}
      {!isShowingSearchResults && !isInitialSearchPending && (
        <TimelineHeader
          brandConfig={brandConfig}
          upcomingCount={filteredUpcoming.length}
          pastCount={filteredPast.length}
          onSearch={handleSearch}
          onClearSearch={handleClearSearch}
          isSearching={isSearching}
          basePath={basePath}
          filterSuffix={filterSuffix}
        />
      )}

      {/* Filters — hidden when showing search results */}
      {!isShowingSearchResults && !isInitialSearchPending && (
        <EventFilters
          region={region}
          eventType={eventType}
          topics={topics}
          onToggleType={toggleType}
          onToggleRegion={toggleRegion}
          onToggleTopic={toggleTopic}
          primaryColor={brandConfig.primaryColor}
          nearMe={nearMe}
          onToggleNearMe={handleToggleNearMe}
          showNearMe={showNearMe}
          nearMeLabel={imperial ? '100 mi' : '100 km'}
        />
      )}

      {isInitialSearchPending ? (
        <div className="flex justify-center py-16">
          <svg className="w-6 h-6 text-white/40 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : isShowingSearchResults ? (
        <SearchResults
          results={searchResults}
          events={events}
          query={searchQuery}
          onSearch={handleSearch}
          onClear={handleClearSearch}
          isSearching={isSearching}
          brandConfig={brandConfig}
          userLocation={userLocation}
        />
      ) : view === 'calendar' ? (
        <EventCalendar events={filteredAll} brandConfig={brandConfig} />
      ) : view === 'map' ? (
        <EventMap events={filteredUpcoming} brandConfig={brandConfig} />
      ) : groupedEvents.length === 0 ? (
        <EmptyState viewMode={view} hasActiveFilters={hasActiveFilters || nearMe} onClearFilters={clearFilters} />
      ) : (
        <div className="max-w-7xl mx-auto">
          {groupedEvents.map((group, index) => (
            <EventTimelineGroup
              key={group.dateKey}
              group={group}
              brandConfig={brandConfig}
              isLast={index === groupedEvents.length - 1}
              userLocation={userLocation}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({
  viewMode,
  hasActiveFilters,
  onClearFilters,
}: {
  viewMode: ViewMode
  hasActiveFilters?: boolean
  onClearFilters?: () => void
}) {
  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center">
        <svg className="w-8 h-8 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </div>
      {hasActiveFilters ? (
        <>
          <p className="text-white/60 text-lg">No events match your filters</p>
          <button
            onClick={onClearFilters}
            className="cursor-pointer mt-3 px-4 py-2 text-sm font-medium text-white/70 hover:text-white bg-white/10 hover:bg-white/15 transition-colors"
            style={{ borderRadius: 'var(--radius-control)' }}
          >
            Clear filters
          </button>
        </>
      ) : (
        <>
          <h2 className="text-white/60 text-2xl" style={{ fontWeight: 'var(--font-weight-heading, 600)' }}>No {viewMode} events</h2>
          <p className="text-white/40 text-base mt-1">Check back soon for updates</p>
        </>
      )}
    </div>
  )
}
