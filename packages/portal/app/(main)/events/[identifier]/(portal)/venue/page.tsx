import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { VenueContent } from '@/components/event/VenueContent'
import { stripEmojis } from '@/lib/text'

interface Props {
  params: Promise<{ identifier: string }>
}

async function getEventForMetadata(identifier: string, brandId: string) {
  const supabase = await createServerSupabase(brandId)

  let { data: event } = await supabase
    .from('events')
    .select('event_title, screenshot_url, event_logo')
    .eq('event_slug', identifier)
    .eq('is_live_in_production', true)
    .maybeSingle()

  if (!event) {
    const result = await supabase
      .from('events')
      .select('event_title, screenshot_url, event_logo')
      .eq('event_id', identifier)
      .eq('is_live_in_production', true)
      .maybeSingle()
    event = result.data
  }

  return event
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { identifier } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const event = await getEventForMetadata(identifier, brand)

  if (!event) {
    return { title: 'Event Not Found' }
  }

  const title = stripEmojis(event.event_title)

  return {
    title: `Venue - ${title}`,
    description: `Venue information for ${title}`,
    openGraph: {
      title: `Venue - ${title}`,
      description: `Venue information for ${title}`,
      images: event.screenshot_url ? [{ url: event.screenshot_url }] : event.event_logo ? [{ url: event.event_logo }] : [],
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary_large_image',
      title: `Venue - ${title}`,
      description: `Venue information for ${title}`,
      images: event.screenshot_url ? [event.screenshot_url] : event.event_logo ? [event.event_logo] : [],
    },
  }
}

export default function VenuePage() {
  return <VenueContent />
}
