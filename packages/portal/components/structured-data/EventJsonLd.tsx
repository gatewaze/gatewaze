import { convert } from 'html-to-text'

interface EventJsonLdProps {
  event: {
    event_title: string
    event_start: string | null
    event_end?: string | null
    event_location?: string | null
    venue_address?: string | null
    event_description?: string | null
    listing_intro?: string | null
    event_logo?: string | null
    screenshot_url?: string | null
    event_link?: string | null
    event_slug?: string | null
    enable_registration?: boolean | null
    is_live_in_production?: boolean | null
  }
  organizationName: string
  siteUrl: string
}

export function EventJsonLd({ event, organizationName, siteUrl }: EventJsonLdProps) {
  if (!event.event_title || !event.event_start) return null

  const description = event.event_description
    ? truncateOnWordBoundary(convert(event.event_description, { wordwrap: false }), 5000)
    : event.listing_intro ?? undefined

  const location = buildLocation(event)

  const eventStatus = 'https://schema.org/EventScheduled'
  const attendanceMode = event.event_link && !event.venue_address
    ? 'https://schema.org/OnlineEventAttendanceMode'
    : event.event_link && event.venue_address
      ? 'https://schema.org/MixedEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode'

  const availability = event.enable_registration
    ? 'https://schema.org/InStock'
    : 'https://schema.org/SoldOut'

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.event_title,
    startDate: event.event_start,
    ...(event.event_end && { endDate: event.event_end }),
    ...(description && { description }),
    ...(event.screenshot_url || event.event_logo
      ? { image: event.screenshot_url || event.event_logo }
      : {}),
    ...(location && { location }),
    eventStatus,
    eventAttendanceMode: attendanceMode,
    organizer: {
      '@type': 'Organization',
      name: organizationName,
      url: siteUrl,
    },
    offers: {
      '@type': 'Offer',
      availability,
      url: event.event_slug
        ? `${siteUrl}/events/${event.event_slug}`
        : undefined,
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

function buildLocation(event: EventJsonLdProps['event']) {
  if (event.event_link && !event.venue_address) {
    return {
      '@type': 'VirtualLocation',
      url: event.event_link,
    }
  }

  if (event.event_location || event.venue_address) {
    return {
      '@type': 'Place',
      ...(event.event_location && { name: event.event_location }),
      ...(event.venue_address && { address: event.venue_address }),
    }
  }

  return undefined
}

function truncateOnWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const truncated = text.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated
}
