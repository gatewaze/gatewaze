import { Suspense } from 'react'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { OfferClaimClient, type OfferLink } from './OfferClaimClient'

/**
 * Shared-code offer page (discounts module, migration 003).
 *
 * Linked from promotional emails as /offers/<slug>?utm_medium=<encoded email>.
 * Opening the page only shows the offer; the code is revealed, and the claim
 * recorded, when the visitor clicks. Email security scanners open every link
 * in a message, so nothing here may change state on a GET.
 */

export const dynamic = 'force-dynamic'

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

interface OfferRow {
  id: string
  title: string
  slug: string
  value: string | null
  intro: string | null
  content: string | null
  ticket_details: string | null
  close_date: string | null
  close_display: string | null
  status: string | null
  registration_links: Array<{ event_id?: unknown; label?: unknown; url?: unknown }> | null
}

function isWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const u = new URL(value)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password
  } catch {
    return false
  }
}

async function loadOffer(slug: string) {
  if (!SLUG_RE.test(slug) || slug.length > 120) return null
  const brand = await getServerBrand()
  const supabase = await createServerSupabase(brand)

  const { data: offer } = await supabase
    .from('events_discounts')
    .select('id, title, slug, value, intro, content, ticket_details, close_date, close_display, status, registration_links')
    .eq('slug', slug)
    .is('event_id', null)
    .maybeSingle<OfferRow>()
  // A cancelled offer is withdrawn, not merely over: treat it as gone.
  if (!offer || offer.status === 'cancelled') return null

  const raw = Array.isArray(offer.registration_links) ? offer.registration_links : []
  const eventIds = raw
    .map((l) => l?.event_id)
    .filter((id): id is string => typeof id === 'string' && EVENT_ID_RE.test(id))
  if (eventIds.length === 0) return null

  const { data: events } = await supabase
    .from('events')
    .select('event_id, event_title, event_link, event_start, event_city, screenshot_url')
    .in('event_id', eventIds)
    .eq('is_live_in_production', true)
  const byId = new Map((events ?? []).map((e) => [e.event_id as string, e]))

  const links: OfferLink[] = []
  for (const l of raw) {
    const ev = typeof l?.event_id === 'string' ? byId.get(l.event_id) : undefined
    if (!ev) continue
    const url = isWebUrl(l.url) ? l.url : isWebUrl(ev.event_link) ? ev.event_link : null
    if (!url) continue
    links.push({
      eventId: ev.event_id,
      eventTitle: ev.event_title,
      eventStart: ev.event_start ?? null,
      eventCity: ev.event_city ?? null,
      imageUrl: isWebUrl(ev.screenshot_url) ? ev.screenshot_url : null,
      label: typeof l.label === 'string' && l.label.trim() ? l.label.trim().slice(0, 120) : `Register for ${ev.event_title}`,
      url,
    })
  }
  if (links.length === 0) return null

  const closed =
    (offer.status ?? 'active') !== 'active' ||
    (offer.close_date !== null && new Date(offer.close_date).getTime() < Date.now())

  return { offer, links, closed }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const loaded = await loadOffer(slug)
  const title = loaded ? `${loaded.offer.title} - ${brandConfig.name}` : brandConfig.name
  return {
    title,
    // Personal links from emails; keep them out of search results.
    robots: { index: false, follow: false },
    // The link carries the recipient's encoded address; don't pass the full
    // URL to the event sites and image hosts this page loads or links to.
    referrer: 'same-origin',
    openGraph: { title, type: 'website', siteName: brandConfig.name },
  }
}

export default async function OfferPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const loaded = await loadOffer(slug)
  if (!loaded) notFound()

  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const { offer, links, closed } = loaded

  return (
    <Suspense fallback={null}>
      <OfferClaimClient
        slug={offer.slug}
        title={offer.title}
        intro={offer.intro}
        value={offer.value}
        content={offer.content}
        ticketDetails={offer.ticket_details}
        closeDisplay={offer.close_display}
        closeDate={offer.close_date}
        closed={closed}
        links={links}
        primaryColor={brandConfig.primaryColor}
      />
    </Suspense>
  )
}
