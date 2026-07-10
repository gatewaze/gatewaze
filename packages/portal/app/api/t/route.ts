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
      // Signals outcome attribution: engagement with a gw_sig-tagged href
      // (signals-routed content, e.g. a portal_pin card) closes the fire's
      // outcome loop. Validity is enforced DB-side by the RPC; failures
      // never affect the tracking path.
      await recordSignalsOutcome(body)
    } else if (body.type === 'page') {
      await tracker.page(typeof body.event === 'string' ? body.event.slice(0, 120) : undefined, input)
    } else {
      const user = await verifiedUser(body.userId)
      if (user) {
        const meta = (user.user_metadata ?? {}) as Record<string, unknown>
        const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>
        // Segment userId = the LFID sub when present. The LF workspace's
        // identity space (Auth0 Actions source, LFX Unify) keys profiles
        // on the LFID — sending our app-local Supabase uid as user_id
        // would split profiles there. Non-LFID users identify
        // anonymously (anonymousId + email traits merge instead), and
        // the Supabase uid always rides along as a trait.
        const lfidSub = typeof meta.lfid_sub === 'string' ? meta.lfid_sub : null
        await tracker.identify(lfidSub, {
          ...sanitizeProperties(body.traits),
          // Authoritative traits from the verified session — clients can't
          // omit or forge these.
          email: user.email,
          supabase_user_id: user.id,
          ...(typeof meta.lfid_username === 'string' ? { lfid_username: meta.lfid_username } : {}),
          ...(typeof appMeta.provider === 'string' ? { auth_provider: appMeta.provider } : {}),
        }, input)
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

/** Resolve the visitor's real session user; a client-asserted id only
 *  passes when it matches the session. Returns the full user so
 *  authoritative traits (LFID identity) come from the session, not the
 *  client payload. */
async function verifiedUser(claimed?: string): Promise<{
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
} | null> {
  if (!claimed || typeof claimed !== 'string') return null
  try {
    const brand = await getServerBrand()
    const supabase = await createAuthenticatedServerSupabase(brand)
    const { data } = await supabase.auth.getUser()
    return data?.user?.id === claimed ? data.user : null
  } catch {
    return null
  }
}

const GW_SIG_RE = /[?&]gw_sig=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

/** Attribute a tracked interaction back to the signals fire whose tagged
 *  href it touched. Best-effort by contract: never throws to the caller. */
async function recordSignalsOutcome(body: RelayEvent): Promise<void> {
  try {
    const props = (body.properties ?? {}) as Record<string, unknown>
    const candidates = [props.href, props.url, body.client?.url]
    let fireId: string | null = null
    for (const c of candidates) {
      const m = typeof c === 'string' ? GW_SIG_RE.exec(c) : null
      if (m) { fireId = m[1]; break }
    }
    if (!fireId) return
    const brand = await getServerBrand()
    const supabase = await createAuthenticatedServerSupabase(brand)
    await supabase.rpc('signals_record_outcome', { p_fire_id: fireId, p_kind: 'click' })
  } catch {
    /* outcome recording must never break tracking */
  }
}
