import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getBlogPost, getBlogPosts } from '@/lib/blog'
import { SetBreadcrumb } from '@/components/shell/ShellContext'

interface Params { slug: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const post = await getBlogPost(slug)
  if (!post) return { title: 'Post not found' }
  return { title: post.title, description: post.excerpt ?? undefined }
}

function fmtDate(d: string | null): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Public blog article — two-column body + sticky sidebar, with Previous/Next siblings below so the
 * sticky column releases correctly. Rendered inside the workspace shell (spec §8.1). The body is
 * stored HTML from blog_posts.content (already sanitized at author time).
 */
export default async function BlogArticlePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const [post, all] = await Promise.all([getBlogPost(slug), getBlogPosts()])
  if (!post) notFound()

  const idx = all.findIndex((p) => p.slug === slug)
  const prev = idx > 0 ? all[idx - 1] : null
  const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null

  return (
    <div className="pub-article-wrap pub-fade">
      {/* publish the breadcrumb leaf (entity title) into the shell header */}
      <SetBreadcrumb title={post.title} />

      <div className="pub-article-grid">
        <article className="pub-article-main">
          <h1>{post.title}</h1>
          <div className="pub-byline">
            {fmtDate(post.published_at)}
            {post.reading_time ? ` · ${post.reading_time} min read` : ''}
          </div>
          {post.featured_image && (
            <div className="pub-cover lg" style={{ backgroundImage: `url(${post.featured_image})` }} />
          )}
          {/* content authored + sanitized upstream; rendered as-is */}
          <div className="pub-body" dangerouslySetInnerHTML={{ __html: post.content ?? '' }} />
        </article>

        <aside className="pub-article-side">
          {post.category && (
            <div className="pub-side-card">
              <div className="pub-side-h">Category</div>
              <span className="pub-cat" style={post.category.color ? { color: post.category.color } : undefined}>
                {post.category.name}
              </span>
            </div>
          )}
          <div className="pub-side-card">
            <div className="pub-side-h">Published</div>
            <div className="pub-side-val">{fmtDate(post.published_at)}</div>
            {post.reading_time ? <div className="pub-side-sub">{post.reading_time} min read</div> : null}
          </div>
        </aside>
      </div>

      {(prev || next) && (
        <div className="pub-prevnext">
          {[['Previous', prev], ['Next', next]].map(([label, p], i) =>
            p ? (
              <Link
                key={i}
                href={`/blog/${(p as { slug: string }).slug}`}
                className={`pub-pn-card${label === 'Next' ? ' next' : ''}`}
              >
                <div className="pub-pn-lbl">
                  {label === 'Previous' ? '← ' : ''}
                  {label as string}
                  {label === 'Next' ? ' →' : ''}
                </div>
                <div className="pub-pn-title">{(p as { title: string }).title}</div>
              </Link>
            ) : (
              <div key={i} />
            ),
          )}
        </div>
      )}
    </div>
  )
}
