import { NextRequest, NextResponse } from 'next/server'
import { getServerBrand } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'

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
  source: 'pin' | 'topic' | 'event'
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
    if (topics.length === 0) {
      return NextResponse.json({ cards: [] }, { headers: { 'Cache-Control': 'public, max-age=300' } })
    }

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

    // 2) resource topic containment: blocks -> parent items. One containment
    //    filter per topic OR'd together (the in-contract @> shape), matching
    //    both hand-set topics and rule-derived topics_auto (content-keywords
    //    engine sync — see resources migration 009).
    if (cards.length < MAX_CARDS) {
      const orFilter = topics
        .flatMap((t) => [`data->topics.cs.${JSON.stringify([t])}`, `data->topics_auto.cs.${JSON.stringify([t])}`])
        .join(',')
      const { data: blocks } = await supabase
        .from('sr_blocks')
        .select('item_id, item:sr_items(title, slug, subtitle, featured_image_url, collection:sr_collections(slug, name))')
        .or(orFilter)
        .limit(60)
      const seenItems = new Set<string>(excludeItemId ? [excludeItemId] : [])
      for (const b of blocks ?? []) {
        if (seenItems.has(b.item_id)) continue
        seenItems.add(b.item_id)
        const item = Array.isArray(b.item) ? b.item[0] : b.item
        const collection = item && (Array.isArray(item.collection) ? item.collection[0] : item.collection)
        if (!item || !collection) continue
        push({
          type: 'resource',
          title: item.title,
          href: `/resources/${collection.slug}/${item.slug}`,
          description: item.subtitle ?? undefined,
          image: item.featured_image_url ?? undefined,
          meta: collection.name,
          source: 'topic',
        })
      }
    }

    // 3) upcoming events with overlapping topics. When the panel supplies the
    //    visitor's coarse IP location (shared ipinfo cache client-side),
    //    in-person events within NEARBY_KM rank first; virtual events and
    //    events with no coordinates keep their date order.
    if (cards.length < MAX_CARDS) {
      const lat = Number.parseFloat(url.searchParams.get('lat') ?? '')
      const lon = Number.parseFloat(url.searchParams.get('lon') ?? '')
      const hasGeo = Number.isFinite(lat) && Number.isFinite(lon)

      const { data: events } = await supabase
        .from('events')
        .select('event_id, event_title, event_slug, event_start, event_city, event_country_code, event_featured_image, event_topics, event_latitude, event_longitude, event_type')
        .overlaps('event_topics', topics)
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
        .slice(0, 3)

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

    // 4) semantic fill: embedding neighbours of the SOURCE block (the card
    //    that was played), when pins/topics/events left slots open. Events
    //    are excluded here — the events leg above owns the vicinity gate.
    const blockSlug = url.searchParams.get('block') ?? ''
    if (cards.length < MAX_CARDS && excludeItemId && /^[a-z0-9][a-z0-9-]{0,120}$/.test(blockSlug)) {
      const { data: srcBlock } = await supabase
        .from('sr_blocks')
        .select('id')
        .eq('item_id', excludeItemId)
        .eq('slug', blockSlug)
        .maybeSingle()
      if (srcBlock) {
        const { data: neighbours } = await supabase
          .rpc('related_by_embedding', { p_content_type: 'sr_block', p_content_id: srcBlock.id, p_limit: 8 })
        for (const n of (neighbours ?? []) as Array<Record<string, any>>) {
          if (n.card_type === 'event') continue
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
    }

    return NextResponse.json(
      { cards },
      { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } },
    )
  } catch (err) {
    console.warn(JSON.stringify({ event: 'resources.related.resolver_error', message: err instanceof Error ? err.message : String(err) }))
    return NextResponse.json({ cards: [] }, { status: 200 })
  }
}
