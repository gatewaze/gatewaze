import Link from 'next/link'
import type { BlogPostPreview } from '@/lib/blog'

function fmtDate(d: string | null): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Public blog post card — the prototype's `.pub-card`. Matches the blog module's index cards. */
export function PubBlogCard({ post, pill }: { post: BlogPostPreview; pill?: string | null }) {
  return (
    <Link href={`/blog/${post.slug}`} className="pub-card pub-card-flex gw-card-glow">
      {/* natural: show the whole cover at its own aspect ratio (no crop).
          Placeholders keep the default fixed aspect so they don't collapse. */}
      <div className={post.featured_image ? 'pub-cover natural' : 'pub-cover'}>
        {post.featured_image ? (
          <img src={post.featured_image} alt={post.featured_image_alt || post.title} />
        ) : (
          <span className="pub-cover-ph">cover</span>
        )}
      </div>
      <div className="pub-card-body">
        {pill && <span className="pub-cat">{pill}</span>}
        {post.category && (
          <span className="pub-cat" style={post.category.color ? { color: post.category.color } : undefined}>
            {post.category.name}
          </span>
        )}
        <h3>{post.title}</h3>
        {post.excerpt && <p>{post.excerpt}</p>}
        <div className="pub-meta pub-meta-pin">
          {fmtDate(post.published_at)}
          {post.reading_time ? (
            <>
              <span className="dotsep" />
              {post.reading_time} min read
            </>
          ) : null}
        </div>
      </div>
    </Link>
  )
}

export default PubBlogCard
