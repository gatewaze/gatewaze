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
    title: `Event Calendar - ${brandConfig.name}`,
    description: `View all events in calendar format from ${brandConfig.name}`,
    openGraph: {
      title: `Event Calendar - ${brandConfig.name}`,
      description: `View all events in calendar format from ${brandConfig.name}`,
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary',
      title: `Event Calendar - ${brandConfig.name}`,
      description: `View all events in calendar format from ${brandConfig.name}`,
    },
  }
}

export default async function CalendarPage() {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const { upcoming, past, all } = await getEvents(brand)

  return (
    <div className="pub-wrap">
      <TimelineContent
        allEvents={all}
        upcomingEvents={upcoming}
        pastEvents={past}
        brandConfig={brandConfig}
        view="calendar"
      />
    </div>
  )
}
