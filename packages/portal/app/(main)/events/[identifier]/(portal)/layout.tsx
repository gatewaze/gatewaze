import { notFound } from 'next/navigation'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import {
  getEvent,
  getEventCounts,
  getEventAdPixels,
  getEventRecommended,
  type EventWithUuid,
  type RecommendedEvent,
  type AdPixelConfig,
} from '@/lib/portal-data'
import { EventLayoutClient } from '@/components/event/EventLayoutClient'
import { AdPixels } from '@/components/tracking/AdPixels'
import { EventJsonLd } from '@/components/structured-data'
import { resolveEventImages } from '@/lib/storage-resolve'

// Re-export for downstream consumers (page.tsx files referenced these
// types directly from the layout).
export type { EventWithUuid, RecommendedEvent } from '@/lib/portal-data'

interface Props {
  children: React.ReactNode
  params: Promise<{ identifier: string }>
}

// All four event-detail reads route through gatewazeFetch → CDN.
// Per spec-portal-on-cloudflare-workers §4.2 — replaces ~9 direct
// Supabase round-trips per page hit with 4 requests.
// Authenticated per-viewer reads (RSVP status, talk-edit, etc.)
// stay direct since they don't benefit from a shared cache.
//
// NOTE on freshness: the tag-purge ("revalidateTag via webhook") pipeline the
// original design assumed was NEVER BUILT — nothing invalidates the Next data
// cache on admin edits. Event + counts reads are therefore per-request
// (revalidate: 0 in lib/portal-data.ts) so date/CFP/registration state is
// always current; only the rarely-changing reads (ad-pixels, recommended)
// keep a time-based cache.

export default async function EventDetailLayout({ children, params }: Props) {
  const { identifier } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)

  const eventRaw = await getEvent(identifier)
  const event = resolveEventImages(eventRaw, brandConfig.storageBucketUrl)

  if (!event) {
    notFound()
  }

  const [counts, adPixelConfig, recommendedRaw] = await Promise.all([
    getEventCounts(identifier),
    getEventAdPixels(identifier),
    event.recommended_event_id ? getEventRecommended(identifier) : Promise.resolve(null),
  ])

  const speakerCount = counts?.speakerCount ?? 0
  const sponsorCount = counts?.sponsorCount ?? 0
  const competitionCount = counts?.competitionCount ?? 0
  const discountCount = counts?.discountCount ?? 0
  const mediaCount = counts?.mediaCount ?? 0
  const hasVirtualEvent = counts?.hasVirtualEvent ?? false
  const recommendedEvent = resolveEventImages(recommendedRaw, brandConfig.storageBucketUrl)

  const eventUrl = `https://${brandConfig.domain}/events/${event.event_slug || event.event_id}`
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Events', item: `https://${brandConfig.domain}/events/upcoming` },
      { '@type': 'ListItem', position: 2, name: event.event_title, item: eventUrl },
    ],
  }

  return (
    <>
      <EventJsonLd
        event={event}
        organizationName={brandConfig.name}
        siteUrl={`https://${brandConfig.domain}`}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      {/* Ad tracking pixels (Reddit, Meta) - only load if configured */}
      {adPixelConfig && (adPixelConfig.reddit || adPixelConfig.meta) && (
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
