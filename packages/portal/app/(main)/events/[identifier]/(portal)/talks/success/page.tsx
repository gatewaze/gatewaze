import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import type { Event } from '@/types/event'
import { SpeakerSuccessContent } from '@/components/event/SpeakerSuccessContent'
import { stripEmojis } from '@/lib/text'

interface Props {
  params: Promise<{ identifier: string }>
  searchParams: Promise<{ token?: string; existing?: string; updated?: string; status_reset?: string }>
}

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
  gradient_color_3
`

async function getEvent(identifier: string, brandId: string): Promise<Event | null> {
  const supabase = await createServerSupabase(brandId)

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

  return event as Event | null
}

interface SpeakerInfo {
  status: string | null
  avatarUrl: string | null
  talkTitle: string | null
  presentationUrl: string | null
  presentationStoragePath: string | null
  presentationType: string | null
  speakerEmail: string | null
  calendarAddedAt: string | null
  trackingLinkCopiedAt: string | null
}

async function getSpeakerInfo(editToken: string, brandId: string): Promise<SpeakerInfo> {
  if (!editToken) return { status: null, avatarUrl: null, talkTitle: null, presentationUrl: null, presentationStoragePath: null, presentationType: null, speakerEmail: null, calendarAddedAt: null, trackingLinkCopiedAt: null }

  const supabase = await createServerSupabase(brandId)

  // Query event_talks by edit_token - status is now on this table
  // Then get speaker info via the junction table
  const { data: talk } = await supabase
    .from('events_talks')
    .select(`
      status,
      title,
      presentation_url,
      presentation_storage_path,
      presentation_type,
      calendar_added_at,
      tracking_link_copied_at,
      event_talk_speakers!inner (
        is_primary,
        speaker:event_speakers!inner (
          people_profiles!inner (
            people!inner (
              email,
              avatar_storage_path
            )
          )
        )
      )
    `)
    .eq('edit_token', editToken)
    .eq('event_talk_speakers.is_primary', true)
    .maybeSingle()

  if (!talk) return { status: null, avatarUrl: null, talkTitle: null, presentationUrl: null, presentationStoragePath: null, presentationType: null, speakerEmail: null, calendarAddedAt: null, trackingLinkCopiedAt: null }

  // Build avatar URL from storage path
  let avatarUrl: string | null = null
  const talkSpeaker = (talk.event_talk_speakers as any)?.[0]
  const avatarPath = talkSpeaker?.speaker?.people_profiles?.people?.avatar_storage_path
  if (avatarPath) {
    const { data: { publicUrl } } = supabase.storage
      .from('media')
      .getPublicUrl(avatarPath)
    avatarUrl = publicUrl
  }

  // Get presentation URL from storage if using storage
  let presentationUrl = talk.presentation_url
  if (talk.presentation_storage_path && !presentationUrl) {
    const { data: { publicUrl } } = supabase.storage
      .from('media')
      .getPublicUrl(talk.presentation_storage_path)
    presentationUrl = publicUrl
  }

  return {
    status: talk.status,
    avatarUrl,
    talkTitle: talk.title,
    presentationUrl,
    presentationStoragePath: talk.presentation_storage_path,
    presentationType: talk.presentation_type,
    speakerEmail: talkSpeaker?.speaker?.people_profiles?.people?.email || null,
    calendarAddedAt: talk.calendar_added_at,
    trackingLinkCopiedAt: (talk as any).tracking_link_copied_at
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { identifier } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const event = await getEvent(identifier, brand)

  if (!event) {
    return {
      title: 'Submission Received',
    }
  }

  const title = stripEmojis(event.event_title)

  return {
    title: `Submission Received - ${title}`,
    description: `Your speaker application for ${title} has been received.`,
    openGraph: {
      title: `Submission Received - ${title}`,
      description: `Your speaker application for ${title} has been received.`,
      images: event.screenshot_url ? [{ url: event.screenshot_url }] : event.event_logo ? [{ url: event.event_logo }] : [],
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary_large_image',
      title: `Submission Received - ${title}`,
      description: `Your speaker application for ${title} has been received.`,
      images: event.screenshot_url ? [event.screenshot_url] : event.event_logo ? [event.event_logo] : [],
    },
  }
}

export default async function SpeakerSuccessPage({ params, searchParams }: Props) {
  const { identifier } = await params
  const { token, existing, updated, status_reset } = await searchParams
  const brand = await getServerBrand()
  const event = await getEvent(identifier, brand)

  if (!event) {
    notFound()
  }

  // Fetch the actual speaker info from the database
  const speakerInfo = token ? await getSpeakerInfo(token, brand) : {
    status: null,
    avatarUrl: null,
    talkTitle: null,
    presentationUrl: null,
    presentationStoragePath: null,
    presentationType: null,
    speakerEmail: null,
    calendarAddedAt: null,
    trackingLinkCopiedAt: null,
  }

  return (
    <SpeakerSuccessContent
      editToken={token}
      isExisting={existing === 'true'}
      isUpdated={updated === 'true'}
      statusReset={status_reset === 'true'}
      speakerStatus={speakerInfo.status}
      speakerAvatarUrl={speakerInfo.avatarUrl}
      talkTitle={speakerInfo.talkTitle}
      presentationUrl={speakerInfo.presentationUrl}
      presentationStoragePath={speakerInfo.presentationStoragePath}
      presentationType={speakerInfo.presentationType}
      speakerEmail={speakerInfo.speakerEmail}
      calendarAddedAt={speakerInfo.calendarAddedAt}
      trackingLinkCopiedAt={speakerInfo.trackingLinkCopiedAt}
    />
  )
}
