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

// All four event-detail reads now route through gatewazeFetch → CDN.
// Per spec-portal-on-cloudflare-workers §4.2 — replaces ~9 direct
// Supabase round-trips per page hit with 4 CDN-cacheable requests.
// Authenticated per-viewer reads (RSVP status, talk-edit, etc.)
// stay direct since they don't benefit from a shared cache.
//
// Cache tags live on the API side (packages/api/src/routes/portal-events.ts).
// Mutations (admin edits) trigger revalidateTag(...) via the existing
// webhook pipeline so the next portal read reaches a warm CDN within
// seconds, not the 60s default revalidate window.

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

  return (
    <>
      <EventJsonLd
        event={event}
        organizationName={brandConfig.name}
        siteUrl={`https://${brandConfig.domain}`}
      />
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
