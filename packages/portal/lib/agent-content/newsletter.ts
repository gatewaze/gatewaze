import { convert } from 'html-to-text'
import { substituteMergeFieldsInContent } from '@gatewaze-modules/newsletters/lib/merge-fields'
import { editionFolderSlug } from '@gatewaze-modules/newsletters/lib/edition-slug'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side serialisation of a newsletter edition to clean text/markdown for
 * AI agents. Newsletter editions have no stored body text — content lives as a
 * block/brick tree of `content` JSONB, rendered to HTML client-side via a
 * react-email pipeline that can't run outside the editor. So instead of
 * rendering the templates, we extract the authored content directly from the
 * JSONB: styling lives in the block-def templates (not the content), so the
 * content map is almost entirely the words, links, and headings we want.
 *
 * This is faithful enough for discovery, works for every published edition
 * (sent or not), carries no per-recipient personalisation, and needs no
 * DOMParser / react-email. Merge tokens resolve to their fallbacks.
 */

interface BlockRow {
  id: string
  block_type?: string | null
  content: unknown
  sort_order?: number | null
}
interface BrickRow {
  id: string
  block_id: string
  brick_type?: string | null
  content: unknown
  sort_order?: number | null
}

export interface LoadedEdition {
  collection: { id: string; name: string; slug: string }
  edition: {
    id: string
    title: string | null
    edition_date: string
    preheader: string | null
    created_at: string | null
    updated_at: string | null
  }
  blocks: BlockRow[]
  bricksByBlock: Record<string, BrickRow[]>
}

const TITLE_KEYS = new Set(['title', 'section_title', 'heading', 'headline'])
const BODY_KEYS = new Set(['text', 'body', 'description', 'content', 'summary', 'quote'])

const hasHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s)

function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: false, hideLinkHrefIfSameAsText: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'hr', format: 'skip' },
    ],
  }).trim()
}

/** Extract the authored content of one block/brick `content` map as markdown lines. */
function serializeContentMap(raw: unknown): string[] {
  const content = substituteMergeFieldsInContent(raw, {}) as Record<string, unknown>
  if (!content || typeof content !== 'object' || Array.isArray(content)) return []

  const out: string[] = []
  const seenTitles = new Set<string>()

  // 1) Headings — plain-text title fields. (Underscore-prefixed keys are config
  //    such as _spacing_margin and are skipped throughout.)
  for (const [k, v] of Object.entries(content)) {
    if (k.startsWith('_') || typeof v !== 'string') continue
    const val = v.trim()
    if (!val || hasHtml(val)) continue
    if (TITLE_KEYS.has(k) || k.endsWith('_title')) {
      const key = val.toLowerCase()
      if (!seenTitles.has(key)) {
        out.push(`## ${val}`)
        seenTitles.add(key)
      }
    }
  }

  // 2) Body — rich-text/HTML fields flattened to clean text.
  for (const [k, v] of Object.entries(content)) {
    if (k.startsWith('_') || typeof v !== 'string') continue
    const val = v.trim()
    if (!val) continue
    if (BODY_KEYS.has(k) || k.endsWith('_body') || (k.endsWith('_text') && k !== 'link_text')) {
      const text = hasHtml(val) ? htmlToText(val) : val
      if (text) out.push(text)
    }
  }

  // 3) Standalone links — a top-level URL field paired with a label sibling
  //    (e.g. poll_option_1_link + poll_option_1_label, or link + link_text).
  //    Links embedded in body HTML are already inlined by html-to-text above.
  for (const [k, v] of Object.entries(content)) {
    if (k.startsWith('_') || typeof v !== 'string') continue
    const url = v.trim()
    if (!/^https?:\/\//i.test(url)) continue
    const base = k.replace(/_?(link|url|href)$/i, '')
    const labelRaw =
      content[`${base}_label`] ?? content[`${base}_text`] ?? content['link_text'] ?? content['link_label']
    const label = typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : url
    out.push(`[${label}](${url})`)
  }

  return out
}

/** The edition body as markdown — every block in order, bricks nested. */
export function editionBodyMarkdown(blocks: BlockRow[], bricksByBlock: Record<string, BrickRow[]>): string {
  const parts: string[] = []
  const ordered = [...blocks]
    // Email-only blocks (apology/correction headers on a re-send) are excluded
    // from the public archive — match the portal View Online filter.
    .filter((b) => !(b.block_type ?? '').startsWith('email_only_'))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  for (const block of ordered) {
    parts.push(...serializeContentMap(block.content))
    const bricks = (bricksByBlock[block.id] ?? []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    for (const brick of bricks) parts.push(...serializeContentMap(brick.content))
  }

  return parts.filter((p) => p && p.trim()).join('\n\n')
}

/** Full markdown document for an edition (frontmatter + title + body + source). */
export function editionToMarkdown(
  loaded: LoadedEdition,
  opts: { baseUrl: string; brandName: string },
): string {
  const { collection, edition, blocks, bricksByBlock } = loaded
  const path = `/newsletters/${collection.slug}/${editionFolderSlug(edition.edition_date, edition.title)}`
  const pageUrl = `${opts.baseUrl}${path}`
  const body = editionBodyMarkdown(blocks, bricksByBlock)

  const lines: string[] = []
  lines.push('---')
  lines.push(`title: ${JSON.stringify(edition.title ?? '')}`)
  lines.push(`newsletter: ${JSON.stringify(collection.name)}`)
  lines.push(`date: ${edition.edition_date}`)
  lines.push(`source: ${pageUrl}`)
  lines.push('---')
  lines.push('')
  lines.push(`# ${edition.title || 'Newsletter edition'}`)
  if (edition.preheader && edition.preheader.trim()) lines.push('', `*${edition.preheader.trim()}*`)
  lines.push('', `*${collection.name} — ${opts.brandName}, ${edition.edition_date}*`)
  if (body) lines.push('', body)
  lines.push('', '---', `Source: ${pageUrl}`, '')

  return lines.join('\n')
}

/**
 * Resolve a /newsletters/{collectionSlug}/{YYYY-MM-DD}-{slug} URL to its
 * published edition plus content blocks/bricks. Anon client → RLS returns only
 * published editions. Returns null if not found/unpublished.
 */
export async function loadPublishedEdition(
  supabase: SupabaseClient,
  collectionSlug: string,
  editionParam: string,
): Promise<LoadedEdition | null> {
  const { data: collection } = await supabase
    .from('newsletters_template_collections')
    .select('id, name, slug')
    .eq('slug', collectionSlug)
    .maybeSingle()
  if (!collection) return null

  const date = editionParam.slice(0, 10)
  const { data: candidates } = await supabase
    .from('newsletters_editions')
    .select('id, title, edition_date, preheader, created_at, updated_at')
    .eq('collection_id', collection.id)
    .eq('edition_date', date)
    .eq('status', 'published')
    .order('created_at', { ascending: false })

  const edition =
    (candidates ?? []).find((c) => editionFolderSlug(c.edition_date, c.title) === editionParam) ??
    (candidates ?? [])[0]
  if (!edition) return null

  const { data: blocks } = await supabase
    .from('newsletters_edition_blocks')
    .select('id, block_type, content, sort_order')
    .eq('edition_id', edition.id)
    .order('sort_order')

  const blockIds = (blocks ?? []).map((b) => b.id)
  const bricksByBlock: Record<string, BrickRow[]> = {}
  if (blockIds.length) {
    const { data: bricks } = await supabase
      .from('newsletters_edition_bricks')
      .select('id, block_id, brick_type, content, sort_order')
      .in('block_id', blockIds)
      .order('sort_order')
    for (const br of bricks ?? []) (bricksByBlock[br.block_id] ||= []).push(br as BrickRow)
  }

  return { collection, edition, blocks: (blocks ?? []) as BlockRow[], bricksByBlock }
}
