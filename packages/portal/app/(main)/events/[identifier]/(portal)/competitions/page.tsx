import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { getEvent } from '@/lib/portal-data'
import { CompetitionsContent } from '@/components/event/CompetitionsContent'
import { stripEmojis } from '@/lib/text'
import { resolveEventImages } from '@/lib/storage-resolve'

import { resolveSiteName } from '@/lib/metadata-helpers'
interface Props {
  params: Promise<{ identifier: string }>
}

async function getEventForMetadata(identifier: string, brandId: string) {
  const brandConfig = await getBrandConfigById(brandId)
  const event = await getEvent(identifier)
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
    }
  }

  const title = stripEmojis(event.event_title)

  return {
    title: `Competitions - ${title}`,
    description: `Enter competitions at ${title}`,
    openGraph: {
      title: `Competitions - ${title}`,
      description: `Enter competitions at ${title}`,
      images: event.screenshot_url ? [{ url: event.screenshot_url }] : event.event_logo ? [{ url: event.event_logo }] : [],
      type: 'website',
      siteName: await resolveSiteName(brandConfig.name, event.event_title),
    },
    twitter: {
      card: 'summary_large_image',
      title: `Competitions - ${title}`,
      description: `Enter competitions at ${title}`,
      images: event.screenshot_url ? [event.screenshot_url] : event.event_logo ? [event.event_logo] : [],
    },
  }
}

export default function CompetitionsPage() {
  return <CompetitionsContent />
}
