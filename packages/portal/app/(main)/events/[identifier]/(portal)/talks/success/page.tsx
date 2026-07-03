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

  // Query events_talks by edit_token — status is on this table. Speaker
  // contact/avatar comes from events_speaker_profiles (events_speakers'
  // only profile relation; the old people_profiles→people embed matched no
  // FK and made the whole query fail with PGRST200). The profile embed is a
  // LEFT join so RLS hiding profiles can't hide the talk itself.
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
      events_talk_speakers!inner (
        is_primary,
        speaker:events_speakers!inner (
          profile:events_speaker_profiles!speaker_id (
            email,
            avatar_url
          )
        )
      )
    `)
    .eq('edit_token', editToken)
    .eq('events_talk_speakers.is_primary', true)
    .maybeSingle()

  if (!talk) return { status: null, avatarUrl: null, talkTitle: null, presentationUrl: null, presentationStoragePath: null, presentationType: null, speakerEmail: null, calendarAddedAt: null, trackingLinkCopiedAt: null }

  // Supabase types !inner joins as deeply-nested arrays even when the
  // relation is structurally 1:1; cast through a narrow shape rather than `any`.
  type TalkSpeakerJoin = {
    speaker?: {
      profile?: { email?: string | null; avatar_url?: string | null }
        | Array<{ email?: string | null; avatar_url?: string | null }>
        | null
    } | Array<{
      profile?: { email?: string | null; avatar_url?: string | null }
        | Array<{ email?: string | null; avatar_url?: string | null }>
        | null
    }> | null
  }
  const talkSpeakerRaw = (talk.events_talk_speakers as TalkSpeakerJoin[] | null | undefined)?.[0]
  const speakerNode = Array.isArray(talkSpeakerRaw?.speaker) ? talkSpeakerRaw?.speaker[0] : talkSpeakerRaw?.speaker
  const profileNode = Array.isArray(speakerNode?.profile) ? speakerNode?.profile[0] : speakerNode?.profile
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
