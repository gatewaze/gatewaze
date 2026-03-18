import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { TalksFormContent } from '@/components/event/TalksFormContent'
import { stripEmojis } from '@/lib/text'

interface Props {
  params: Promise<{ identifier: string }>
  searchParams: Promise<{ s?: string }>
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
    .from('event_talks')
    .select('duration_minutes')
    .eq('event_uuid', eventUuid)
    .eq('status', 'confirmed')
    .not('duration_minutes', 'is', null)

  const counts: Record<number, number> = {}
  if (data) {
    for (const talk of data) {
      const duration = talk.duration_minutes as number
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
      title: 'Event Not Found',
    }
  }

  const title = stripEmojis(event.event_title)

  return {
    title: `Submit a Talk - ${title}`,
    description: `Submit your speaker application for ${title}`,
    openGraph: {
      title: `Submit a Talk - ${title}`,
      description: `Submit your speaker application for ${title}`,
      images: event.screenshot_url ? [{ url: event.screenshot_url }] : event.event_logo ? [{ url: event.event_logo }] : [],
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary_large_image',
      title: `Submit a Talk - ${title}`,
      description: `Submit your speaker application for ${title}`,
      images: event.screenshot_url ? [event.screenshot_url] : event.event_logo ? [event.event_logo] : [],
    },
  }
}

// Valid initial statuses that can be passed via URL
const VALID_INITIAL_STATUSES = ['pending', 'confirmed', 'approved', 'reserve']

export default async function TalksPage({ params, searchParams }: Props) {
  const { identifier } = await params
  const { s: statusParam } = await searchParams
  const brand = await getServerBrand()
  const event = await getEventForMetadata(identifier, brand)

  // Get confirmed speaker counts by duration for capacity tracking
  const confirmedDurationCounts = event?.id
    ? await getConfirmedDurationCounts(event.id, brand)
    : {}

  // Validate and normalize the initial status parameter
  const initialStatus = statusParam && VALID_INITIAL_STATUSES.includes(statusParam.toLowerCase())
    ? statusParam.toLowerCase()
    : 'pending'

  return (
    <TalksFormContent
      initialStatus={initialStatus}
      confirmedDurationCounts={confirmedDurationCounts}
    />
  )
}
