'use client'

import { useState } from 'react'
import Link from 'next/link'
import { isLightColor } from '@/config/brand'
import { PubBlogCard } from './PubBlogCard'
import type { BlogPostPreview, ContentCategoryOption } from '@/lib/blog'

export interface PubBlogSectionData {
  /** Brand-configured content categories, in display-priority order. */
  categories: ContentCategoryOption[]
  /** Latest posts across all categories (the default "All" view). */
  all: BlogPostPreview[]
  /** Latest posts per category value. */
  byCategory: Record<string, BlogPostPreview[]>
  /** Brand primary, passed from the server (client-side brand lookup would
   *  differ from the SSR default and cause a hydration mismatch). */
  primaryColor: string
}

/** The events page's filter-pill look (see EventFilters): brand-primary when
 *  active, glass panel otherwise, 200ms transition. */
function pillStyle(active: boolean, primaryColor: string): React.CSSProperties {
  return {
    borderRadius: 'var(--radius-control)',
    ...(active
      ? {
          backgroundColor: primaryColor,
          color: isLightColor(primaryColor) ? '#000000' : '#ffffff',
          border: '1px solid transparent',
        }
      : {
          backgroundColor: 'rgba(var(--panel-tint,0,0,0),var(--glass-opacity,0.05))',
          backdropFilter: 'blur(var(--glass-blur,4px))',
          WebkitBackdropFilter: 'blur(var(--glass-blur,4px))',
          border: '1px solid rgba(var(--panel-tint,0,0,0),var(--glass-border-opacity,0.1))',
        }),
  }
}

/**
 * Home-page "Latest posts" with a content-category filter, styled like the
 * events page's type filter. Defaults to "All" (latest across every
 * category); chips appear only when at least one configured category
 * actually has posts. Clicking the active category toggles back to All.
 */
export function PubBlogSection({ categories, all, byCategory, primaryColor }: PubBlogSectionData) {
  const [selected, setSelected] = useState<string | null>(null)
  if (all.length === 0) return null

  const withPosts = categories.filter((c) => (byCategory[c.value] ?? []).length > 0)
  const posts = selected ? byCategory[selected] ?? [] : all

  const pillClass = (active: boolean) =>
    `cursor-pointer px-3 py-1.5 text-base font-medium transition-all duration-200 ${
      active ? 'shadow-lg' : 'text-white/70 hover:text-white'
    }`

  return (
    <section className="pub-sec">
      <div className="pub-sechead">
        <div className="pub-h">
          <h1>Latest posts</h1>
        </div>
        <Link href="/blog" className="pub-viewall">View all →</Link>
      </div>
      {withPosts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-3.5" role="group" aria-label="Filter posts by content category">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={pillClass(!selected)}
            style={pillStyle(!selected, primaryColor)}
            aria-pressed={!selected}
          >
            All
          </button>
          {withPosts.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setSelected(selected === c.value ? null : c.value)}
              className={pillClass(selected === c.value)}
              style={pillStyle(selected === c.value, primaryColor)}
              aria-pressed={selected === c.value}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="pub-grid">
        {posts.map((p) => (
          <PubBlogCard
            key={p.id}
            post={p}
            pill={categories.find((c) => c.value === p.content_category)?.label ?? p.content_category}
          />
        ))}
      </div>
    </section>
  )
}

export default PubBlogSection
