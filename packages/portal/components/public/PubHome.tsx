import Link from 'next/link'
import { PubEventCard, type PubEventCardEvent } from './PubEventCard'
import { PubBlogCard } from './PubBlogCard'
import type { BlogPostPreview } from '@/lib/blog'

/** Per-section cap so one busy type can't swallow the home page. */
const EVENTS_PER_TYPE = 3

function humanizeType(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

/**
 * Group upcoming events by event_type, ordered by the brand's configured
 * eventTypes (so operators control section order); unknown types follow in
 * first-seen order, untyped events land in a trailing "Other events" section.
 */
function groupByType(
  events: PubEventCardEvent[],
  eventTypes: { value: string; label: string }[],
): { key: string; label: string; events: PubEventCardEvent[] }[] {
  const byType = new Map<string, PubEventCardEvent[]>()
  for (const e of events) {
    const key = (e.event_type ?? '').trim().toLowerCase() || '__other__'
    const list = byType.get(key) ?? []
    list.push(e)
    byType.set(key, list)
  }

  const groups: { key: string; label: string; events: PubEventCardEvent[] }[] = []
  for (const t of eventTypes) {
    const list = byType.get(t.value.toLowerCase())
    if (list?.length) {
      groups.push({ key: t.value, label: t.label, events: list })
      byType.delete(t.value.toLowerCase())
    }
  }
  for (const [key, list] of byType) {
    if (key === '__other__') continue
    groups.push({ key, label: humanizeType(key), events: list })
  }
  const other = byType.get('__other__')
  if (other?.length) groups.push({ key: '__other__', label: 'Other events', events: other })
  return groups
}

/**
 * Public Home — "Upcoming events" grouped into a section per event type
 * (resources-style pub-card grid with the animated hover border) + "Latest
 * posts". Opens straight into content (no marketing hero). Rendered inside
 * the shell. Spec §8.1.
 */
export function PubHome({
  upcomingEvents,
  blogPosts,
  storageBucketUrl,
  eventTypes = [],
}: {
  upcomingEvents: PubEventCardEvent[]
  blogPosts: BlogPostPreview[]
  storageBucketUrl?: string
  /** Brand-configured event types, in display order (value → section label). */
  eventTypes?: { value: string; label: string }[]
}) {
  const eventGroups = groupByType(upcomingEvents, eventTypes)

  return (
    <div className="pub-wrap pub-fade">
      {upcomingEvents.length > 0 && (
        <section className="pub-sec">
          <div className="pub-sechead">
            <div className="pub-h">
              <h1>Upcoming events</h1>
              <p>Browse our latest events and register to attend.</p>
            </div>
            <Link href="/events/upcoming" className="pub-viewall">View all →</Link>
          </div>
          {eventGroups.map((group) => (
            <div key={group.key} className="pub-typesec">
              <h2 className="pub-typesec-h">{group.label}</h2>
              <div className="pub-grid">
                {group.events.slice(0, EVENTS_PER_TYPE).map((e) => (
                  <PubEventCard key={e.event_id} event={e} storageBucketUrl={storageBucketUrl} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {blogPosts.length > 0 && (
        <section className="pub-sec">
          <div className="pub-sechead">
            <div className="pub-h">
              <h1>Latest posts</h1>
            </div>
            <Link href="/blog" className="pub-viewall">View all →</Link>
          </div>
          <div className="pub-grid">
            {blogPosts.map((p) => (
              <PubBlogCard key={p.id} post={p} />
            ))}
          </div>
        </section>
      )}

      {upcomingEvents.length === 0 && blogPosts.length === 0 && (
        <div className="pub-empty">Nothing to show yet.</div>
      )}
    </div>
  )
}

export default PubHome
