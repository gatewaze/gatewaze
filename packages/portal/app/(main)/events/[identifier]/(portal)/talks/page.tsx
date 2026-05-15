import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { getEvent, getEventTalks } from '@/lib/portal-data'
import { TalksFormContent } from '@/components/event/TalksFormContent'
import { stripEmojis } from '@/lib/text'
import { resolveEventImages } from '@/lib/storage-resolve'

import { resolveSiteName } from '@/lib/metadata-helpers'
interface Props {
  params: Promise<{ identifier: string }>
  searchParams: Promise<{ s?: string }>
}

async function getEventForMetadata(identifier: string, brandId: string) {
  const brandConfig = await getBrandConfigById(brandId)
  const event = await getEvent(identifier)
  return resolveEventImages(event, brandConfig.storageBucketUrl)
}

async function getConfirmedDurationCounts(identifier: string): Promise<Record<number, number>> {
  const talks = await getEventTalks(identifier)
  const counts: Record<number, number> = {}
  for (const t of talks) {
    const talk = t as { status?: string | null; duration_minutes?: number | null }
    if (talk.status === 'confirmed' && typeof talk.duration_minutes === 'number') {
      counts[talk.duration_minutes] = (counts[talk.duration_minutes] || 0) + 1
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
      siteName: await resolveSiteName(brandConfig.name, event.event_title),
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

  // Get confirmed speaker counts by duration for capacity tracking
  const confirmedDurationCounts = await getConfirmedDurationCounts(identifier)

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
