import { createServerSupabase } from '@/lib/supabase/server'
import type { Event } from '@/types/event'

const EVENT_SELECT_FIELDS = `
  event_id,
  event_slug,
  event_title,
  event_start,
  event_end,
  event_timezone,
  event_city,
  event_region,
  event_country_code,
  event_location,
  venue_address,
  event_description,
  listing_intro,
  event_logo,
  screenshot_url,
  gradient_color_1,
  gradient_color_2,
  gradient_color_3,
  event_type,
  event_topics
`

export interface EventData {
  upcoming: Event[]
  past: Event[]
  all: Event[]
}

// Supabase Cloud projects ship with a server-side PostgREST cap of 1000
// rows per request (the "Max Rows" project-API setting). Production
// brands quickly exceed that for past events, and the cap is enforced
// regardless of the client's `.limit(N)` request — the response is
// silently truncated. Page through 1000-row windows until exhausted.
const PAGE_SIZE = 1000
// Hard ceiling so a runaway dataset can't take the whole portal home page
// down — 20k events is well past anything we have today.
const MAX_PAGES = 20

export async function getEvents(brandId: string): Promise<EventData> {
  const supabase = await createServerSupabase(brandId)
  const now = new Date().toISOString()

  async function paginate(direction: 'upcoming' | 'past'): Promise<Event[]> {
    const out: Event[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1
      let q = supabase
        .from('events')
        .select(EVENT_SELECT_FIELDS)
        .eq('is_live_in_production', true)
        .eq('is_listed', true)
      q = direction === 'upcoming'
        ? q
            .or(`event_start.gte.${now},event_start.is.null`)
            .order('event_start', { ascending: true, nullsFirst: false })
        : q
            .lt('event_start', now)
            .order('event_start', { ascending: false })
      const { data, error } = await q.range(from, to)
      if (error) throw error
      const rows = (data as Event[]) ?? []
      out.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }
    return out
  }

  // Fetch in parallel — the two windows don't overlap so they don't
  // contend on the same rows.
  const [upcoming, past] = await Promise.all([
    paginate('upcoming'),
    paginate('past'),
  ])

  return {
    upcoming,
    past,
    all: [...upcoming, ...past],
  }
}
