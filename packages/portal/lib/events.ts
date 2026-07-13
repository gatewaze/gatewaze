import { getEventListing, type EventListing } from '@/lib/portal-data'
import { createServerSupabase } from '@/lib/supabase/server'
import type { Event } from '@/types/event'

export type EventData = EventListing

// Routes through gatewazeFetch → CDN. The API endpoint
// `/api/portal/events/all` does the PostgREST pagination internally
// (see packages/api/src/routes/portal-events.ts paginate() — same
// PAGE_SIZE=1000 + MAX_PAGES=20 caps as the previous direct
// implementation). On Workers this hits the edge cache; on K8s + dev
// the wrapper falls through to the API directly.
//
// `brandId` is no longer used at this level — the API server is
// brand-implicit (per-brand deployment, single Supabase config) so the
// argument is preserved as `_brandId` only for source-compat with
// existing callers.
export async function getEvents(_brandId: string): Promise<EventData> {
  const data = await getEventListing()
  // The API computes the upcoming/past split at fetch time, but getEventListing
  // caches its response (60s + revalidateTag on admin edits). A time-sensitive
  // partition frozen in a cache goes stale: an event that was upcoming when the
  // response was cached lingers in `upcoming` after it has passed, until the
  // cache next refreshes. Re-filter with the CURRENT time at render (callers are
  // force-dynamic) so a past event is never shown as upcoming. Undated events
  // (null start) stay upcoming, matching the API's own `event_start IS NULL`
  // branch.
  const now = Date.now()
  const stillUpcoming = (e: Event) => {
    const start = (e as { event_start?: string | null }).event_start
    if (!start) return true
    const t = new Date(start).getTime()
    return Number.isNaN(t) || t >= now
  }
  return {
    upcoming: ((data.upcoming as Event[]) ?? []).filter(stillUpcoming),
    past: data.past as Event[],
    all: data.all as Event[],
  }
}

/**
 * Distinct event_type values across ALL published, listed events — the
 * unfiltered census that drives the type-filter pills. Derived from the whole
 * table (not the current page/filter) so every type with published events
 * keeps its pill while other filters are active.
 */
export async function getPublishedEventTypeValues(brandId: string): Promise<string[]> {
  const supabase = await createServerSupabase(brandId)
  const { data } = await supabase
    .from('events')
    .select('event_type')
    .eq('is_live_in_production', true)
    .eq('is_listed', true)
    .not('event_type', 'is', null)
    .limit(5000)
  return [...new Set((data ?? []).map((r: { event_type: string | null }) => (r.event_type ?? '').trim().toLowerCase()).filter(Boolean))]
}
