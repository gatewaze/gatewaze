import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
// Stays on direct Supabase: this page reads per-talk `events_speakers`
// duration aggregates that aren't exposed by the portal API yet, and the
// edit-token flow is per-viewer (no shared CDN cache benefit).
// TODO: migrate when an /api/portal/events/:identifier/speaker-duration-counts
// endpoint exists.
import { createServerSupabase } from '@/lib/supabase/server'
import { SpeakerEditContent } from '@/components/event/SpeakerEditContent'
import { stripEmojis } from '@/lib/text'

import { resolveSiteName } from '@/lib/metadata-helpers'
interface Props {
  params: Promise<{ identifier: string }>
  searchParams: Promise<{ token?: string }>
}

async function getEventForMetadata(identifier: string, brandId: string) {
  const supabase = await createServerSupabase(brandId)

  let { data: event } = await supabase
    .from('events')
    .select('id, event_title, screenshot_url, event_logo')
    .eq('event_slug', identifier)
    .eq('is_live_in_production', true)
    .maybeSingle()

  if (!event) {
    const result = await supabase
      .from('events')
      .select('id, event_title, screenshot_url, event_logo')
      .eq('event_id', identifier)
      .eq('is_live_in_production', true)
      .maybeSingle()
    event = result.data
  }

  return event
}

async function getConfirmedDurationCounts(eventUuid: string, brandId: string): Promise<Record<number, number>> {
  const supabase = await createServerSupabase(brandId)

  const { data } = await supabase
    .from('events_speakers')
    .select('talk_duration_minutes')
    .eq('event_uuid', eventUuid)
    .eq('status', 'confirmed')
    .not('talk_duration_minutes', 'is', null)

  const counts: Record<number, number> = {}
  if (data) {
    for (const speaker of data) {
      const duration = speaker.talk_duration_minutes as number
      counts[duration] = (counts[duration] || 0) + 1
    }
  }
  return counts
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { identifier } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const event = await getEventForMetadata(identifier, brand)

  if (!event) {
    return {
      title: 'Edit Submission',
    }
  }

  const title = stripEmojis(event.event_title)

  return {
    title: `Edit Submission - ${title}`,
    description: `Edit your speaker submission for ${title}.`,
    openGraph: {
      title: `Edit Submission - ${title}`,
      description: `Edit your speaker submission for ${title}.`,
      images: event.screenshot_url ? [{ url: event.screenshot_url }] : event.event_logo ? [{ url: event.event_logo }] : [],
      type: 'website',
      siteName: await resolveSiteName(brandConfig.name, event.event_title),
    },
    twitter: {
      card: 'summary_large_image',
      title: `Edit Submission - ${title}`,
      description: `Edit your speaker submission for ${title}.`,
      images: event.screenshot_url ? [event.screenshot_url] : event.event_logo ? [event.event_logo] : [],
    },
  }
}

export default async function SpeakerEditPage({ params, searchParams }: Props) {
  const { identifier } = await params
  const { token } = await searchParams
  const brand = await getServerBrand()
  const event = await getEventForMetadata(identifier, brand)

  const confirmedDurationCounts = event?.id
    ? await getConfirmedDurationCounts(event.id, brand)
    : {}

  return (
    <SpeakerEditContent
      editToken={token}
      confirmedDurationCounts={confirmedDurationCounts}
    />
  )
}
