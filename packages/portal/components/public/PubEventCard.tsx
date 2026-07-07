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
  event_type?: string | null
  content_category?: string | null
  event_logo?: string | null
  screenshot_url?: string | null
}

/**
 * Public event card — the same `pub-card` treatment as the resources/blog
 * grids (cover on top, body below, animated gw-card-glow border on hover).
 * Token-driven via shell.css; renders inside the workspace shell.
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
  const img = rawImg ? toPublicUrl(rawImg, storageBucketUrl ?? '') ?? rawImg : ''
  const date = event.event_start ? formatEventDate(event.event_start) : ''
  const time = event.event_start ? formatEventTime(event.event_start) : ''
  const city = [event.event_city, event.event_country_code].filter(Boolean).join(', ')

  return (
    <Link href={url} className="pub-card gw-card-glow">
      <div className={img ? "pub-cover natural" : "pub-cover"}>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={event.event_title ?? ''} />
        ) : (
          <span className="pub-cover-ph">event</span>
        )}
      </div>
      <div className="pub-card-body">
        <h3>{event.event_title}</h3>
        <div className="pub-meta">
          {[date, time].filter(Boolean).join(' · ')}
          {city && (
            <>
              <span className="dotsep" />
              {city}
            </>
          )}
        </div>
      </div>
    </Link>
  )
}

export default PubEventCard
