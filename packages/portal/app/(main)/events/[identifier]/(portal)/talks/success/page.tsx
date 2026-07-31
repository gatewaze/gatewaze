import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
// Per-viewer speaker info (looked up by edit_token) stays on direct
// Supabase — it's session-specific and would not benefit from CDN caching.
// Event-shape reads route through the portal-data helper (CDN-cached).
import { createServerSupabase } from '@/lib/supabase/server'
import { getEvent as getPortalEvent } from '@/lib/portal-data'
import { SpeakerSuccessContent } from '@/components/event/SpeakerSuccessContent'
import { stripEmojis } from '@/lib/text'

import { resolveSiteName } from '@/lib/metadata-helpers'
interface Props {
  params: Promise<{ identifier: string }>
  searchParams: Promise<{ token?: string; existing?: string; updated?: string; status_reset?: string }>
}

async function getEvent(identifier: string) {
  return getPortalEvent(identifier)
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

  // Plain decomposed lookups (talk → bridge → profile), no PostgREST embeds.
  // The previous embed went events_talk_speakers → events_speakers, but the
  // bridge's speaker_id FK points at events_speaker_profiles — PostgREST
  // can't resolve a relationship with no FK, the whole query 400'd, and the
  // page told a just-signed-in speaker their talk didn't exist.
  const { data: talk } = await supabase
    .from('events_talks')
    .select('id, status, title, presentation_url, presentation_storage_path, presentation_type, calendar_added_at, tracking_link_copied_at')
    .eq('edit_token', editToken)
    .maybeSingle()

  if (!talk) return { status: null, avatarUrl: null, talkTitle: null, presentationUrl: null, presentationStoragePath: null, presentationType: null, speakerEmail: null, calendarAddedAt: null, trackingLinkCopiedAt: null }

  // Primary speaker's profile (email + avatar). Best-effort: a missing
  // bridge row (pre-fix submissions) must not hide the talk itself.
  let profileNode: { email?: string | null; avatar_url?: string | null } | null = null
  const { data: bridge } = await supabase
    .from('events_talk_speakers')
    .select('speaker_id')
    .eq('talk_id', talk.id)
    .eq('is_primary', true)
    .maybeSingle()
  if (bridge?.speaker_id) {
    const { data: profile } = await supabase
      .from('events_speaker_profiles')
      .select('email, avatar_url')
      .eq('id', bridge.speaker_id)
      .maybeSingle()
    profileNode = profile ?? null
  }
  const avatarUrl: string | null = profileNode?.avatar_url || null

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
    speakerEmail: profileNode?.email || null,
    calendarAddedAt: talk.calendar_added_at,
    trackingLinkCopiedAt: (talk as { tracking_link_copied_at?: string | null }).tracking_link_copied_at ?? null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { identifier } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const event = await getEvent(identifier)

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
      siteName: await resolveSiteName(brandConfig.name, event.event_title),
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
  const event = await getEvent(identifier)

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
