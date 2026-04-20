import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { AboutEventContent } from '@/components/event/AboutEventContent'
import { stripEmojis } from '@/lib/text'
import { resolveEventImages } from '@/lib/storage-resolve'

import { resolveSiteName } from '@/lib/metadata-helpers'
interface Props {
  params: Promise<{ identifier: string }>
}

async function getEventForMetadata(identifier: string, brandId: string) {
  const supabase = await createServerSupabase(brandId)
  const brandConfig = await getBrandConfigById(brandId)

  let { data: event } = await supabase
    .from('events')
    .select('event_title, event_description, listing_intro, screenshot_url, event_logo, event_link')
    .eq('event_slug', identifier)
    .eq('is_live_in_production', true)
    .maybeSingle()

  if (!event) {
    const result = await supabase
      .from('events')
      .select('event_title, event_description, listing_intro, screenshot_url, event_logo, event_link')
      .eq('event_id', identifier)
      .eq('is_live_in_production', true)
      .maybeSingle()
    event = result.data
  }

  return resolveEventImages(event, brandConfig.storageBucketUrl)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { identifier } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const event = await getEventForMetadata(identifier, brand)

  if (!event) {
    return {
      title: 'Event Not Found',
      description: 'This event could not be found.',
    }
  }

  const description = event.event_description || event.listing_intro || ''
  const truncatedDescription = description.length > 160
    ? description.substring(0, 157) + '...'
    : description

  const title = stripEmojis(event.event_title)

  return {
    title,
    description: truncatedDescription || `Register for ${title}`,
    ...(event.event_link && {
      alternates: {
        canonical: event.event_link,
      },
    }),
    openGraph: {
      title,
      description: truncatedDescription || `Register for ${title}`,
      images: event.screenshot_url ? [{ url: event.screenshot_url }] : event.event_logo ? [{ url: event.event_logo }] : [],
      type: 'website',
      siteName: await resolveSiteName(brandConfig.name, event.event_title),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: truncatedDescription || `Register for ${title}`,
      images: event.screenshot_url ? [event.screenshot_url] : event.event_logo ? [event.event_logo] : [],
    },
  }
}

export default function EventDetailPage() {
  // Event data comes from layout via context
  return <AboutEventContent />
}
