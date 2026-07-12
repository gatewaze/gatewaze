'use client'

// Inline "Related" section for reading surfaces — event pages, resource
// items, blog posts. The talk-card panel (RelatedSpy in the resources
// module) is play-triggered; reading surfaces instead resolve on mount and
// render nothing at all unless genuinely relevant cards come back (the
// resolver applies the relative + absolute relevance gates server-side).
//
// Presentation: a visual carousel — up to three cards in view, arrow to
// reveal more, image-led cards (blog covers, event screenshots, video
// thumbnails) with a graceful text-only fallback.

import { useEffect, useRef, useState } from 'react'

interface RelatedCard {
  type: string
  title: string
  href: string
  description?: string
  image?: string
  meta?: string
  source: string
  relevance?: number
}

interface Props {
  sourceType: 'sr_block' | 'sr_item' | 'event' | 'blog_post'
  sourceId: string
  /** Optional explicit topics; the resolver derives them from the source when omitted. */
  topics?: string[]
  heading?: string
  /** Analytics label for where this section is mounted. */
  surface: string
}

const STYLE_ID = 'gw-rel-carousel-style'
// Kept in sync with the talk-card panel styles in
// modules/resources/portal/components/RelatedSpy.tsx (same class names).
const CSS = `
.gw-rel-inline { margin-top: 32px; }
.gw-rel-inline .gw-rel-label { display: block; font-size: 12px; font-weight: 700; color: var(--ink-3); letter-spacing: .04em; text-transform: uppercase; margin-bottom: 10px; }
.gw-rel-carousel { position: relative; }
.gw-rel-track { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-behavior: smooth; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.gw-rel-track::-webkit-scrollbar { display: none; }
a.gw-rel-card { flex: 0 0 calc((100% - 20px) / 3); scroll-snap-align: start; display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: rgba(var(--ui-text), 0.03); text-decoration: none !important; color: inherit; transition: background .15s ease, border-color .15s ease; min-width: 0; }
a.gw-rel-card:hover { background: rgba(var(--ui-text), 0.07); border-color: var(--accent); }
@media (max-width: 900px) { a.gw-rel-card { flex-basis: calc((100% - 10px) / 2); } }
@media (max-width: 560px) { a.gw-rel-card { flex-basis: 80%; } }
.gw-rel-img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 7px; background: rgba(var(--ui-text), 0.06); }
.gw-rel-type { font-size: 10.5px; font-weight: 700; color: var(--accent); letter-spacing: .05em; text-transform: uppercase; }
.gw-rel-title { font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.gw-rel-desc { font-size: 12.5px; color: var(--ink-3); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.gw-rel-meta { font-size: 11.5px; color: var(--ink-3); margin-top: auto; padding-top: 2px; }
.gw-rel-arrow { position: absolute; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--line); background: var(--paper); color: var(--ink); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 2; box-shadow: 0 2px 10px rgba(0, 0, 0, .28); font-size: 15px; line-height: 1; padding: 0; }
.gw-rel-arrow:hover { border-color: var(--accent); }
.gw-rel-arrow[data-off='1'] { display: none; }
.gw-rel-arrow-left { left: -12px; }
.gw-rel-arrow-right { right: -12px; }
`

function beacon(event: string, properties: Record<string, unknown>): void {
  try {
    navigator.sendBeacon('/api/t', new Blob([JSON.stringify({
      type: 'track',
      event,
      properties,
      client: { url: location.href, path: location.pathname + location.search, title: document.title },
    })], { type: 'application/json' }))
  } catch { /* tracking must never break the page */ }
}

function cachedLoc(): { lat: number; lon: number } | null {
  try {
    const raw = localStorage.getItem('gatewaze_ip_info')
    if (!raw) return null
    const { data, timestamp } = JSON.parse(raw)
    if (Date.now() - timestamp > 1000 * 60 * 30 || typeof data?.loc !== 'string') return null
    const [lat, lon] = data.loc.split(',').map(parseFloat)
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
  } catch {
    return null
  }
}

export function RelatedInline({ sourceType, sourceId, topics, heading = 'Related', surface }: Props) {
  const [cards, setCards] = useState<RelatedCard[]>([])
  const [arrows, setArrows] = useState({ left: false, right: false })
  const trackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const loc = cachedLoc()
        const params = new URLSearchParams({ source_type: sourceType, source_id: sourceId })
        if (topics && topics.length > 0) params.set('topics', topics.join(','))
        if (loc) { params.set('lat', String(loc.lat)); params.set('lon', String(loc.lon)) }
        const res = await fetch(`/api/related-content?${params}`)
        const data = (await res.json()) as { cards?: RelatedCard[] }
        if (!cancelled && data.cards && data.cards.length > 0) {
          setCards(data.cards)
          beacon('related_panel_shown', {
            surface,
            source_type: sourceType,
            source_id: sourceId,
            cards: data.cards.length,
            sources: data.cards.map((c) => c.source).join(','),
          })
        }
      } catch { /* no section on failure — never a broken page */ }
    }
    void run()
    return () => { cancelled = true }
  }, [sourceType, sourceId, surface, topics?.join(',')])

  useEffect(() => {
    if (cards.length === 0) return
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }
    updateArrows()
  }, [cards.length])

  const updateArrows = () => {
    const track = trackRef.current
    if (!track) return
    setArrows({
      left: track.scrollLeft > 1,
      right: track.scrollLeft + track.clientWidth < track.scrollWidth - 1,
    })
  }

  const scrollByCard = (dir: 1 | -1) => {
    const track = trackRef.current
    if (!track) return
    const card = track.querySelector<HTMLElement>('a.gw-rel-card')
    const step = card ? card.offsetWidth + 10 : track.clientWidth / 3
    track.scrollBy({ left: dir * step, behavior: 'smooth' })
  }

  if (cards.length === 0) return null

  return (
    <div className="gw-rel-inline" data-gw-related={surface}>
      <span className="gw-rel-label">{heading}</span>
      <div className="gw-rel-carousel">
        <button
          type="button"
          aria-label="Previous related items"
          className="gw-rel-arrow gw-rel-arrow-left"
          data-off={arrows.left ? undefined : '1'}
          onClick={() => scrollByCard(-1)}
        >‹</button>
        <div className="gw-rel-track" ref={trackRef} onScroll={updateArrows}>
          {cards.map((card) => {
            const external = /^https?:\/\//.test(card.href)
            return (
              <a
                key={card.href}
                className="gw-rel-card"
                href={card.href}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                onClick={() => beacon('related_click', { surface, href: card.href, type: card.type, source: card.source })}
              >
                {card.image && (
                  <img
                    className="gw-rel-img"
                    src={card.image}
                    alt=""
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                <span className="gw-rel-type">{card.type}</span>
                <span className="gw-rel-title">{card.title}</span>
                {card.description && <span className="gw-rel-desc">{card.description}</span>}
                {card.meta && <span className="gw-rel-meta">{card.meta}</span>}
              </a>
            )
          })}
        </div>
        <button
          type="button"
          aria-label="More related items"
          className="gw-rel-arrow gw-rel-arrow-right"
          data-off={arrows.right ? undefined : '1'}
          onClick={() => scrollByCard(1)}
        >›</button>
      </div>
    </div>
  )
}

export default RelatedInline
