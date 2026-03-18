'use client'

import { useSearchParams, usePathname, useRouter } from 'next/navigation'
import { useMemo, useCallback } from 'react'
import type { Event } from '@/types/event'
import { type RegionCode } from '@/lib/regions'

// Known region codes for parsing path segments
const KNOWN_REGION_CODES = new Set(['as', 'af', 'eu', 'na', 'sa', 'oc', 'on'])

// Event type slug mapping (singular DB value → plural URL slug)
const TYPE_TO_SLUG: Record<string, string> = {
  conference: 'conferences',
  meetup: 'meetups',
  workshop: 'workshops',
  webinar: 'webinars',
  hackathon: 'hackathons',
}

const SLUG_TO_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_TO_SLUG).map(([k, v]) => [v, k])
)

/** Convert a topic name to a URL-friendly slug (deterministic, no reverse lookup needed) */
export function slugifyTopic(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const EVENT_TYPE_OPTIONS = [
  { value: 'conference', label: 'Conferences', slug: 'conferences' },
  { value: 'meetup', label: 'Meetups', slug: 'meetups' },
  { value: 'workshop', label: 'Workshops', slug: 'workshops' },
  { value: 'webinar', label: 'Webinars', slug: 'webinars' },
  { value: 'hackathon', label: 'Hackathons', slug: 'hackathons' },
]

function buildFilterPath(
  basePath: string,
  view: string,
  region: string | null,
  typeSlug: string | null,
  topicSlugs: string[]
): string {
  const parts = [basePath, view]
  if (region) parts.push(region)
  if (typeSlug) parts.push(typeSlug)
  let path = parts.join('/')
  if (topicSlugs.length > 0) {
    path += `?topics=${topicSlugs.join(',')}`
  }
  return path
}

function extractFiltersFromPathname(pathname: string): {
  basePath: string
  view: string
  region: RegionCode | null
  eventType: string | null
} {
  // Match /events/{view}[/{segments}] or /calendars/{slug}/{view}[/{segments}]
  const calendarMatch = pathname.match(/^(\/calendars\/[^/]+)\/(upcoming|past|calendar|map)(?:\/(.+))?/)
  const eventsMatch = pathname.match(/^(\/events)\/(upcoming|past|calendar|map)(?:\/(.+))?/)

  const match = calendarMatch || eventsMatch
  if (!match) return { basePath: '/events', view: 'upcoming', region: null, eventType: null }

  const [, basePath, view, rest] = match
  let region: RegionCode | null = null
  let eventType: string | null = null

  if (rest) {
    const segments = rest.replace(/\/+$/, '').split('/').filter(Boolean)
    for (const seg of segments) {
      if (!region && KNOWN_REGION_CODES.has(seg)) {
        region = seg as RegionCode
      } else if (!eventType && seg in SLUG_TO_TYPE) {
        eventType = SLUG_TO_TYPE[seg]
      }
    }
  }

  return { basePath, view, region, eventType }
}

export function useEventFilters() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()

  // Parse region & type from path segments (e.g. /events/upcoming/eu/conferences)
  // Fall back to search params for backward compatibility (direct query param URLs)
  const parsed = extractFiltersFromPathname(pathname)
  const { basePath, view } = parsed
  const region = parsed.region || (searchParams.get('region') as RegionCode | null)
  const eventType = parsed.eventType || searchParams.get('type')
  const topics = useMemo(() => {
    const topicsParam = searchParams.get('topics')
    return topicsParam ? topicsParam.split(',').filter(Boolean) : []
  }, [searchParams])

  const typeSlug = eventType ? TYPE_TO_SLUG[eventType] || null : null

  const hasActiveFilters = !!(region || eventType || topics.length > 0)

  // Build the filter suffix for tab links (preserves filters when switching views)
  const filterSuffix = useMemo(() => {
    const parts: string[] = []
    if (region) parts.push(region)
    if (typeSlug) parts.push(typeSlug)
    let suffix = parts.length > 0 ? '/' + parts.join('/') : ''
    if (topics.length > 0) {
      suffix += `?topics=${topics.join(',')}`
    }
    return suffix
  }, [region, typeSlug, topics])

  const toggleType = useCallback(
    (type: string) => {
      const newType = eventType === type ? null : type
      const newSlug = newType ? TYPE_TO_SLUG[newType] || null : null
      router.push(buildFilterPath(basePath, view, region, newSlug, topics))
    },
    [basePath, view, region, eventType, topics, router]
  )

  const toggleRegion = useCallback(
    (code: string | null) => {
      const newRegion = region === code ? null : code
      router.push(buildFilterPath(basePath, view, newRegion, typeSlug, topics))
    },
    [basePath, view, region, typeSlug, topics, router]
  )

  const toggleTopic = useCallback(
    (topic: string) => {
      const slug = slugifyTopic(topic)
      const newTopics = topics.includes(slug)
        ? topics.filter((t) => t !== slug)
        : [...topics, slug]
      router.push(buildFilterPath(basePath, view, region, typeSlug, newTopics))
    },
    [basePath, view, region, typeSlug, topics, router]
  )

  const clearFilters = useCallback(() => {
    router.push(`${basePath}/${view}`)
  }, [basePath, view, router])

  const filterEvents = useCallback(
    (events: Event[]): Event[] => {
      return events.filter((event) => {
        // Filter by event type (single select)
        if (eventType && event.event_type !== eventType) return false

        // Filter by region (single select)
        if (region && event.event_region !== region) return false

        // Filter by topics (multi-select, OR within topics — compare slugs)
        if (topics.length > 0) {
          const eventTopicSlugs = (event.event_topics || []).map(slugifyTopic)
          if (!topics.some((slug) => eventTopicSlugs.includes(slug))) return false
        }

        return true
      })
    },
    [eventType, region, topics]
  )

  return {
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
  }
}
