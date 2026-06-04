import Link from 'next/link'
import { toPublicUrl } from '@gatewaze/shared'
import { formatEventDate, formatEventTime } from '@/components/timeline/utils'

/** Minimal event shape this card reads (subset of the events listing row). */
export interface PubEventCardEvent {
  event_id: string
  event_slug?: string | null
  event_title?: string | null
  event_city?: string | null
  event_country_code?: string | null
  event_start?: string | null
  content_category?: string | null
  event_logo?: string | null
  screenshot_url?: string | null
}

/**
 * Public event card — the prototype's `.pub-ev` (info left, square poster right). Token-driven via
 * shell.css; renders inside the workspace shell. Spec §8.1 (Events / Home).
 */
export function PubEventCard({
  event,
  storageBucketUrl,
}: {
  event: PubEventCardEvent
  storageBucketUrl?: string
}) {
  const url = `/events/${event.event_slug || event.event_id}`
  const rawImg = event.event_logo || event.screenshot_url || ''
  const img = rawImg ? toPublicUrl(rawImg, storageBucketUrl) ?? rawImg : ''
  const date = event.event_start ? formatEventDate(event.event_start) : ''
  const time = event.event_start ? formatEventTime(event.event_start) : ''
  const city = [event.event_city, event.event_country_code].filter(Boolean).join(', ')

  return (
    <Link href={url} className="pub-ev">
      <div className="info">
        {event.content_category && <span className="pub-ev-cat">{event.content_category}</span>}
        <h3>{event.event_title}</h3>
        <div className="pub-ev-lines">
          <div className="l1">{[date, time].filter(Boolean).join(' · ')}</div>
          {city && <div className="l2">{city}</div>}
        </div>
      </div>
      <div
        className="pub-ev-poster"
        style={img ? { backgroundImage: `url(${img})` } : undefined}
      />
    </Link>
  )
}

export default PubEventCard
