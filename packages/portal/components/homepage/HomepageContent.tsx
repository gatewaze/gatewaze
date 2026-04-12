'use client'

import Link from 'next/link'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import type { BlogPostPreview } from '@/lib/blog'
import type { PortalNavItem } from '@/lib/modules/enabledModules'
import { EventTimelineCard } from '@/components/timeline/EventTimelineCard'
import { HomepageSearch } from './HomepageSearch'

interface Props {
  brandConfig: BrandConfig
  navItems: PortalNavItem[]
  upcomingEvents: Event[]
  blogPosts: BlogPostPreview[]
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function HomepageContent({ brandConfig, navItems, upcomingEvents, blogPosts }: Props) {
  const hasBlog = navItems.some(n => n.moduleId === 'blog')
  const hasEvents = navItems.some(n => n.moduleId === '_core_events')

  return (
    <main className="relative z-10">
      <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Search */}
        <HomepageSearch brandConfig={brandConfig} />

        {/* Events Section */}
        {hasEvents && upcomingEvents.length > 0 && (
          <section className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Upcoming Events</h2>
              <Link
                href="/events/upcoming"
                className="text-base font-medium transition-colors hover:opacity-80"
                style={{ color: brandConfig.primaryColor }}
              >
                View all →
              </Link>
            </div>
            <div className="space-y-3">
              {upcomingEvents.map((event) => (
                <EventTimelineCard
                  key={event.event_id}
                  event={event}
                  brandConfig={brandConfig}
                  showDate
                />
              ))}
            </div>
          </section>
        )}

        {/* Blog Section */}
        {hasBlog && blogPosts.length > 0 && (
          <section className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Latest Posts</h2>
              <Link
                href="/blog"
                className="text-base font-medium transition-colors hover:opacity-80"
                style={{ color: brandConfig.primaryColor }}
              >
                View all →
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {blogPosts.map((post) => (
                <BlogCard key={post.id} post={post} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

function BlogCard({ post }: { post: BlogPostPreview }) {
  return (
    <Link href={`/blog/${post.slug}`} className="group block">
      <div className="relative rounded-xl overflow-hidden hover:brightness-110 transition-all duration-200" style={{ backgroundColor: `rgba(255,255,255,var(--glass-opacity,0.05))`, border: `1px solid rgba(255,255,255,var(--glass-border-opacity,0.1))` }}>
        {post.featured_image && (
          <div className="aspect-[16/9] overflow-hidden">
            <img
              src={post.featured_image}
              alt={post.featured_image_alt || post.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </div>
        )}
        <div className="p-4">
          {post.category && (
            <span
              className="inline-block text-base font-medium px-2.5 py-0.5 rounded-full mb-2"
              style={{ backgroundColor: post.category.color + '33', color: post.category.color }}
            >
              {post.category.name}
            </span>
          )}
          <h3 className="text-white font-semibold text-base group-hover:text-white/90 transition-colors line-clamp-2">
            {post.title}
          </h3>
          {post.excerpt && (
            <p className="text-white/60 text-base mt-2 line-clamp-2">{post.excerpt}</p>
          )}
          <div className="flex items-center gap-3 mt-3 text-white/40 text-base">
            {post.published_at && <span>{formatDate(post.published_at)}</span>}
            {post.reading_time && <span>{post.reading_time} min read</span>}
          </div>
        </div>
      </div>
    </Link>
  )
}
