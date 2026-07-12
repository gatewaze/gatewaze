'use client'

// Inline "Related" section for reading surfaces — event pages, resource
// items, blog posts. The talk-card panel (RelatedSpy in the resources
// module) is play-triggered; reading surfaces instead resolve on mount and
// render nothing at all unless genuinely relevant cards come back (the
// resolver applies the relative + absolute relevance gates server-side).

import { useEffect, useState } from 'react'

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

const STYLE_ID = 'gw-rel-inline-style'
const CSS = `
.gw-rel-inline { margin-top: 32px; }
.gw-rel-inline .gw-rel-label { display: block; font-size: 12px; font-weight: 700; color: var(--ink-3); letter-spacing: .04em; text-transform: uppercase; margin-bottom: 10px; }
.gw-rel-inline .gw-rel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.gw-rel-inline a.gw-rel-card { display: flex; flex-direction: column; gap: 5px; border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: rgba(var(--ui-text), 0.03); text-decoration: none !important; color: inherit; transition: background .15s ease, border-color .15s ease; }
.gw-rel-inline a.gw-rel-card:hover { background: rgba(var(--ui-text), 0.07); border-color: var(--accent); }
.gw-rel-inline .gw-rel-type { font-size: 10.5px; font-weight: 700; color: var(--accent); letter-spacing: .05em; text-transform: uppercase; }
.gw-rel-inline .gw-rel-title { font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.35; }
.gw-rel-inline .gw-rel-desc { font-size: 12.5px; color: var(--ink-3); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.gw-rel-inline .gw-rel-meta { font-size: 11.5px; color: var(--ink-3); margin-top: auto; padding-top: 2px; }
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
    if (cards.length === 0 || document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
  }, [cards.length])

  if (cards.length === 0) return null

  return (
    <div className="gw-rel-inline" data-gw-related={surface}>
      <span className="gw-rel-label">{heading}</span>
      <div className="gw-rel-grid">
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
              <span className="gw-rel-type">{card.type}</span>
              <span className="gw-rel-title">{card.title}</span>
              {card.description && <span className="gw-rel-desc">{card.description}</span>}
              {card.meta && <span className="gw-rel-meta">{card.meta}</span>}
            </a>
          )
        })}
      </div>
    </div>
  )
}

export default RelatedInline
