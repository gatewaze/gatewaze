'use client'

import { useSearchParams, usePathname, useRouter } from 'next/navigation'
import { useMemo, useCallback } from 'react'
import type { Event } from '@/types/event'
import { type RegionCode } from '@/lib/regions'
import { getClientBrandConfig, type EventTypeOption, DEFAULT_EVENT_TYPES } from '@/config/brand'

// Known region codes for parsing path segments
const KNOWN_REGION_CODES = new Set(['as', 'af', 'eu', 'na', 'sa', 'oc', 'on'])

/** Pluralize a value for URL slugs (e.g. conference → conferences) */
function pluralize(value: string): string {
  if (value.endsWith('y')) return value.slice(0, -1) + 'ies'
  if (value.endsWith('s') || value.endsWith('sh') || value.endsWith('ch')) return value + 'es'
  return value + 's'
}

/** Build slug mappings dynamically from configured event types */
function buildSlugMaps(types: EventTypeOption[]) {
  const typeToSlug: Record<string, string> = {}
  const slugToType: Record<string, string> = {}
  for (const t of types) {
    const slug = pluralize(t.value)
    typeToSlug[t.value] = slug
    slugToType[slug] = t.value
  }
  return { typeToSlug, slugToType }
}

/** Convert a topic name to a URL-friendly slug (deterministic, no reverse lookup needed) */
export function slugifyTopic(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The brand's event types, or the defaults. Pass the server-provided
 * `brandConfig.eventTypes` from a server-rendered component: getClientBrandConfig()
 * returns the built-in defaults during SSR and the real brand config in the
 * browser, so reading it during render gives the server and the client
 * different types and breaks hydration.
 */
function resolveEventTypes(eventTypes?: EventTypeOption[] | null): EventTypeOption[] {
  const types = eventTypes ?? getClientBrandConfig().eventTypes
  return types?.length ? types : DEFAULT_EVENT_TYPES
}

/** Get configured event type options with plural labels and slugs */
export function getEventTypeOptions(eventTypes?: EventTypeOption[] | null): { value: string; label: string; slug: string }[] {
  const types = resolveEventTypes(eventTypes)
  return types.map((t) => ({
    value: t.value,
    label: pluralize(t.label.charAt(0).toUpperCase() + t.label.slice(1)),
    slug: pluralize(t.value),
  }))
}

/** @deprecated Use getEventTypeOptions() for dynamic types */
export const EVENT_TYPE_OPTIONS = DEFAULT_EVENT_TYPES.map((t) => ({
  value: t.value,
  label: pluralize(t.label),
  slug: pluralize(t.value),
}))

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

function extractFiltersFromPathname(
  pathname: string,
  slugToType: Record<string, string>
): {
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
      } else if (!eventType && Object.prototype.hasOwnProperty.call(slugToType, seg)) {
        eventType = slugToType[seg]
      }
    }
  }

  return { basePath, view, region, eventType }
}

export function useEventFilters(eventTypes?: EventTypeOption[] | null) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()

  // Build dynamic slug maps from configured event types. Callers pass the
  // server-provided brandConfig.eventTypes so a type slug in the URL parses the
  // same way on the server and the client (see resolveEventTypes).
  const configuredTypes = resolveEventTypes(eventTypes)
  const { typeToSlug, slugToType } = useMemo(() => buildSlugMaps(configuredTypes), [configuredTypes])

  // Parse region & type from path segments (e.g. /events/upcoming/eu/conferences)
  // Fall back to search params for backward compatibility (direct query param URLs)
  const parsed = extractFiltersFromPathname(pathname, slugToType)
  const { basePath, view } = parsed
  const region = parsed.region || (searchParams.get('region') as RegionCode | null)
  const eventType = parsed.eventType || searchParams.get('type')
  const topics = useMemo(() => {
    const topicsParam = searchParams.get('topics')
    return topicsParam ? topicsParam.split(',').filter(Boolean) : []
  }, [searchParams])

  const typeSlug = eventType ? typeToSlug[eventType] || null : null

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
      const newSlug = newType ? typeToSlug[newType] || null : null
      router.push(buildFilterPath(basePath, view, region, newSlug, topics))
    },
    [basePath, view, region, eventType, topics, router, typeToSlug]
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
