'use client'

import { useMemo, useState, useCallback, useEffect, Suspense } from 'react'
import type { ListingQuery } from '@gatewaze/shared/listing'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import { type ViewMode } from './TimelineTabs'
import { TimelineHeader } from './TimelineHeader'
import { EventTimelineGroup } from './EventTimelineGroup'
import { EventCalendar } from './EventCalendar'
import { EventMap } from './EventMap'
import { EventFilters } from './EventFilters'
import { FeaturedContent } from './FeaturedContent'
import { SearchResults } from './SearchResults'
import { groupEventsByDate } from './utils'
import { useEventSearch } from '@/hooks/useEventSearch'
import { useEventFilters } from '@/hooks/useEventFilters'
import { useIpInfo } from '@/hooks/useIpInfo'
import { getDistanceToEventByCity, usesImperialUnits } from '@/lib/location'
import { eventsListingSchema } from '@gatewaze-modules/events/listing-schema'
import { usePortalInfiniteListing, type PortalInitialPage } from '@/lib/listing/usePortalInfiniteListing'
import { MAX_ACCUMULATED_ROWS, NEAR_ME_AUTO_LOAD_LIMIT } from '@/lib/listing/constants'

// Near Me radius: 100 miles (~161 km) for imperial, 100 km for metric
const NEAR_ME_RADIUS_IMPERIAL_KM = 100 / 0.621371 // ~161 km
const NEAR_ME_RADIUS_METRIC_KM = 100

interface Props {
  brandConfig: BrandConfig
  view: ViewMode
  basePath?: string
  initialSearchQuery?: string
  /**
   * Server-rendered first page for the active view. Required when view
   * is 'upcoming' or 'past' for the new paginated path; calendar/map
   * pages can omit this.
   */
  initialPage?: PortalInitialPage<Event>
  /**
   * The ListingQuery used to produce initialPage. Echoed back to the
   * portal listing API for subsequent pages.
   */
  query?: ListingQuery
  /**
   * Server-side count of the *inactive* tab's view (e.g. "past count"
   * when viewing upcoming). Used so the inactive tab badge reflects
   * server-side filters without a separate client roundtrip.
   */
  otherViewCount?: number | null
  /**
   * Calendar / map views need every event for their visualisation. The
   * upcoming / past paginated paths leave this undefined.
   */
  allEvents?: Event[]
  upcomingEvents?: Event[]
  pastEvents?: Event[]
}

const SYNTHETIC_INITIAL_PAGE: PortalInitialPage<Event> = {
  rows: [],
  page: 0,
  pageSize: 50,
  totalCount: 0,
  countStrategy: 'exact',
  ts: '1970-01-01T00:00:00.000Z',
}

export function TimelineContent(props: Props) {
  return (
    <Suspense fallback={null}>
      <TimelineContentInner {...props} />
    </Suspense>
  )
}

function TimelineContentInner({
  brandConfig,
  view,
  basePath,
  initialSearchQuery,
  initialPage,
  query,
  otherViewCount,
  allEvents,
  upcomingEvents,
  pastEvents,
}: Props) {
  const [nearMe, setNearMe] = useState(false)

  const isPaginatedView = view === 'upcoming' || view === 'past'
  const effectiveInitialPage: PortalInitialPage<Event> =
    initialPage ?? SYNTHETIC_INITIAL_PAGE

  const effectiveQuery: ListingQuery = useMemo(
    () =>
      query ?? {
        page: 0,
        pageSize: 50,
        filters: { view: view === 'past' ? 'past' : 'upcoming' },
      },
    [query, view],
  )

  // Always call the hook (Rules of Hooks). For non-paginated views the
  // synthetic initialPage means hasMore=false, so the hook is dormant.
  const {
    rows: paginatedRows,
    hasMore,
    isLoading: isPaginatedLoading,
    error: paginatedError,
    capReached,
    sentinelRef,
    totalCount,
    loadMore,
  } = usePortalInfiniteListing<Event>({
    module: 'events',
    schema: eventsListingSchema,
    initialPage: effectiveInitialPage,
    query: effectiveQuery,
  })

  const { userLocation, isLoading: locationLoading } = useIpInfo()

  const { searchResults, isSearching, searchQuery, performSearch, clearSearch } = useEventSearch(
    brandConfig.id,
    userLocation,
  )

  useEffect(() => {
    if (initialSearchQuery) {
      performSearch(initialSearchQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const isInitialSearchPending = !!initialSearchQuery && !isShowingSearchResults

  // Resolve the active list of events.
  // - upcoming/past: prefer paginated rows; fall back to client-side filtered arrays
  //   if a page didn't supply initialPage (legacy compat).
  // - calendar/map: full datasets, optionally client-filtered by chips that
  //   weren't applied server-side.
  const activeUpcomingFallback = useMemo(
    () => filterEvents(upcomingEvents ?? []),
    [filterEvents, upcomingEvents],
  )
  const activePastFallback = useMemo(
    () => filterEvents(pastEvents ?? []),
    [filterEvents, pastEvents],
  )
  const filteredAll = useMemo(() => filterEvents(allEvents ?? []), [filterEvents, allEvents])

  const activeEvents: Event[] = isPaginatedView
    ? initialPage
      ? paginatedRows
      : view === 'upcoming'
        ? activeUpcomingFallback
        : activePastFallback
    : []

  const availableTypes = useMemo(() => {
    const sourceArr =
      view === 'upcoming'
        ? upcomingEvents ?? paginatedRows
        : view === 'past'
          ? pastEvents ?? paginatedRows
          : allEvents ?? []
    const types = new Set<string>()
    for (const event of sourceArr) {
      if (event.event_type) types.add(event.event_type)
    }
    return types
  }, [view, upcomingEvents, pastEvents, allEvents, paginatedRows])

  const isPastView = view === 'past'

  const imperial = usesImperialUnits(userLocation?.country || '')
  const nearMeRadiusKm = imperial ? NEAR_ME_RADIUS_IMPERIAL_KM : NEAR_ME_RADIUS_METRIC_KM

  const nearMeEvents = useMemo(() => {
    if (!nearMe || !userLocation) return activeEvents
    return activeEvents
      .map((event) => ({
        event,
        distance: getDistanceToEventByCity(userLocation, event.event_city),
      }))
      .filter(({ distance }) => distance !== null && distance <= nearMeRadiusKm)
      .sort((a, b) => a.distance! - b.distance!)
      .map(({ event }) => event)
  }, [activeEvents, nearMe, userLocation, nearMeRadiusKm])

  // Auto-load more pages when nearMe is on but the current page yielded
  // few visible rows after filtering. Bounded by NEAR_ME_AUTO_LOAD_LIMIT
  // empty pages so we don't burn through the dataset chasing zero matches.
  const [emptyNearMePages, setEmptyNearMePages] = useState(0)
  useEffect(() => {
    if (!nearMe || !isPaginatedView || !initialPage) return
    if (!hasMore || capReached || isPaginatedLoading) return
    if (emptyNearMePages >= NEAR_ME_AUTO_LOAD_LIMIT) return
    if (nearMeEvents.length === 0 || activeEvents.length - nearMeEvents.length > activeEvents.length / 2) {
      setEmptyNearMePages((n) => n + 1)
      loadMore()
    }
  }, [nearMe, isPaginatedView, initialPage, hasMore, capReached, isPaginatedLoading, nearMeEvents.length, activeEvents.length, emptyNearMePages, loadMore])

  useEffect(() => {
    setEmptyNearMePages(0)
  }, [nearMe, region, eventType, topics])

  const categoryPriorityMap = useMemo(() => {
    const map = new Map<string, number>()
    if (brandConfig.contentCategories) {
      brandConfig.contentCategories.forEach((cat, i) => map.set(cat.value, i))
    }
    return map
  }, [brandConfig.contentCategories])

  const groupedEvents = useMemo(() => {
    const groups = groupEventsByDate(nearMeEvents, isPastView)
    if (categoryPriorityMap.size > 0) {
      const noPriority = categoryPriorityMap.size
      for (const group of groups) {
        group.events.sort((a, b) => {
          const aPriority = a.content_category ? (categoryPriorityMap.get(a.content_category) ?? noPriority) : noPriority
          const bPriority = b.content_category ? (categoryPriorityMap.get(b.content_category) ?? noPriority) : noPriority
          if (aPriority !== bPriority) return aPriority - bPriority
          return new Date(a.event_start).getTime() - new Date(b.event_start).getTime()
        })
      }
    }
    return groups
  }, [nearMeEvents, isPastView, categoryPriorityMap])

  const showNearMe = (view === 'upcoming' || view === 'past') && !locationLoading && userLocation !== null

  const handleToggleNearMe = useCallback(() => {
    setNearMe((prev) => !prev)
  }, [])

  const handleSearch = useCallback(
    (queryText: string) => {
      performSearch(queryText)
      const slug = encodeURIComponent(queryText.trim()).replace(/%20/g, '-')
      const searchPath = `${basePath || '/events'}/search/${slug}`
      window.history.replaceState(null, '', searchPath)
    },
    [performSearch, basePath],
  )

  const handleClearSearch = useCallback(() => {
    clearSearch()
    const viewPath = `${basePath || '/events'}/${view}`
    window.history.replaceState(null, '', viewPath)
  }, [clearSearch, basePath, view])

  // Tab counts:
  // - active view: prefer the SSR-side totalCount (server-side filters applied);
  //   fall back to filtered array length for legacy compat.
  // - inactive view: from otherViewCount when supplied; fall back to filtered length.
  const upcomingCount = useMemo(() => {
    if (view === 'upcoming') {
      if (initialPage) return totalCount ?? paginatedRows.length
      return activeUpcomingFallback.length
    }
    return otherViewCount ?? activeUpcomingFallback.length
  }, [view, initialPage, totalCount, paginatedRows.length, otherViewCount, activeUpcomingFallback.length])

  const pastCount = useMemo(() => {
    if (view === 'past') {
      if (initialPage) return totalCount ?? paginatedRows.length
      return activePastFallback.length
    }
    return otherViewCount ?? activePastFallback.length
  }, [view, initialPage, totalCount, paginatedRows.length, otherViewCount, activePastFallback.length])

  return (
    <div className="w-full">
      {!isShowingSearchResults && !isInitialSearchPending && view === 'upcoming' && (
        <FeaturedContent
          events={isPaginatedView && initialPage ? paginatedRows : (upcomingEvents ?? [])}
          brandConfig={brandConfig}
          userLocation={userLocation}
        />
      )}

      {!isShowingSearchResults && !isInitialSearchPending && (
        <TimelineHeader
          brandConfig={brandConfig}
          upcomingCount={upcomingCount}
          pastCount={pastCount}
          onSearch={handleSearch}
          onClearSearch={handleClearSearch}
          isSearching={isSearching}
          basePath={basePath}
          filterSuffix={filterSuffix}
        />
      )}

      {!isShowingSearchResults && !isInitialSearchPending && (
        <EventFilters
          region={region}
          eventType={eventType}
          topics={topics}
          availableTypes={availableTypes}
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
          <Spinner large />
        </div>
      ) : isShowingSearchResults ? (
        <SearchResults
          results={searchResults}
          events={allEvents ?? upcomingEvents ?? []}
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
        <EventMap events={filterEvents(upcomingEvents ?? [])} brandConfig={brandConfig} />
      ) : groupedEvents.length === 0 && !isPaginatedLoading ? (
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
          {isPaginatedView && initialPage && (
            <div
              ref={sentinelRef}
              role="status"
              aria-live="polite"
              aria-busy={isPaginatedLoading}
              className="min-h-[3rem] flex items-center justify-center py-8 text-sm text-white/60"
            >
              {paginatedError ? (
                <div className="flex flex-col items-center gap-2 text-center">
                  <span>Couldn&apos;t load more events.</span>
                  <button
                    type="button"
                    onClick={loadMore}
                    className="cursor-pointer px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white bg-white/10 hover:bg-white/15 transition-colors"
                    style={{ borderRadius: 'var(--radius-control)' }}
                  >
                    Retry
                  </button>
                </div>
              ) : isPaginatedLoading ? (
                <span className="flex items-center gap-2">
                  <Spinner />
                  <span>{nearMe ? 'Looking for events near you…' : 'Loading more events…'}</span>
                </span>
              ) : capReached ? (
                <span className="text-white/50">
                  Showing first {MAX_ACCUMULATED_ROWS.toLocaleString()} results — refine your filters (try search) to see more.
                </span>
              ) : !hasMore ? (
                <span className="text-white/40">End of events</span>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Spinner({ large }: { large?: boolean }) {
  const cls = large ? 'w-6 h-6 text-white/40' : 'w-4 h-4 text-white/60'
  return (
    <svg className={`${cls} animate-spin`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
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
