// Portal data-access helpers — single chokepoint between server
// components and the API. Per spec-portal-on-cloudflare-workers §4.2.
//
// Every helper here:
//   - Routes through gatewazeFetch (CDN → API → Supabase) so the
//     Cloudflare Worker target benefits from edge caching out of the
//     box, and K8s / dev environments fall through to the API.
//   - Sets a stable Next.js cache tag so revalidateTag(...) on a
//     mutation purges exactly the dependent pages.
//   - Keeps shape identical to what the previous direct-Supabase
//     callers expected, so migration of each consumer is mechanical.

import { gatewazeFetch } from './gatewaze'
import type { Event } from '@/types/event'

export interface EventWithUuid extends Event {
  id: string
}

export interface RecommendedEvent {
  id: string
  event_id: string
  event_title: string
  event_start: string | null
  event_end: string | null
  event_city: string | null
  event_country_code: string | null
  screenshot_url: string | null
  event_logo: string | null
  event_link: string | null
  register_button_text: string | null
  enable_registration: boolean | null
}

export interface EventCounts {
  eventId: string
  eventUuid: string
  speakerCount: number
  sponsorCount: number
  competitionCount: number
  discountCount: number
  mediaCount: number
  hasVirtualEvent: boolean
}

export interface AdPixelConfig {
  reddit?: { pixelId: string }
  meta?: { pixelId: string }
}

// Default revalidate window for portal-public reads. Matches the
// API's `s-maxage=300` so a Next-side revalidation doesn't undercut
// the CDN's TTL — they expire in lockstep on the same edge.
const DEFAULT_REVALIDATE = 60

// Helpers used by every consumer to construct consistent paths and tags.
function eventPath(identifier: string, suffix = ''): string {
  return `/api/portal/events/${encodeURIComponent(identifier)}${suffix}`
}

// ---------------------------------------------------------------------------
// Event detail
// ---------------------------------------------------------------------------

export async function getEvent(identifier: string): Promise<EventWithUuid | null> {
  return gatewazeFetch<EventWithUuid>(eventPath(identifier), {
    tags: [`event:${identifier}`],
    revalidate: DEFAULT_REVALIDATE,
  })
}

export async function getEventCounts(identifier: string): Promise<EventCounts | null> {
  return gatewazeFetch<EventCounts>(eventPath(identifier, '/counts'), {
    tags: [`event:${identifier}:counts`],
    revalidate: DEFAULT_REVALIDATE,
  })
}

export async function getEventAdPixels(identifier: string): Promise<AdPixelConfig | null> {
  return gatewazeFetch<AdPixelConfig>(eventPath(identifier, '/ad-pixels'), {
    tags: [`event:${identifier}:ad-pixels`],
    revalidate: 300, // pixel config changes are rare
  })
}

export async function getEventRecommended(identifier: string): Promise<RecommendedEvent | null> {
  const res = await gatewazeFetch<{ data: RecommendedEvent | null }>(
    eventPath(identifier, '/recommended'),
    { tags: [`event:${identifier}:recommended`], revalidate: 300 },
  )
  return res?.data ?? null
}

// ---------------------------------------------------------------------------
// Event sub-resources — one call per resource, each independently cached.
// ---------------------------------------------------------------------------

export async function getEventSpeakers(
  identifier: string,
  status: 'confirmed' | 'placeholder' | 'any' = 'confirmed',
): Promise<unknown[]> {
  const res = await gatewazeFetch<{ data: unknown[] }>(
    `${eventPath(identifier, '/speakers')}?status=${status}`,
    { tags: [`event:${identifier}:speakers`], revalidate: DEFAULT_REVALIDATE },
  )
  return res?.data ?? []
}

export async function getEventSponsors(identifier: string): Promise<unknown[]> {
  const res = await gatewazeFetch<{ data: unknown[] }>(eventPath(identifier, '/sponsors'), {
    tags: [`event:${identifier}:sponsors`],
    revalidate: DEFAULT_REVALIDATE,
  })
  return res?.data ?? []
}

export async function getEventTalks(identifier: string): Promise<unknown[]> {
  const res = await gatewazeFetch<{ data: unknown[] }>(eventPath(identifier, '/talks'), {
    tags: [`event:${identifier}:talks`],
    revalidate: DEFAULT_REVALIDATE,
  })
  return res?.data ?? []
}

export async function getEventAgenda(
  identifier: string,
): Promise<{ entries: unknown[]; tracks: unknown[] }> {
  const res = await gatewazeFetch<{ entries: unknown[]; tracks: unknown[] }>(
    eventPath(identifier, '/agenda'),
    { tags: [`event:${identifier}:agenda`], revalidate: DEFAULT_REVALIDATE },
  )
  return { entries: res?.entries ?? [], tracks: res?.tracks ?? [] }
}

export async function getEventCompetitions(identifier: string): Promise<unknown[]> {
  const res = await gatewazeFetch<{ data: unknown[] }>(eventPath(identifier, '/competitions'), {
    tags: [`event:${identifier}:competitions`],
    revalidate: DEFAULT_REVALIDATE,
  })
  return res?.data ?? []
}

export async function getEventDiscounts(identifier: string): Promise<unknown[]> {
  const res = await gatewazeFetch<{ data: unknown[] }>(eventPath(identifier, '/discounts'), {
    tags: [`event:${identifier}:discounts`],
    revalidate: DEFAULT_REVALIDATE,
  })
  return res?.data ?? []
}

export async function getEventMedia(
  identifier: string,
): Promise<{ media: unknown[]; albums: unknown[] }> {
  const res = await gatewazeFetch<{ media: unknown[]; albums: unknown[] }>(
    eventPath(identifier, '/media'),
    { tags: [`event:${identifier}:media`], revalidate: DEFAULT_REVALIDATE },
  )
  return { media: res?.media ?? [], albums: res?.albums ?? [] }
}

// ---------------------------------------------------------------------------
// Event listings (upcoming/past/all)
// ---------------------------------------------------------------------------

export interface EventListing {
  upcoming: Event[]
  past: Event[]
  all: Event[]
}

export async function getEventListing(): Promise<EventListing> {
  const res = await gatewazeFetch<EventListing>('/api/portal/events/all', {
    tags: ['events:list', 'events:list:all'],
    revalidate: DEFAULT_REVALIDATE,
  })
  return {
    upcoming: res?.upcoming ?? [],
    past: res?.past ?? [],
    all: res?.all ?? [],
  }
}

export async function getEventListingDirection(
  direction: 'upcoming' | 'past',
  opts: { limit?: number; offset?: number } = {},
): Promise<{ data: Event[]; total: number | null }> {
  const params = new URLSearchParams({ direction })
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.offset !== undefined) params.set('offset', String(opts.offset))
  const res = await gatewazeFetch<{ data: Event[]; total: number | null }>(
    `/api/portal/events?${params.toString()}`,
    { tags: ['events:list', `events:list:${direction}`], revalidate: DEFAULT_REVALIDATE },
  )
  return { data: res?.data ?? [], total: res?.total ?? null }
}
