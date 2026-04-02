import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { getCalendarWithEvents } from '@/lib/calendars'
import { TimelineContent } from '@/components/timeline/TimelineContent'
import { CalendarHeader } from '@/components/calendar/CalendarHeader'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ identifier: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { identifier } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const result = await getCalendarWithEvents(brand, identifier)

  if (!result) {
    return { title: 'Calendar not found' }
  }

  return {
    title: `Map - ${result.calendar.name} - ${brandConfig.name}`,
    description: result.calendar.description || `Map view for ${result.calendar.name}`,
  }
}

export default async function CalendarMapPage({ params }: Props) {
  const { identifier } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const result = await getCalendarWithEvents(brand, identifier)

  if (!result) {
    notFound()
  }

  const { calendar, upcoming, past, all } = result

  return (
    <main className="relative z-10">
      <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8 py-8 sm:py-12">
        <CalendarHeader calendar={calendar} />
        <TimelineContent
          events={all}
          upcomingEvents={upcoming}
          pastEvents={past}
          brandConfig={brandConfig}
          view="map"
          basePath={`/calendars/${identifier}`}
        />
      </div>
    </main>
  )
}
