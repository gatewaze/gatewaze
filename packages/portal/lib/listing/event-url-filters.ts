/**
 * Server-side parser for the events listing URL.
 *
 * The middleware (`packages/portal/middleware.ts`) rewrites legacy
 * path-style URLs `/events/{view}/{region?}/{typeSlug?}` into the
 * canonical query-string form `/events/{view}?region=…&type=…` before
 * the page renders, so the parser only has to honour:
 *   - `?region=eu`
 *   - `?type=conference`
 *   - `?topics=slug1,slug2`
 *   - `?q=…`
 *
 * The `pathname` argument is retained for flexibility (some calendar
 * subpages still carry path-style filters) but is treated as advisory.
 */

import type { ListingQuery } from '@gatewaze/shared/listing';
import type { EventTypeOption } from '@/config/brand';

const KNOWN_REGION_CODES = new Set(['as', 'af', 'eu', 'na', 'sa', 'oc', 'on']);

function pluralize(value: string): string {
  if (value.endsWith('y')) return value.slice(0, -1) + 'ies';
  if (value.endsWith('s') || value.endsWith('sh') || value.endsWith('ch')) return value + 'es';
  return value + 's';
}

function buildSlugMaps(types: EventTypeOption[]) {
  const slugToType: Record<string, string> = {};
  for (const t of types) {
    slugToType[pluralize(t.value)] = t.value;
  }
  return slugToType;
}

export interface ParsedEventUrl {
  view: 'upcoming' | 'past' | 'calendar' | 'map';
  region: string | null;
  eventType: string | null;
  topicSlugs: string[];
  search?: string;
}

/**
 * Parse one of:
 *   /events/upcoming
 *   /events/upcoming/eu
 *   /events/upcoming/eu/conferences
 *   /calendars/foo/upcoming/eu/conferences
 * plus query string `topics=slug1,slug2` and `q=…`.
 */
export function parseEventUrl(
  pathname: string,
  searchParams: URLSearchParams,
  eventTypes: EventTypeOption[],
): ParsedEventUrl {
  const slugToType = buildSlugMaps(eventTypes);
  const calendarMatch = pathname.match(/^\/calendars\/[^/]+\/(upcoming|past|calendar|map)(?:\/(.+))?/);
  const eventsMatch = pathname.match(/^\/events\/(upcoming|past|calendar|map)(?:\/(.+))?/);
  const match = calendarMatch || eventsMatch;
  if (!match) {
    return { view: 'upcoming', region: null, eventType: null, topicSlugs: [] };
  }

  const view = match[1] as ParsedEventUrl['view'];
  const rest = match[2] ?? '';
  let region: string | null = null;
  let eventType: string | null = null;
  if (rest) {
    const segments = rest.replace(/\/+$/, '').split('/').filter(Boolean);
    for (const seg of segments) {
      if (!region && KNOWN_REGION_CODES.has(seg)) region = seg;
      else if (!eventType && seg in slugToType) eventType = slugToType[seg];
    }
  }
  if (!region) {
    const queryRegion = searchParams.get('region');
    if (queryRegion && KNOWN_REGION_CODES.has(queryRegion)) region = queryRegion;
  }
  if (!eventType) {
    eventType = searchParams.get('type');
  }

  const topicsRaw = searchParams.get('topics') ?? '';
  const topicSlugs = topicsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const search = searchParams.get('q') ?? undefined;

  return { view, region, eventType, topicSlugs, search };
}

/**
 * Build a ListingQuery for the events listing schema from a parsed URL.
 * Caller injects `pageSize` and may override `sort`.
 */
export function eventListingQueryFromUrl(
  parsed: ParsedEventUrl,
  opts: { page?: number; pageSize?: number; sort?: ListingQuery['sort'] } = {},
): ListingQuery {
  const filters: Record<string, unknown> = {};

  if (parsed.view === 'upcoming' || parsed.view === 'past') {
    filters.view = parsed.view;
  }
  if (parsed.region) filters.region = [parsed.region];
  if (parsed.eventType) filters.eventType = [parsed.eventType];
  if (parsed.topicSlugs.length > 0) filters.topics = parsed.topicSlugs;

  return {
    page: opts.page ?? 0,
    pageSize: opts.pageSize ?? 50,
    sort: opts.sort,
    filters,
    search: parsed.search,
  };
}
