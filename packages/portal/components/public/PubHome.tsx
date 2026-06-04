import Link from 'next/link'
import { PubEventCard, type PubEventCardEvent } from './PubEventCard'
import { PubBlogCard } from './PubBlogCard'
import type { BlogPostPreview } from '@/lib/blog'

/**
 * Public Home — the prototype's PubHome: "Upcoming events" (2-col event cards) + "Latest posts"
 * (3-col blog cards). Opens straight into content (no marketing hero). Rendered inside the shell.
 * Spec §8.1.
 */
export function PubHome({
  upcomingEvents,
  blogPosts,
  storageBucketUrl,
}: {
  upcomingEvents: PubEventCardEvent[]
  blogPosts: BlogPostPreview[]
  storageBucketUrl?: string
}) {
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
          <div className="pub-ev-grid">
            {upcomingEvents.map((e) => (
              <PubEventCard key={e.event_id} event={e} storageBucketUrl={storageBucketUrl} />
            ))}
          </div>
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
