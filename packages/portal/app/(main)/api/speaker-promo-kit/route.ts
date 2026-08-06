import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Speaker promo kit — portal read endpoint.
 *
 * Authenticated by the talk's edit_token (the same capability token as the
 * rest of the confirmed-speaker checklist). Generation itself happens in the
 * event-speakers module's promo-kit workers; this route only reads the kit
 * row — and, for a confirmed talk with no kit yet, inserts the 'requested'
 * row the worker sweep picks up (≤2 min cadence).
 *
 * Replaces the Short.io /api/speaker-tracking-link route: the kit's tracking
 * link is now an umami redirect link (https://<host>/go/<slug>).
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Small in-memory per-IP limiter — the token is unguessable and is the real
// access control; this only sheds floods cheaply. Two documented limits:
// x-forwarded-for is trusted as set by our ingress (Traefik/nginx overwrite
// it; a client-forged value only fragments its own bucket, it cannot widen
// another IP's), and the Map is per-instance, so the effective ceiling
// multiplies by pod count. Both are acceptable for flood-shedding.
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    if (rateBuckets.size > 10_000) {
      for (const [key, b] of rateBuckets) if (b.resetAt <= now) rateBuckets.delete(key)
    }
    return false
  }
  bucket.count++
  return bucket.count > RATE_LIMIT
}

export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (rateLimited(ip)) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 })
    }

    const editToken = req.nextUrl.searchParams.get('token') || ''
    // edit_token defaults to gen_random_uuid()::text — reject junk early.
    if (!/^[A-Za-z0-9-]{16,64}$/.test(editToken)) {
      return NextResponse.json({ success: false, error: 'token is required' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: talk, error: talkError } = await supabase
      .from('events_talks')
      .select('id, status, event_uuid')
      .eq('edit_token', editToken)
      .maybeSingle()
    if (talkError) {
      return NextResponse.json({ success: false, error: 'Lookup failed' }, { status: 500 })
    }
    if (!talk) {
      return NextResponse.json({ success: false, error: 'Talk not found or invalid token' }, { status: 404 })
    }
    if (talk.status !== 'confirmed') {
      return NextResponse.json({ success: false, error: 'Promo kits are available once your talk is confirmed' }, { status: 403 })
    }

    const { data: kit } = await supabase
      .from('speaker_promo_kits')
      .select(
        'status, tracking_short_url, promo_text, promo_text_status, cards, zip_storage_path, generated_at',
      )
      .eq('talk_id', talk.id)
      .maybeSingle()

    if (!kit) {
      // First open before the sweep has seen this talk: request generation.
      await supabase
        .from('speaker_promo_kits')
        .upsert(
          { talk_id: talk.id, event_uuid: talk.event_uuid, status: 'requested' },
          { onConflict: 'talk_id', ignoreDuplicates: true },
        )
      return NextResponse.json({ success: true, status: 'requested' })
    }

    return NextResponse.json({
      success: true,
      status: kit.status,
      tracking_url: kit.tracking_short_url,
      promo_text: kit.promo_text_status === 'ready' ? kit.promo_text : null,
      promo_text_status: kit.promo_text_status,
      cards: kit.cards ?? [],
      zip_storage_path: kit.zip_storage_path,
      generated_at: kit.generated_at,
    })
  } catch (error) {
    console.error('Speaker promo kit error:', error)
    return NextResponse.json({ success: false, error: 'Unknown error' }, { status: 500 })
  }
}
