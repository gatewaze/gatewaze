import { NextRequest, NextResponse } from 'next/server'
import { getServerBrand } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { getRelatedVisibility, moduleForCard } from '@/lib/modules/relatedVisibility'

/**
 * Related-content resolver — the person-independent v1 of the surface the
 * Signals module will later re-rank per-person (same candidate pool, same
 * response shape; only the ranking implementation changes).
 *
 * GET /api/related-content?topics=voice-agents,mcp&exclude=/resources/x/y
 *
 * Candidate sources, in rank order:
 *   1. curated pins (related_pins) — editorial pairings always win
 *   2. resource topic containment — sr_blocks whose data.topics overlap,
 *      deduplicated to their parent item (anon reads: RLS already limits
 *      this to published items in public/metered collections)
 *   3. upcoming events whose event_topics overlap
 *
 * Anonymous, cacheable per topic-set. `exclude` drops cards that point at
 * the page the visitor is already on.
 */

const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,60}$/
const MAX_TOPICS = 8
const MAX_CARDS = 6
/** In-person events within this range rank above the rest. */
const NEARBY_KM = 500
/** A topic matching more blocks than this is page-generic on this corpus
 *  (e.g. `mcp` on an MCP-conference recap) — it can't discriminate, so the
 *  containment legs ignore it when any rarer topic is available. */
const GENERIC_TOPIC_BLOCKS = 25
/** Per-leg caps: topic matches must not crowd out per-card semantic fill. */
const MAX_TOPIC_CARDS = 3
const MAX_BLOG_CARDS = 2
const MAX_EVENT_CARDS = 2
/** Embedding neighbours below this cosine similarity are noise, not kin. */
const MIN_SIMILARITY = 0.33
/** Relative relevance gate: after scoring every inferred candidate against
 *  the source's embedding, keep only cards at least this fraction as similar
 *  as the best match. Overridable per-request via ?min_relevance=. */
const DEFAULT_MIN_RELEVANCE = 0.9
/** Absolute floor under the relative gate: on a sparse corpus the "best
 *  available" match can itself be weak, and a relative gate alone would
 *  legitimize it. Cards must clear BOTH bars — really relevant or nothing. */
const ABS_RELEVANCE_FLOOR = 0.4
/** Source types the resolver accepts (must have embedding rows). */
const SOURCE_TYPES = new Set(['sr_block', 'sr_item', 'event', 'blog_post'])

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

interface RelatedCard {
  type: string // resource | event | blog | link — display label
  title: string
  href: string
  description?: string
  image?: string
  meta?: string // secondary line, e.g. event date/city
  source: 'pin' | 'topic' | 'event' | 'similar'
  /** 0–100, relative to the best-matching card for this source block. */
  relevance?: number
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const topics = (url.searchParams.get('topics') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => TOPIC_RE.test(t))
      .slice(0, MAX_TOPICS)
    const exclude = url.searchParams.get('exclude') ?? ''

    const brand = await getServerBrand()
    const supabase = await createServerSupabase(brand.id)

    const cards: RelatedCard[] = []
    const seenHrefs = new Set<string>(exclude ? [exclude] : [])

    // Resolve the excluded page to an item id where possible — slug aliases
    // mean the visitor's path and an item's canonical href can differ, and
    // a card must never recommend the page it is sitting on.
    let excludeItemId: string | null = null
    const excludeMatch = /^\/resources\/([a-z0-9-]+)\/([a-z0-9-]+)/.exec(exclude)
    if (excludeMatch) {
      const { data: exCollection } = await supabase
        .from('sr_collections').select('id').eq('slug', excludeMatch[1]).maybeSingle()
      if (exCollection) {
        const { data: exItem } = await supabase
          .from('sr_items').select('id, slug').eq('collection_id', exCollection.id)
          .or(`slug.eq.${excludeMatch[2]},slug.ilike.%${excludeMatch[2]}%`)
          .limit(1).maybeSingle()
        if (exItem) {
          excludeItemId = exItem.id
          seenHrefs.add(`/resources/${excludeMatch[1]}/${exItem.slug}`)
        }
      }
    }

    // ── Source resolution ────────────────────────────────────────────────
    // The "thing you're looking at": any embedded unit (source_type +
    // source_id), or the legacy talk-card form (exclude item + block slug).
    // The source drives self-exclusion, topic derivation, semantic fill and
    // relevance scoring.
    const sourceTypeParam = url.searchParams.get('source_type') ?? ''
    const sourceIdParam = url.searchParams.get('source_id') ?? ''
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    let source: { type: string; id: string } | null =
      SOURCE_TYPES.has(sourceTypeParam) && UUID_RE.test(sourceIdParam)
        ? { type: sourceTypeParam, id: sourceIdParam }
        : null
    if (!source) {
      const blockSlugParam = url.searchParams.get('block') ?? ''
      if (excludeItemId && /^[a-z0-9][a-z0-9-]{0,120}$/.test(blockSlugParam)) {
        const { data: srcBlock } = await supabase
          .from('sr_blocks')
          .select('id')
          .eq('item_id', excludeItemId)
          .eq('slug', blockSlugParam)
          .maybeSingle()
        if (srcBlock) source = { type: 'sr_block', id: srcBlock.id }
      }
    }
    if (source) {
      const { data: meta } = await supabase
        .rpc('related_source_meta', { p_content_type: source.type, p_content_id: source.id })
      const m = Array.isArray(meta) ? meta[0] : meta
      if (m?.href) seenHrefs.add(m.href)
      if (m?.item_id && !excludeItemId) excludeItemId = m.item_id
    }

    // topics: explicit param wins; otherwise derive from the source itself
    if (topics.length === 0 && source) {
      const { data: derived } = await supabase
        .rpc('related_topics_for', { p_content_type: source.type, p_content_id: source.id })
      for (const t of (derived ?? []) as string[]) {
        if (TOPIC_RE.test(t) && topics.length < MAX_TOPICS) topics.push(t)
      }
    }
    if (topics.length === 0 && !source) {
      return NextResponse.json({ cards: [] }, { headers: { 'Cache-Control': 'public, max-age=300' } })
    }

    const push = (card: RelatedCard) => {
      if (seenHrefs.has(card.href) || cards.length >= MAX_CARDS) return
      seenHrefs.add(card.href)
      cards.push(card)
    }

    // 1) curated pins
    const { data: pins } = await supabase
      .from('related_pins')
      .select('topic, title, href, description, image_url, card_type, sort_order')
      .in('topic', topics)
      .eq('active', true)
      .order('sort_order', { ascending: true })
    for (const pin of pins ?? []) {
      push({
        type: pin.card_type,
        title: pin.title,
        href: pin.href,
        description: pin.description ?? undefined,
        image: pin.image_url ?? undefined,
        source: 'pin',
      })
    }

    // Discriminative-topic selection: count how many blocks each requested
    // topic matches; topics over the generic threshold (page-generic like
    // `mcp` on an MCP recap) are dropped from the containment legs when any
    // rarer topic exists — they made every card's panel identical.
    const topicFilters = (t: string) =>
      [`data->topics.cs.${JSON.stringify([t])}`, `data->topics_auto.cs.${JSON.stringify([t])}`]
    const topicCounts = await Promise.all(topics.map(async (t) => {
      const { count } = await supabase
        .from('sr_blocks')
        .select('id', { count: 'exact', head: true })
        .or(topicFilters(t).join(','))
      return { topic: t, count: count ?? 0 }
    }))
    const rare = topicCounts.filter((t) => t.count > 0 && t.count <= GENERIC_TOPIC_BLOCKS).map((t) => t.topic)
    const discriminative = rare.length > 0
      ? rare
      : topicCounts.filter((t) => t.count > 0).sort((a, b) => a.count - b.count).slice(0, 2).map((t) => t.topic)

    // 2) resource topic containment: blocks -> parent items, ranked by how
    //    many discriminative topics each item shares, capped so per-card
    //    semantic fill still differentiates the panel.
    if (cards.length < MAX_CARDS && discriminative.length > 0) {
      const orFilter = discriminative.flatMap(topicFilters).join(',')
      const { data: blocks } = await supabase
        .from('sr_blocks')
        .select('item_id, data, item:sr_items(title, slug, subtitle, featured_image_url, collection:sr_collections(slug, name))')
        .or(orFilter)
        .limit(120)
      const perItem = new Map<string, { item: any; matched: Set<string> }>()
      for (const b of blocks ?? []) {
        if (excludeItemId && b.item_id === excludeItemId) continue
        const item = Array.isArray(b.item) ? b.item[0] : b.item
        const collection = item && (Array.isArray(item.collection) ? item.collection[0] : item.collection)
        if (!item || !collection) continue
        const entry = perItem.get(b.item_id) ?? { item: { ...item, collection }, matched: new Set<string>() }
        const blockTopics = new Set<string>([
          ...(Array.isArray((b.data as any)?.topics) ? (b.data as any).topics : []),
          ...(Array.isArray((b.data as any)?.topics_auto) ? (b.data as any).topics_auto : []),
        ])
        for (const t of discriminative) if (blockTopics.has(t)) entry.matched.add(t)
        perItem.set(b.item_id, entry)
      }
      const ranked = [...perItem.values()].sort((a, b) => b.matched.size - a.matched.size)
      let topicCards = 0
      for (const { item } of ranked) {
        if (topicCards >= MAX_TOPIC_CARDS || cards.length >= MAX_CARDS) break
        const before = cards.length
        push({
          type: 'resource',
          title: item.title,
          href: `/resources/${item.collection.slug}/${item.slug}`,
          description: item.subtitle ?? undefined,
          image: item.featured_image_url ?? undefined,
          meta: item.collection.name,
          source: 'topic',
        })
        if (cards.length > before) topicCards++
      }
    }

    // 2b) blog posts by topic (keyword-engine matches; external posts link
    //     out to their canonical article) — same discriminative topics.
    if (cards.length < MAX_CARDS && discriminative.length > 0) {
      const { data: blogCards } = await supabase
        .rpc('related_blog_posts_by_topics', { p_topics: discriminative, p_limit: MAX_BLOG_CARDS + 2 })
      let blogCount = 0
      for (const b of (blogCards ?? []) as Array<Record<string, any>>) {
        if (blogCount >= MAX_BLOG_CARDS || cards.length >= MAX_CARDS) break
        const before = cards.length
        push({
          type: 'blog',
          title: b.title,
          href: b.href,
          description: b.description ?? undefined,
          image: b.image_url ?? undefined,
          meta: 'Blog',
          source: 'topic',
        })
        if (cards.length > before) blogCount++
      }
    }

    // 3) upcoming events with overlapping DISCRIMINATIVE topics (the generic
    //    corpus tag would put the same summits on every card). When the panel
    //    supplies the visitor's coarse IP location (shared ipinfo cache
    //    client-side), in-person events within NEARBY_KM rank first; virtual
    //    events and events with no coordinates keep their date order.
    if (cards.length < MAX_CARDS && discriminative.length > 0) {
      const lat = Number.parseFloat(url.searchParams.get('lat') ?? '')
      const lon = Number.parseFloat(url.searchParams.get('lon') ?? '')
      const hasGeo = Number.isFinite(lat) && Number.isFinite(lon)

      const { data: events } = await supabase
        .from('events')
        .select('event_id, event_title, event_slug, event_start, event_city, event_country_code, event_featured_image, event_topics, event_latitude, event_longitude, event_type')
        .overlaps('event_topics', discriminative)
        .eq('is_listed', true)
        .gt('event_start', new Date().toISOString())
        .order('event_start', { ascending: true })
        .limit(15)

      const ranked = (events ?? [])
        // event pages resolve by the short event_id; event_slug is usually null
        .filter((e) => e.event_slug || e.event_id)
        .map((e) => {
          // topic match always runs; location only decides whether an
          // IN-PERSON event is worth showing. Virtual events are exempt from
          // the distance gate even when they carry organizer coordinates.
          const virtual = ['webinar', 'virtual', 'online'].includes((e.event_type ?? '').toLowerCase())
          const eLat = Number.parseFloat(e.event_latitude ?? '')
          const eLon = Number.parseFloat(e.event_longitude ?? '')
          const km = !virtual && hasGeo && Number.isFinite(eLat) && Number.isFinite(eLon)
            ? haversineKm(lat, lon, eLat, eLon)
            : null
          return { e, km, nearby: km !== null && km <= NEARBY_KM }
        })
        // vicinity GATE, not just a rank boost: show a topic-matched event
        // only when it's local to the visitor, virtual, or has no location
        // (or the visitor's location is unknown — can't judge, keep it).
        .filter((x) => x.km === null || x.nearby)
        .sort((a, b) =>
          Number(b.nearby) - Number(a.nearby) ||
          Date.parse(a.e.event_start ?? '') - Date.parse(b.e.event_start ?? ''))
        .slice(0, MAX_EVENT_CARDS)

      for (const { e, nearby } of ranked) {
        const when = e.event_start
          ? new Date(e.event_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
          : ''
        const where = [e.event_city, e.event_country_code].filter(Boolean).join(', ')
        push({
          type: 'event',
          title: e.event_title,
          href: `/events/${e.event_slug ?? e.event_id}`,
          image: e.event_featured_image ?? undefined,
          meta: [when, where && nearby ? `${where} — near you` : where].filter(Boolean).join(' · '),
          source: 'event',
        })
      }
    }

    // 4) semantic fill: embedding neighbours of the source, when pins/topics/
    //    events left slots open. Events are excluded here — the events leg
    //    above owns the vicinity gate.
    if (cards.length < MAX_CARDS && source) {
      const { data: neighbours } = await supabase
        .rpc('related_by_embedding', { p_content_type: source.type, p_content_id: source.id, p_limit: 8 })
      for (const n of (neighbours ?? []) as Array<Record<string, any>>) {
        if (n.card_type === 'event') continue
        if (typeof n.similarity === 'number' && n.similarity < MIN_SIMILARITY) continue
        push({
          type: n.card_type,
          title: n.title,
          href: n.href,
          description: n.description ?? undefined,
          image: n.image_url ?? undefined,
          meta: n.meta ?? undefined,
          source: 'similar',
        })
      }
    }

    // ── Unified relevance gate ──────────────────────────────────────────────
    // Topic/event/blog selection is set-membership; without this, sharing one
    // tag reads as "fully relevant" and panels go broad. Score every inferred
    // card against the source block's embedding, then keep only cards at
    // least min_relevance (default 90%) as similar as the BEST match — a
    // relative gate, because absolute cosine values are corpus-dependent.
    // Pins are editorial guarantees and never filtered. Cards without an
    // embedding row can't be judged and are kept.
    const minRelevanceParam = Number.parseFloat(url.searchParams.get('min_relevance') ?? '')
    const minRelevance = Number.isFinite(minRelevanceParam) && minRelevanceParam > 0 && minRelevanceParam <= 1
      ? minRelevanceParam
      : DEFAULT_MIN_RELEVANCE
    let out = cards
    if (source) {
      const inferred = cards.filter((c) => c.source !== 'pin')
      if (inferred.length > 0) {
        const { data: scores } = await supabase.rpc('related_score_hrefs', {
          p_content_type: source.type,
          p_content_id: source.id,
          p_hrefs: inferred.map((c) => c.href),
        })
        const simByHref = new Map<string, number>(
          ((scores ?? []) as Array<{ href: string; similarity: number }>).map((s) => [s.href, s.similarity]),
        )
        const top = Math.max(...inferred.map((c) => simByHref.get(c.href) ?? 0), MIN_SIMILARITY)
        const cut = Math.max(ABS_RELEVANCE_FLOOR, minRelevance * top)
        const kept = inferred
          .map((c) => ({ card: c, sim: simByHref.get(c.href) }))
          .filter(({ sim }) => sim === undefined || sim >= cut)
          .sort((a, b) => (b.sim ?? 0) - (a.sim ?? 0))
          .map(({ card, sim }) => ({
            ...card,
            relevance: sim !== undefined && top > 0 ? Math.round((sim / top) * 100) : undefined,
          }))
        out = [...cards.filter((c) => c.source === 'pin'), ...kept]
      }
    }

    // ── Module-visibility gate ─────────────────────────────────────────────
    // Never surface a module the CURRENT VIEWER can't see in the portal nav:
    // hidden modules are out for everyone, draft modules only reach authorised
    // previewers, 'members' modules require a session (the future member-tier
    // seam), and unmappable custom-link pins pass (operator-authored).
    const visibility = await getRelatedVisibility()
    out = out.filter((c) => {
      const moduleId = moduleForCard(c, visibility)
      return moduleId === null || visibility.allowed.has(moduleId)
    })

    // responses now vary by viewer (draft/member visibility) — never shared-cache
    return NextResponse.json(
      { cards: out },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
  } catch (err) {
    console.warn(JSON.stringify({ event: 'resources.related.resolver_error', message: err instanceof Error ? err.message : String(err) }))
    return NextResponse.json({ cards: [] }, { status: 200 })
  }
}
