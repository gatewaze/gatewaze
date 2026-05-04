import type { ThemeColors } from '@/config/brand'

export interface TalkDurationOption {
  duration: number  // minutes
  capacity: number  // max number of talks
}

export interface Event {
  id?: string // UUID primary key
  event_id: string
  event_slug: string | null
  event_title: string
  event_start: string
  event_end: string
  event_timezone: string | null
  event_city: string | null
  event_region: string | null
  event_country_code: string | null
  event_location: string | null
  venue_address: string | null
  event_description: string | null
  listing_intro: string | null
  event_link: string | null
  event_logo: string | null
  screenshot_url: string | null
  enable_registration: boolean | null
  enable_native_registration: boolean | null
  enable_call_for_speakers: boolean | null
  enable_agenda: boolean | null
  luma_event_id: string | null
  luma_processed_html: string | null
  meetup_processed_html: string | null
  is_live_in_production: boolean | null
  gradient_color_1: string | null
  gradient_color_2: string | null
  gradient_color_3: string | null
  portal_theme: string | null
  theme_colors: ThemeColors | null
  talk_duration_options: TalkDurationOption[] | null
  register_button_text: string | null
  page_content: string | null
  recommended_event_id: string | null
  gradual_eventslug?: string | null
  venue_content: string | null
  venue_map_image: string | null
  /** Latitude/longitude of the venue. Used to plot the venue marker + sort
   *  nearby_hotels ascending by distance. */
  event_latitude?: number | null
  event_longitude?: number | null
  /** Geocoded list of nearby accommodation, persisted as a JSONB array on
   *  events.nearby_hotels. Each entry has its own lat/lng + optional drive
   *  time/distance from the venue (computed at admin save time via OSRM). */
  nearby_hotels?: NearbyHotel[] | null
  addedpage_content: string | null
  addedpage_title: string | null
  event_type: string | null
  content_category: string | null
  event_topics: string[] | null
  custom_domain: string | null
  custom_domain_status: string | null
}

/**
 * One nearby accommodation entry, surfaced on the venue page sorted ascending
 * by distance from (event_latitude, event_longitude). Mirrors the admin's
 * NearbyHotel shape — JSONB stored verbatim (camelCase) so the admin form
 * round-trips without a translation layer.
 */
export interface NearbyHotel {
  id: string
  name: string
  postcode: string
  url?: string | null
  priceRange?: string | null
  lat: number | null
  lng: number | null
  geocodedAt?: string | null
  /** Driving time hotel → venue, in seconds. Best-effort (OSRM lookup). */
  driveSeconds?: number | null
  /** Driving distance hotel → venue via the road network, in metres. */
  driveDistanceMeters?: number | null
}

export interface EventCompetition {
  id: string
  event_id: string | null
  title: string
  slug: string
  value: string | null
  close_date: string | null
  close_display: string | null
  result: string | null
  intro: string | null
  content: string | null
  is_beta: boolean
  status: string
}

export interface EventDiscount {
  id: string
  event_id: string | null
  title: string
  slug: string
  value: string | null
  ticket_details: string | null
  close_date: string | null
  close_display: string | null
  intro: string | null
  content: string | null
  is_beta: boolean
  status: string
  luma_event_api_id?: string | null
  luma_api_key?: string | null
  luma_percent_off?: number | null
  max_codes?: number | null
  hidden?: boolean | null
}

export interface TrackingSession {
  id: string
  sessionId: string
  eventId: string | null
}

export interface TrackingParams {
  clickIds: Record<string, string>
  platformCookies: Record<string, string>
  utmParams: Record<string, string>
  referrer: string
  landingPage: string
  userAgent: string
}
