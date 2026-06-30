import { getServerBrandConfig } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { getNavVisibleModuleIds } from '@/lib/modules/navVisible'
import { editionFolderSlug } from '@gatewaze-modules/newsletters/lib/edition-slug'

export const dynamic = 'force-dynamic'

/**
 * RSS 2.0 feeds for chronological content, so aggregators and AI agents can
 * subscribe rather than re-crawl. URLs (an `/feeds` prefix avoids the module
 * catch-all):
 *   /feeds/events.xml
 *   /feeds/newsletters.xml
 *   /feeds/newsletters/<collection>.xml
 *
 * IMPORTANT: feeds amplify content to the open web, so they are gated on
 * NAV VISIBILITY (getNavVisibleModuleIds), not merely `enabled`. A module whose
 * menu item is hidden (content "not ready for public consumption") yields a 404
 * here — its content is never syndicated.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params
  // Tolerate a trailing `.xml` on the last segment.
  const segs = [...path]
  if (segs.length) segs[segs.length - 1] = segs[segs.length - 1].replace(/\.xml$/i, '')

  const navVisible = await getNavVisibleModuleIds()

  if (segs[0] === 'events' && segs.length === 1) {
    if (!navVisible.has('events')) return notFound()
    return eventsFeed()
  }
  if (segs[0] === 'newsletters') {
    if (!navVisible.has('newsletters')) return notFound()
    if (segs.length === 1) return newslettersFeed(null)
    if (segs.length === 2) return newslettersFeed(segs[1])
  }

  return notFound()
}

function notFound(): Response {
  return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

const FEED_LIMIT = 50

interface FeedItem {
  title: string
  link: string
  guid: string
  pubDate?: string | null
  description?: string | null
}

const xmlEscape = (s: unknown): string =>
  String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string))

/** RFC-1123 date for RSS pubDate; undefined for unparseable input. */
function rssDate(value: unknown): string | undefined {
  if (!value) return undefined
  const d = new Date(value as string)
  return Number.isNaN(d.getTime()) ? undefined : d.toUTCString()
}

function renderRss(channel: {
  title: string
  link: string
  feedUrl: string
  description: string
  items: FeedItem[]
}): Response {
  const lastBuild = channel.items.map((i) => rssDate(i.pubDate)).find(Boolean)
  const parts: string[] = []
  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">')
  parts.push('<channel>')
  parts.push(`<title>${xmlEscape(channel.title)}</title>`)
  parts.push(`<link>${xmlEscape(channel.link)}</link>`)
  parts.push(`<description>${xmlEscape(channel.description)}</description>`)
  parts.push(`<atom:link href="${xmlEscape(channel.feedUrl)}" rel="self" type="application/rss+xml"/>`)
  if (lastBuild) parts.push(`<lastBuildDate>${lastBuild}</lastBuildDate>`)
  for (const it of channel.items) {
    parts.push('<item>')
    parts.push(`<title>${xmlEscape(it.title)}</title>`)
    parts.push(`<link>${xmlEscape(it.link)}</link>`)
    parts.push(`<guid isPermaLink="true">${xmlEscape(it.guid)}</guid>`)
    const pd = rssDate(it.pubDate)
    if (pd) parts.push(`<pubDate>${pd}</pubDate>`)
    if (it.description) parts.push(`<description>${xmlEscape(it.description)}</description>`)
    parts.push('</item>')
  }
  parts.push('</channel>')
  parts.push('</rss>')
  return new Response(parts.join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=900' },
  })
}

async function eventsFeed(): Promise<Response> {
  const brand = await getServerBrandConfig()
  const supabase = await createServerSupabase(brand.id)
  const baseUrl = `https://${brand.domain}`

  const { data: events } = await supabase
    .from('events')
    .select('event_id, event_slug, event_title, listing_intro, event_start, event_city, event_country_code, updated_at')
    .eq('is_live_in_production', true)
    .eq('is_listed', true)
    .order('event_start', { ascending: false })
    .limit(FEED_LIMIT)

  const items: FeedItem[] = (events ?? []).map((e) => {
    const link = `${baseUrl}/events/${e.event_slug || e.event_id}`
    const where = [e.event_city, e.event_country_code].filter(Boolean).join(', ')
    const summary = [e.listing_intro, where && `📍 ${where}`].filter(Boolean).join(' — ')
    return {
      title: e.event_title || 'Event',
      link,
      guid: link,
      // event_start anchors the item to when it happens; updated_at as a fallback.
      pubDate: e.event_start || e.updated_at,
      description: summary || null,
    }
  })

  return renderRss({
    title: `${brand.name} — Events`,
    link: `${baseUrl}/events/upcoming`,
    feedUrl: `${baseUrl}/feeds/events.xml`,
    description: `Events from ${brand.name}.`,
    items,
  })
}

async function newslettersFeed(collectionSlug: string | null): Promise<Response> {
  const brand = await getServerBrandConfig()
  const supabase = await createServerSupabase(brand.id)
  const baseUrl = `https://${brand.domain}`

  // Resolve collections (one, or all) → slug/name lookup.
  let collectionFilterId: string | null = null
  let feedTitleSuffix = 'Newsletters'
  let feedLink = `${baseUrl}/newsletters`
  let feedUrl = `${baseUrl}/feeds/newsletters.xml`

  const collectionsQuery = supabase.from('newsletters_template_collections').select('id, name, slug')
  const { data: collections } = collectionSlug
    ? await collectionsQuery.eq('slug', collectionSlug).limit(1)
    : await collectionsQuery
  if (collectionSlug) {
    const col = (collections ?? [])[0]
    if (!col) return notFound()
    collectionFilterId = col.id
    feedTitleSuffix = col.name
    feedLink = `${baseUrl}/newsletters/${col.slug}`
    feedUrl = `${baseUrl}/feeds/newsletters/${col.slug}.xml`
  }
  const slugByCollection = new Map<string, { slug: string; name: string }>()
  for (const c of collections ?? []) slugByCollection.set(c.id, { slug: c.slug, name: c.name })

  let editionsQuery = supabase
    .from('newsletters_editions')
    .select('collection_id, title, edition_date, preheader, created_at, updated_at')
    .eq('status', 'published')
    .order('edition_date', { ascending: false })
    .limit(FEED_LIMIT)
  if (collectionFilterId) editionsQuery = editionsQuery.eq('collection_id', collectionFilterId)
  const { data: editions } = await editionsQuery

  const items: FeedItem[] = []
  for (const ed of editions ?? []) {
    const col = slugByCollection.get(ed.collection_id)
    if (!col) continue
    const link = `${baseUrl}/newsletters/${col.slug}/${editionFolderSlug(ed.edition_date, ed.title)}`
    items.push({
      title: ed.title || ed.edition_date,
      link,
      guid: link,
      pubDate: ed.created_at || ed.edition_date,
      description: ed.preheader || null,
    })
  }

  return renderRss({
    title: `${brand.name} — ${feedTitleSuffix}`,
    link: feedLink,
    feedUrl,
    description: `Newsletter editions from ${brand.name}.`,
    items,
  })
}
