import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { getEvents } from '@/lib/events'
import { TimelineContent } from '@/components/timeline/TimelineContent'

// Force dynamic rendering - this page uses headers() for brand detection
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)

  return {
    title: `Event Map - ${brandConfig.name}`,
    description: `View events on a map from ${brandConfig.name}`,
    openGraph: {
      title: `Event Map - ${brandConfig.name}`,
      description: `View events on a map from ${brandConfig.name}`,
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary',
      title: `Event Map - ${brandConfig.name}`,
      description: `View events on a map from ${brandConfig.name}`,
    },
  }
}

export default async function MapPage() {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const { upcoming, past, all } = await getEvents(brand)

  return (
    <main className="relative z-10">
      <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8 py-8 sm:py-12">
        <TimelineContent
          allEvents={all}
          upcomingEvents={upcoming}
          pastEvents={past}
          brandConfig={brandConfig}
          view="map"
        />
      </div>
    </main>
  )
}
