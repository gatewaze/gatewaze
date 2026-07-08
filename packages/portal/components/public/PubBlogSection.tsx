'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PubBlogCard } from './PubBlogCard'
import type { BlogPostPreview, ContentCategoryOption } from '@/lib/blog'

export interface PubBlogSectionData {
  /** Brand-configured content categories, in display-priority order. */
  categories: ContentCategoryOption[]
  /** Latest posts across all categories (the default "All" view). */
  all: BlogPostPreview[]
  /** Latest posts per category value. */
  byCategory: Record<string, BlogPostPreview[]>
}

/**
 * Home-page "Latest posts" with a content-category filter. Defaults to "All"
 * (latest across every category); chips appear only when at least one
 * configured category actually has posts.
 */
export function PubBlogSection({ categories, all, byCategory }: PubBlogSectionData) {
  const [selected, setSelected] = useState('all')
  if (all.length === 0) return null

  const chips = [
    { value: 'all', label: 'All' },
    ...categories.filter((c) => (byCategory[c.value] ?? []).length > 0),
  ]
  const posts = selected === 'all' ? all : byCategory[selected] ?? []

  return (
    <section className="pub-sec">
      <div className="pub-sechead">
        <div className="pub-h">
          <h1>Latest posts</h1>
        </div>
        <Link href="/blog" className="pub-viewall">View all →</Link>
      </div>
      {chips.length > 1 && (
        <div className="pub-chiprow" role="group" aria-label="Filter posts by content category">
          {chips.map((c) => (
            <button
              key={c.value}
              type="button"
              className={'pub-chip' + (selected === c.value ? ' active' : '')}
              aria-pressed={selected === c.value}
              onClick={() => setSelected(c.value)}
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
