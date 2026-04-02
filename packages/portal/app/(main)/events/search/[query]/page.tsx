import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { getEvents } from '@/lib/events'
import { TimelineContent } from '@/components/timeline/TimelineContent'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ query: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { query } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const decodedQuery = decodeURIComponent(query.replace(/-/g, ' '))

  return {
    title: `Search: ${decodedQuery} - ${brandConfig.name}`,
    description: `Search results for "${decodedQuery}" on ${brandConfig.name}`,
  }
}

export default async function SearchPage({ params }: Props) {
  const { query } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const { upcoming, past, all } = await getEvents(brand)
  const decodedQuery = decodeURIComponent(query.replace(/-/g, ' '))

  return (
    <main className="relative z-10">
      <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8 py-8 sm:py-12">
        <TimelineContent
          events={all}
          upcomingEvents={upcoming}
          pastEvents={past}
          brandConfig={brandConfig}
          view="upcoming"
          initialSearchQuery={decodedQuery}
        />
      </div>
    </main>
  )
}
