import Link from 'next/link'
import type { Metadata } from 'next'
import { getBlogPosts } from '@/lib/blog'
import { getServerBrandConfig } from '@/config/brand'

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getServerBrandConfig()
  return { title: 'Blog', description: `Latest posts from ${brand.name}` }
}

function fmtDate(d: string | null): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Public blog index — 3-col post cards, rendered inside the workspace shell (spec §8.1). */
export default async function BlogIndexPage() {
  const posts = await getBlogPosts()

  return (
    <div className="pub-wrap pub-fade">
      <div className="pub-h">
        <h1>Blog</h1>
        <p>Field notes, updates and stories from the community.</p>
      </div>

      {posts.length === 0 ? (
        <div className="pub-empty">No posts published yet.</div>
      ) : (
        <div className="pub-grid">
          {posts.map((p) => (
            <Link key={p.id} href={`/blog/${p.slug}`} className="pub-card">
              <div
                className="pub-cover"
                style={p.featured_image ? { backgroundImage: `url(${p.featured_image})` } : undefined}
              >
                {!p.featured_image && <span className="pub-cover-ph">cover</span>}
              </div>
              <div className="pub-card-body">
                {p.category && (
                  <span className="pub-cat" style={p.category.color ? { color: p.category.color } : undefined}>
                    {p.category.name}
                  </span>
                )}
                <h3>{p.title}</h3>
                {p.excerpt && <p>{p.excerpt}</p>}
                <div className="pub-meta">
                  {fmtDate(p.published_at)}
                  {p.reading_time ? (
                    <>
                      <span className="dotsep" />
                      {p.reading_time} min read
                    </>
                  ) : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
