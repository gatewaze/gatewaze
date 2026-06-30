import { convert } from 'html-to-text'
import { getServerBrandConfig } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { loadPublishedEdition, editionToMarkdown } from '@/lib/agent-content/newsletter'

export const dynamic = 'force-dynamic'

/** Resource section bodies are stored as rich HTML; flatten to clean text that
 *  reads naturally in markdown (links preserved inline, images dropped). */
function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: false, hideLinkHrefIfSameAsText: true } },
      { selector: 'img', format: 'skip' },
    ],
  }).trim()
}

/**
 * Clean-markdown representations of public portal content, for AI agents and
 * LLM crawlers that parse markdown far more reliably than styled HTML.
 *
 * URL shape mirrors the human page with an `/md` prefix, e.g.
 *   /resources/<collection>/<item>  →  /md/resources/<collection>/<item>
 * The human page links here via `<link rel="alternate" type="text/markdown">`.
 *
 * Gating is enforced by RLS: the anon Supabase client only returns publicly
 * visible rows (e.g. resources outside `access='public'` collections 404 here),
 * so this can never leak gated content.
 *
 * Dispatch is per content-type; add newsletters/events branches alongside
 * resources as their markdown serialisers land.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params

  if (path[0] === 'resources' && path.length === 3) {
    return resourceItemMarkdown(path[1], path[2])
  }

  // /newsletters/<collection>/<YYYY-MM-DD-slug>
  if (path[0] === 'newsletters' && path.length === 3) {
    return newsletterEditionMarkdown(path[1], path[2])
  }

  // /events/<event_id-or-slug>
  if (path[0] === 'events' && path.length === 2) {
    return eventMarkdown(path[1])
  }

  return notFound()
}

interface EventMdRow {
  event_id: string
  event_slug: string | null
  event_title: string | null
  event_description: string | null
  listing_intro: string | null
  event_start: string | null
  event_end: string | null
  event_timezone: string | null
  event_city: string | null
  event_country_code: string | null
  event_location: string | null
  venue_address: string | null
  event_link: string | null
  event_type: string | null
  event_topics: string[] | null
}

async function eventMarkdown(identifier: string): Promise<Response> {
  try {
    const brand = await getServerBrandConfig()
    const supabase = await createServerSupabase(brand.id)

    const { data } = await supabase
      .from('events')
      .select(
        'event_id, event_slug, event_title, event_description, listing_intro, event_start, event_end, ' +
          'event_timezone, event_city, event_country_code, event_location, venue_address, event_link, ' +
          'event_type, event_topics',
      )
      .or(`event_id.eq.${identifier},event_slug.eq.${identifier}`)
      .eq('is_live_in_production', true)
      .eq('is_listed', true)
      .maybeSingle()
    const event = data as EventMdRow | null
    if (!event) return notFound()

    const pageUrl = `https://${brand.domain}/events/${event.event_slug || event.event_id}`
    const where =
      event.event_location ||
      event.venue_address ||
      [event.event_city, event.event_country_code].filter(Boolean).join(', ') ||
      null

    const lines: string[] = []
    lines.push('---')
    lines.push(`title: ${JSON.stringify(event.event_title ?? '')}`)
    if (event.event_start) lines.push(`start: ${event.event_start}`)
    if (where) lines.push(`location: ${JSON.stringify(where)}`)
    lines.push(`source: ${pageUrl}`)
    lines.push('---')
    lines.push('')
    lines.push(`# ${event.event_title}`)
    if (event.listing_intro) lines.push('', event.listing_intro)

    const facts: string[] = []
    if (event.event_start) {
      const range = event.event_end ? `${event.event_start} – ${event.event_end}` : String(event.event_start)
      facts.push(`**When:** ${range}${event.event_timezone ? ` (${event.event_timezone})` : ''}`)
    }
    if (where) facts.push(`**Where:** ${where}`)
    if (event.event_type) facts.push(`**Type:** ${event.event_type}`)
    if (Array.isArray(event.event_topics) && event.event_topics.length) {
      facts.push(`**Topics:** ${event.event_topics.join(', ')}`)
    }
    if (facts.length) lines.push('', facts.join('  \n'))

    if (event.event_description) {
      const text = htmlToText(String(event.event_description))
      if (text) lines.push('', '## About', '', text)
    }

    lines.push('', `[Event details & registration](${event.event_link || pageUrl})`)
    lines.push('', '---', `Source: ${pageUrl}`, '')

    return markdownResponse(lines.join('\n'))
  } catch (err) {
    console.warn('[md/events] failed to build:', err)
    return notFound()
  }
}

async function newsletterEditionMarkdown(collectionSlug: string, editionParam: string): Promise<Response> {
  try {
    const brand = await getServerBrandConfig()
    const supabase = await createServerSupabase(brand.id)
    const loaded = await loadPublishedEdition(supabase, collectionSlug, editionParam)
    if (!loaded) return notFound()
    const md = editionToMarkdown(loaded, { baseUrl: `https://${brand.domain}`, brandName: brand.name })
    return markdownResponse(md)
  } catch (err) {
    console.warn('[md/newsletters] failed to build:', err)
    return notFound()
  }
}

function notFound(): Response {
  return new Response('Not found\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

function markdownResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

async function resourceItemMarkdown(collectionSlug: string, itemSlug: string): Promise<Response> {
  try {
    const brand = await getServerBrandConfig()
    const supabase = await createServerSupabase(brand.id)

    const { data: collection } = await supabase
      .from('sr_collections')
      .select('id, name, slug, description')
      .eq('slug', collectionSlug)
      .eq('status', 'published')
      .maybeSingle()
    if (!collection) return notFound()

    // RLS: this row is only returned to the anon client when the parent
    // collection is access='public'. Gated items 404 here by design.
    const { data: item } = await supabase
      .from('sr_items')
      .select('id, title, slug, subtitle, external_url, updated_at')
      .eq('collection_id', collection.id)
      .eq('slug', itemSlug)
      .eq('status', 'published')
      .maybeSingle()
    if (!item) return notFound()

    const { data: sections } = await supabase
      .from('sr_sections')
      .select('heading, content, sort_order')
      .eq('item_id', item.id)
      .order('sort_order', { ascending: true })

    const pageUrl = `https://${brand.domain}/resources/${collectionSlug}/${itemSlug}`
    const lines: string[] = []

    // Minimal YAML frontmatter — cheap, machine-parseable provenance.
    lines.push('---')
    lines.push(`title: ${yaml(item.title)}`)
    lines.push(`collection: ${yaml(collection.name)}`)
    lines.push(`source: ${pageUrl}`)
    if (item.updated_at) lines.push(`updated: ${item.updated_at}`)
    lines.push('---')
    lines.push('')

    lines.push(`# ${item.title}`)
    if (item.subtitle) lines.push('', item.subtitle)
    lines.push('', `*Part of [${collection.name}](https://${brand.domain}/resources/${collectionSlug}) — ${brand.name}*`)
    if (item.external_url) lines.push('', `[External resource](${item.external_url})`)

    for (const s of sections ?? []) {
      if (s.heading) lines.push('', `## ${s.heading}`)
      if (s.content) {
        const text = htmlToText(String(s.content))
        if (text) lines.push('', text)
      }
    }

    lines.push('', '---', `Source: ${pageUrl}`, '')

    return markdownResponse(lines.join('\n'))
  } catch (err) {
    console.warn('[md/resources] failed to build:', err)
    return notFound()
  }
}

/** Escape a value for a single-line YAML scalar. */
function yaml(value: string): string {
  return JSON.stringify(value ?? '')
}
