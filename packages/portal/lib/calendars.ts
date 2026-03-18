import { createServerSupabase } from '@/lib/supabase/server'
import type { Event } from '@/types/event'
import type { Calendar } from '@/types/calendar'

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

export interface CalendarWithEvents {
  calendar: Calendar
  upcoming: Event[]
  past: Event[]
  all: Event[]
}

/**
 * Look up a calendar by its slug or calendar_id (e.g., "bond" or "CAL-MQQWYJVB")
 * Then fetch all events linked to that calendar via the calendar_events junction table.
 */
export async function getCalendarWithEvents(
  brandId: string,
  identifier: string
): Promise<CalendarWithEvents | null> {
  const supabase = await createServerSupabase(brandId)

  // Look up calendar by slug or calendar_id
  const { data: calendar } = await supabase
    .from('calendars')
    .select('id, calendar_id, name, description, slug, color, logo_url, cover_image_url, visibility')
    .or(`slug.eq.${identifier},calendar_id.eq.${identifier}`)
    .eq('is_active', true)
    .eq('visibility', 'public')
    .single()

  if (!calendar) {
    return null
  }

  // Fetch all events for this calendar via the junction table
  const { data: rows } = await supabase
    .from('calendar_events')
    .select(`events!inner(${EVENT_SELECT_FIELDS})`)
    .eq('calendar_id', calendar.id)
    .eq('events.is_live_in_production', true)
    .limit(10000)

  const allEvents = (rows || []).map((row: any) => row.events as Event)
  const now = new Date().toISOString()

  // Split into upcoming and past, sorted appropriately
  const upcoming = allEvents
    .filter((e) => e.event_start >= now)
    .sort((a, b) => a.event_start.localeCompare(b.event_start))

  const past = allEvents
    .filter((e) => e.event_start < now)
    .sort((a, b) => b.event_start.localeCompare(a.event_start))

  return {
    calendar: calendar as Calendar,
    upcoming,
    past,
    all: [...upcoming, ...past],
  }
}
