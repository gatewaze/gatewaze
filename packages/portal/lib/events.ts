import { getEventListing, type EventListing } from '@/lib/portal-data'
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
  return {
    upcoming: data.upcoming as Event[],
    past: data.past as Event[],
    all: data.all as Event[],
  }
}
