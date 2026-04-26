import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { createPortalListingLoader, roundedNowIsoBucket } from '@gatewaze/shared/listing'
import { eventsListingSchema } from '@gatewaze-modules/events/listing-schema'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { TimelineContent } from '@/components/timeline/TimelineContent'
import { PortalListingErrorBoundary } from '@/components/listing/PortalListingErrorBoundary'
import { eventListingQueryFromUrl, parseEventUrl } from '@/lib/listing/event-url-filters'
import type { Event } from '@/types/event'
import type { PortalInitialPage } from '@/lib/listing/usePortalInfiniteListing'
import { DEFAULT_PORTAL_PAGE_SIZE } from '@/lib/listing/constants'

export const dynamic = 'force-dynamic'

const loader = createPortalListingLoader({ schema: eventsListingSchema })

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  return {
    title: `Past Events - ${brandConfig.name}`,
    description: `Browse past events from ${brandConfig.name}`,
    openGraph: {
      title: `Past Events - ${brandConfig.name}`,
      description: `Browse past events from ${brandConfig.name}`,
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary',
      title: `Past Events - ${brandConfig.name}`,
      description: `Browse past events from ${brandConfig.name}`,
    },
  }
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PastEventsPage({ searchParams }: PageProps) {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const params = await searchParams
  const flatParams: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') flatParams[k] = v
    else if (Array.isArray(v) && v.length > 0) flatParams[k] = v.join(',')
  }
  const urlParams = new URLSearchParams(flatParams)

  const reqHeaders = await headers()
  const pathname = reqHeaders.get('x-invoke-path') || reqHeaders.get('x-pathname') || '/events/past'

  const eventTypes = brandConfig.eventTypes ?? []
  const parsed = parseEventUrl(pathname, urlParams, eventTypes)
  parsed.view = 'past'
  const query = eventListingQueryFromUrl(parsed, {
    pageSize: DEFAULT_PORTAL_PAGE_SIZE,
    // Past events read most-recent first.
    sort: { column: 'eventStart', direction: 'desc' },
  })

  const ts = roundedNowIsoBucket(60_000)

  const supabase = await createServerSupabase(brand)
  const ctx = {
    consumer: 'portal' as const,
    brandId: brand,
    ip: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0',
    headers: Object.fromEntries(reqHeaders.entries()),
    requestId: reqHeaders.get('x-request-id') ?? `r${Date.now().toString(36)}`,
    extras: {},
  }

  let initialPage: PortalInitialPage<Event>
  let upcomingCount: number | null
  try {
    const [pageResult, countResult] = await Promise.all([
      loader.load(query, supabase, ctx, { ts }),
      loader.count(
        { ...query, filters: { ...query.filters, view: 'upcoming' }, sort: undefined },
        supabase,
        ctx,
        { ts },
      ),
    ])
    initialPage = {
      rows: pageResult.rows as unknown as Event[],
      page: pageResult.page,
      pageSize: pageResult.pageSize,
      totalCount: pageResult.totalCount,
      totalCountEstimate: pageResult.totalCountEstimate,
      countStrategy: pageResult.countStrategy,
      ts: pageResult.ts,
    }
    upcomingCount = countResult.count
  } catch (err) {
    return (
      <main className="relative z-10">
        <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8 py-8 sm:py-12">
          <PortalListingErrorBoundary error={err} retryHref="/events/past" />
        </div>
      </main>
    )
  }

  return (
    <main className="relative z-10">
      <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8 py-8 sm:py-12">
        <TimelineContent
          brandConfig={brandConfig}
          view="past"
          initialPage={initialPage}
          query={query}
          otherViewCount={upcomingCount}
        />
      </div>
    </main>
  )
}
