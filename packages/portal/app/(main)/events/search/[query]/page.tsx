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
    <div className="pub-wrap">
      <TimelineContent
        allEvents={all}
        upcomingEvents={upcoming}
        pastEvents={past}
        brandConfig={brandConfig}
        view="upcoming"
        initialSearchQuery={decodedQuery}
      />
    </div>
  )
}
