import { NextRequest, NextResponse } from 'next/server'
import { hasAnalyticsConsent, type RelayEvent } from '@gatewaze/tracking'
import { checkRateLimit } from '@/lib/rate-limit'
import { getRequestTracking } from '@/lib/server-tracking'
import { getServerBrand } from '@/config/brand'
import { createAuthenticatedServerSupabase } from '@/lib/supabase/server'

/**
 * First-party tracking relay — the browser's ONLY analytics endpoint.
 *
 * The client SDK (@gatewaze/tracking/client) posts every event here
 * instead of talking to vendor endpoints, because:
 *   - ad blockers kill cdn.segment.com / api.segment.io but not the
 *     site's own origin;
 *   - this is the single consent-enforcement point: the gw_consent
 *     cookie (mirrored by the consent UI) is checked SERVER-side, so a
 *     stale tab, a replayed request, or a buggy client can't leak
 *     events after a visitor opts out.
 *
 * Consent semantics match the client's opt-out model: no cookie = no
 * explicit choice yet = implicit consent; an explicit denial drops the
 * event. Dropped events still return 204 — no signal to retry, nothing
 * for filter lists to fingerprint.
 *
 * identify() calls verify the userId against the visitor's actual
 * session — a client-asserted id that doesn't match the session is
 * ignored (anonymous traits still flow).
 */

export async function POST(req: NextRequest) {
  try {
    // sendBeacon can't set headers reliably cross-browser; accept any
    // content-type and parse the body as JSON ourselves.
    let body: RelayEvent
    try {
      body = JSON.parse(await req.text()) as RelayEvent
    } catch {
      return new NextResponse(null, { status: 204 })
    }
    if (!body || typeof body !== 'object' || !['track', 'page', 'identify'].includes(body.type)) {
      return new NextResponse(null, { status: 204 })
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rate = checkRateLimit(`relay:${ip}`, 300, 60_000)
    if (!rate.allowed) return new NextResponse(null, { status: 204 })

    // ---- THE consent gate. Everything below only runs when the visitor
    // is trackable; explicit denial ends here regardless of what the
    // client sent.
    if (!hasAnalyticsConsent(req.headers.get('cookie'))) {
      return new NextResponse(null, { status: 204 })
    }

    const { tracker, anonymousId, context } = getRequestTracking(req)
    const input = {
      properties: sanitizeProperties(body.properties),
      anonymousId,
      context,
      client: body.client,
    }

    if (body.type === 'track') {
      if (typeof body.event !== 'string' || !body.event || body.event.length > 120) {
        return new NextResponse(null, { status: 204 })
      }
      await tracker.track(body.event, input)
    } else if (body.type === 'page') {
      await tracker.page(typeof body.event === 'string' ? body.event.slice(0, 120) : undefined, input)
    } else {
      const userId = await verifiedUserId(body.userId)
      if (userId) {
        await tracker.identify(userId, sanitizeProperties(body.traits), input)
      }
    }

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[relay] error:', err)
    // Tracking failures are invisible to the visitor by design.
    return new NextResponse(null, { status: 204 })
  }
}

/** Bound property payloads: flat-ish JSON, capped size, no prototype tricks. */
function sanitizeProperties(props?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return undefined
  const out: Record<string, unknown> = {}
  let count = 0
  for (const [key, value] of Object.entries(props)) {
    if (count >= 50) break
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = typeof value === 'string' ? value.slice(0, 500) : value
      count++
    }
  }
  return out
}

/** Resolve the userId from the visitor's real session; a client-asserted
 *  id only passes when it matches. */
async function verifiedUserId(claimed?: string): Promise<string | null> {
  if (!claimed || typeof claimed !== 'string') return null
  try {
    const brand = await getServerBrand()
    const supabase = await createAuthenticatedServerSupabase(brand)
    const { data } = await supabase.auth.getUser()
    return data?.user?.id === claimed ? claimed : null
  } catch {
    return null
  }
}
