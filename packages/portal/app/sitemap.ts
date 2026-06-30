import type { MetadataRoute } from 'next'
import { getServerBrandConfig } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { getNavVisibleModuleIds } from '@/lib/modules/navVisible'
import { editionFolderSlug } from '@gatewaze-modules/newsletters/lib/edition-slug'

export const dynamic = 'force-dynamic'

type Entry = MetadataRoute.Sitemap[number]

// Per-table fetch cap. Brands well under this today; revisit with a sitemap
// index (split by type) if any single source approaches it.
const LIMIT = 10000

/** ISO timestamp → Date for `lastModified`, tolerant of null/garbage. */
function lastmod(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/**
 * Brand-aware sitemap. Enumerates every nav-visible content module's public
 * records so crawlers and AI agents can discover all of them.
 *
 * Gating is enforced by RLS: `createServerSupabase` uses the anon key, so a
 * plain `status='published'` / `is_listed=true` filter returns exactly the
 * publicly-visible set (e.g. resources in non-public collections never surface).
 *
 * Structured as one block per content source — add a module's public content by
 * appending a block. A future refactor can drive this from each module's
 * declarative `publicContentSources` descriptor once those are serialisable and
 * surfaced to the portal (today they live in module index.ts, function-valued).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const brand = await getServerBrandConfig()
  const baseUrl = `https://${brand.domain}`
  const supabase = await createServerSupabase(brand.id)

  // Gate on NAV VISIBILITY, not merely `enabled`: a module hidden from the site
  // nav (content "not ready for public consumption") is excluded from the
  // sitemap too, so it's never advertised for crawling.
  const navVisible = await getNavVisibleModuleIds()

  const entries: Entry[] = [
    { url: baseUrl, changeFrequency: 'daily', priority: 1.0 },
  ]

  // ── Events ────────────────────────────────────────────────────────────────
  if (navVisible.has('events')) {
    entries.push(
      { url: `${baseUrl}/events/upcoming`, changeFrequency: 'daily', priority: 0.9 },
      { url: `${baseUrl}/events/past`, changeFrequency: 'daily', priority: 0.8 },
      { url: `${baseUrl}/events/calendar`, changeFrequency: 'daily', priority: 0.8 },
      { url: `${baseUrl}/events/map`, changeFrequency: 'daily', priority: 0.8 },
    )
    const { data } = await supabase
      .from('events')
      .select('event_slug, event_id, updated_at')
      .eq('is_live_in_production', true)
      .eq('is_listed', true)
      .limit(LIMIT)
    for (const e of data ?? []) {
      entries.push({
        url: `${baseUrl}/events/${e.event_slug || e.event_id}`,
        lastModified: lastmod(e.updated_at),
        changeFrequency: 'weekly',
        priority: 0.7,
      })
    }
  }

  // ── Calendars ───────────────────────────────────────────────────────────────
  if (navVisible.has('calendars')) {
    const { data } = await supabase
      .from('calendars')
      .select('slug, calendar_id, updated_at')
      .eq('is_active', true)
      .eq('visibility', 'public')
      .limit(LIMIT)
    for (const c of data ?? []) {
      entries.push({
        url: `${baseUrl}/calendars/${c.slug || c.calendar_id}/upcoming`,
        lastModified: lastmod(c.updated_at),
        changeFrequency: 'daily',
        priority: 0.7,
      })
    }
  }

  // ── Newsletters ─────────────────────────────────────────────────────────────
  if (navVisible.has('newsletters')) {
    entries.push({ url: `${baseUrl}/newsletters`, changeFrequency: 'weekly', priority: 0.6 })

    const { data: collections } = await supabase
      .from('newsletters_template_collections')
      .select('id, slug, updated_at')
      .limit(LIMIT)
    const slugByCollection = new Map<string, string>()
    for (const c of collections ?? []) {
      if (!c.slug) continue
      slugByCollection.set(c.id, c.slug)
      entries.push({
        url: `${baseUrl}/newsletters/${c.slug}`,
        lastModified: lastmod(c.updated_at),
        changeFrequency: 'weekly',
        priority: 0.5,
      })
    }

    const { data: editions } = await supabase
      .from('newsletters_editions')
      .select('collection_id, title, edition_date, updated_at')
      .eq('status', 'published')
      .limit(LIMIT)
    for (const ed of editions ?? []) {
      const collectionSlug = slugByCollection.get(ed.collection_id)
      if (!collectionSlug) continue
      entries.push({
        url: `${baseUrl}/newsletters/${collectionSlug}/${editionFolderSlug(ed.edition_date, ed.title)}`,
        lastModified: lastmod(ed.updated_at),
        changeFrequency: 'monthly',
        priority: 0.6,
      })
    }
  }

  // ── Resources ───────────────────────────────────────────────────────────────
  if (navVisible.has('resources')) {
    entries.push({ url: `${baseUrl}/resources`, changeFrequency: 'weekly', priority: 0.6 })

    // Anon RLS returns only published collections with access='public'.
    const { data: collections } = await supabase
      .from('sr_collections')
      .select('id, slug, updated_at')
      .eq('status', 'published')
      .limit(LIMIT)
    const slugByCollection = new Map<string, string>()
    for (const c of collections ?? []) {
      if (!c.slug) continue
      slugByCollection.set(c.id, c.slug)
      entries.push({
        url: `${baseUrl}/resources/${c.slug}`,
        lastModified: lastmod(c.updated_at),
        changeFrequency: 'weekly',
        priority: 0.5,
      })
    }

    const { data: items } = await supabase
      .from('sr_items')
      .select('collection_id, slug, updated_at')
      .eq('status', 'published')
      .limit(LIMIT)
    for (const item of items ?? []) {
      const collectionSlug = slugByCollection.get(item.collection_id)
      if (!collectionSlug || !item.slug) continue
      entries.push({
        url: `${baseUrl}/resources/${collectionSlug}/${item.slug}`,
        lastModified: lastmod(item.updated_at),
        changeFrequency: 'monthly',
        priority: 0.6,
      })
    }
  }

  // ── Blog ────────────────────────────────────────────────────────────────────
  if (navVisible.has('blog')) {
    entries.push({ url: `${baseUrl}/blog`, changeFrequency: 'weekly', priority: 0.6 })
    const { data: posts } = await supabase
      .from('blog_posts')
      .select('slug, updated_at')
      .eq('status', 'published')
      .eq('visibility', 'public')
      .limit(LIMIT)
    for (const p of posts ?? []) {
      if (!p.slug) continue
      entries.push({
        url: `${baseUrl}/blog/${p.slug}`,
        lastModified: lastmod(p.updated_at),
        changeFrequency: 'monthly',
        priority: 0.6,
      })
    }
  }

  // Legal/static — always present.
  entries.push(
    { url: `${baseUrl}/privacy`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/terms`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/cookie-policy`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/do-not-sell`, changeFrequency: 'monthly', priority: 0.3 },
  )

  return entries
}
