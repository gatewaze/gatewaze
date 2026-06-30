import { convert } from 'html-to-text'
import { getServerBrandConfig } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'

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

  return notFound()
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
