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

export async function getEvents(brandId: string): Promise<EventData> {
  const supabase = await createServerSupabase(brandId)
  const now = new Date().toISOString()

  // Fetch upcoming events (future start date or no start date set)
  // Only listed events appear in portal listings (unlisted events use custom domains)
  const { data: upcomingEvents } = await supabase
    .from('events')
    .select(EVENT_SELECT_FIELDS)
    .eq('is_live_in_production', true)
    .eq('is_listed', true)
    .or(`event_start.gte.${now},event_start.is.null`)
    .order('event_start', { ascending: true, nullsFirst: false })
    .limit(10000)

  // Fetch past events (ordered by start date descending, most recent first)
  const { data: pastEvents } = await supabase
    .from('events')
    .select(EVENT_SELECT_FIELDS)
    .eq('is_live_in_production', true)
    .eq('is_listed', true)
    .lt('event_start', now)
    .order('event_start', { ascending: false })
    .limit(10000)

  const upcoming = (upcomingEvents as Event[]) || []
  const past = (pastEvents as Event[]) || []

  return {
    upcoming,
    past,
    all: [...upcoming, ...past],
  }
}
