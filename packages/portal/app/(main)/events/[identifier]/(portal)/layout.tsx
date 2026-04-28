import { notFound } from 'next/navigation'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { EventLayoutClient } from '@/components/event/EventLayoutClient'
import { AdPixels } from '@/components/tracking/AdPixels'
import { extractEventIdFromSlug } from '@/lib/slugify'
import { EventJsonLd } from '@/components/structured-data'
import { resolveEventImages } from '@/lib/storage-resolve'
import type { Event } from '@/types/event'

interface Props {
  children: React.ReactNode
  params: Promise<{ identifier: string }>
}

const EVENT_SELECT_FIELDS = `
  id,
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
  luma_processed_html,
  meetup_processed_html,
  event_link,
  event_logo,
  screenshot_url,
  enable_registration,
  enable_native_registration,
  enable_call_for_speakers,
  enable_agenda,
  luma_event_id,
  is_live_in_production,
  gradient_color_1,
  gradient_color_2,
  gradient_color_3,
  portal_theme,
  theme_colors,
  talk_duration_options,
  register_button_text,
  page_content,
  recommended_event_id,
  gradual_eventslug,
  venue_content,
  venue_map_image,
  addedpage_content,
  addedpage_title
`

export interface EventWithUuid extends Event {
  id: string
}

async function getEvent(identifier: string, brandId: string): Promise<EventWithUuid | null> {
  const supabase = await createServerSupabase(brandId)
  const brandConfig = await getBrandConfigById(brandId)

  // Try slug first, then event_id
  let { data: event } = await supabase
    .from('events')
    .select(EVENT_SELECT_FIELDS)
    .eq('event_slug', identifier)
    .eq('is_live_in_production', true)
    .maybeSingle()

  if (!event) {
    const result = await supabase
      .from('events')
      .select(EVENT_SELECT_FIELDS)
      .eq('event_id', identifier)
      .eq('is_live_in_production', true)
      .maybeSingle()
    event = result.data
  }

  // Fallback: extract event_id from end of slug (handles stale/modified slugs)
  if (!event && identifier.includes('-')) {
    const extractedId = extractEventIdFromSlug(identifier)
    if (extractedId !== identifier) {
      const result = await supabase
        .from('events')
        .select(EVENT_SELECT_FIELDS)
        .eq('event_id', extractedId)
        .eq('is_live_in_production', true)
        .maybeSingle()
      event = result.data
    }
  }

  return resolveEventImages(event as EventWithUuid | null, brandConfig.storageBucketUrl) ?? null
}

/**
 * Whether the virtual-events module has been configured for this event.
 * Returns true when a row exists in `live_event_config` for the event uuid.
 * Returns false if the table doesn't exist (module not installed) — table-
 * not-found is treated as "no virtual event" rather than a hard error so
 * the layout still renders cleanly on brands without the module.
 */
async function getHasVirtualEvent(eventUuid: string, brandId: string): Promise<boolean> {
  const supabase = await createServerSupabase(brandId)
  const { count, error } = await supabase
    .from('live_event_config')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventUuid)
  if (error) return false
  return (count ?? 0) > 0
}

async function getSpeakerCount(eventUuid: string, brandId: string): Promise<number> {
  const supabase = await createServerSupabase(brandId)
  // Count confirmed speakers first
  const { count: confirmedCount } = await supabase
    .from('events_speakers_with_details')
    .select('*', { count: 'exact', head: true })
    .eq('event_uuid', eventUuid)
    .eq('status', 'confirmed')

  if (confirmedCount && confirmedCount > 0) return confirmedCount

  // Fall back to placeholder speakers
  const { count: placeholderCount } = await supabase
    .from('events_speakers_with_details')
    .select('*', { count: 'exact', head: true })
    .eq('event_uuid', eventUuid)
    .eq('status', 'placeholder')

  return placeholderCount || 0
}

async function getSponsorCount(eventId: string, brandId: string): Promise<number> {
  const supabase = await createServerSupabase(brandId)
  const { count } = await supabase
    .from('events_sponsors')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('is_active', true)

  return count || 0
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

async function getCompetitionCount(eventId: string, brandId: string): Promise<number> {
  const supabase = await createServerSupabase(brandId)
  const { count } = await supabase
    .from('events_competitions')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'active')

  return count || 0
}

async function getDiscountCount(eventId: string, brandId: string): Promise<number> {
  const supabase = await createServerSupabase(brandId)
  const { count } = await supabase
    .from('events_discounts')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'active')

  return count || 0
}

async function getMediaCount(eventId: string, brandId: string): Promise<number> {
  const supabase = await createServerSupabase(brandId)
  const { count } = await supabase
    .from('events_media')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('file_type', 'photo')

  return count || 0
}

async function getRecommendedEvent(recommendedEventId: string, brandId: string): Promise<RecommendedEvent | null> {
  const supabase = await createServerSupabase(brandId)
  const brandConfig = await getBrandConfigById(brandId)

  const { data } = await supabase
    .from('events')
    .select('id, event_id, event_title, event_start, event_end, event_city, event_country_code, screenshot_url, event_logo, event_link, register_button_text, enable_registration')
    .eq('id', recommendedEventId)
    .eq('is_live_in_production', true)
    .maybeSingle()

  return resolveEventImages(data as RecommendedEvent | null, brandConfig.storageBucketUrl) ?? null
}

interface AdPixelConfig {
  reddit?: { pixelId: string }
  meta?: { pixelId: string }
}

async function getAdPixelConfig(eventId: string, brandId: string): Promise<AdPixelConfig> {
  const supabase = await createServerSupabase(brandId)
  const config: AdPixelConfig = {}

  // Fetch Reddit and Meta configs in parallel
  const [redditResult, metaResult] = await Promise.all([
    supabase.rpc('integrations_get_ad_platform_config', { p_event_id: eventId, p_platform: 'reddit' }),
    supabase.rpc('integrations_get_ad_platform_config', { p_event_id: eventId, p_platform: 'meta' }),
  ])

  // Extract pixel IDs from credentials, with env var fallback
  if (redditResult.data?.credentials?.pixel_id) {
    config.reddit = { pixelId: redditResult.data.credentials.pixel_id }
  } else if (process.env.REDDIT_PIXEL_ID) {
    config.reddit = { pixelId: process.env.REDDIT_PIXEL_ID }
  }

  if (metaResult.data?.credentials?.pixel_id) {
    config.meta = { pixelId: metaResult.data.credentials.pixel_id }
  } else if (process.env.META_PIXEL_ID) {
    config.meta = { pixelId: process.env.META_PIXEL_ID }
  }

  return config
}

export default async function EventDetailLayout({ children, params }: Props) {
  const { identifier } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const event = await getEvent(identifier, brand)

  if (!event) {
    notFound()
  }

  const [speakerCount, sponsorCount, competitionCount, discountCount, mediaCount, adPixelConfig, hasVirtualEvent] = await Promise.all([
    getSpeakerCount(event.id, brand),
    getSponsorCount(event.event_id, brand),
    getCompetitionCount(event.event_id, brand),
    getDiscountCount(event.event_id, brand),
    getMediaCount(event.id, brand),
    getAdPixelConfig(event.event_id, brand),
    getHasVirtualEvent(event.id, brand),
  ])

  const recommendedEvent = event.recommended_event_id
    ? await getRecommendedEvent(event.recommended_event_id, brand)
    : null

  return (
    <>
      <EventJsonLd
        event={event}
        organizationName={brandConfig.name}
        siteUrl={`https://${brandConfig.domain}`}
      />
      {/* Ad tracking pixels (Reddit, Meta) - only load if configured */}
      {(adPixelConfig.reddit || adPixelConfig.meta) && (
        <AdPixels config={adPixelConfig} />
      )}
      <EventLayoutClient
        event={event}
        brandConfig={brandConfig}
        eventIdentifier={identifier}
        speakerCount={speakerCount}
        sponsorCount={sponsorCount}
        competitionCount={competitionCount}
        discountCount={discountCount}
        mediaCount={mediaCount}
        hasVirtualEvent={hasVirtualEvent}
        recommendedEvent={recommendedEvent}
      >
        {children}
      </EventLayoutClient>
    </>
  )
}
