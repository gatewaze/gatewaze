import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { anonymousIdFromCookieHeader } from '@gatewaze/tracking'
import { checkRateLimit } from '@/lib/rate-limit'
import { getServerBrand } from '@/config/brand'
import { createAuthenticatedServerSupabase } from '@/lib/supabase/server'

/**
 * Consent audit trail — writes each cookie-consent decision into the
 * compliance module's `compliance_consent_records` table (GDPR audit
 * trail with IP + user agent, per the module's guide; its RLS
 * deliberately allows anonymous consent inserts).
 *
 * Called fire-and-forget by custom-consent.js whenever the visitor
 * makes or changes a choice. Self-gating: if the compliance module
 * isn't installed (table missing) the insert fails quietly.
 *
 * The table requires an email. Signed-in visitors get their real email
 * + person link; anonymous visitors get a stable non-routable marker
 * derived from their anonymous id (RFC 2606 `.invalid` TLD) so repeat
 * decisions by the same visitor stay correlatable.
 */

function getServiceSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

interface ConsentPayload {
  consentGiven?: boolean
  consentDenied?: boolean
  categories?: { analytics?: boolean; marketing?: boolean; functional?: boolean; necessary?: boolean }
  source?: string
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rate = checkRateLimit(`consent-record:${ip}`, 10, 60_000)
    if (!rate.allowed) return new NextResponse(null, { status: 204 })

    let body: ConsentPayload
    try {
      body = JSON.parse(await req.text()) as ConsentPayload
    } catch {
      return new NextResponse(null, { status: 204 })
    }
    if (!body || typeof body !== 'object' || typeof body.categories !== 'object') {
      return new NextResponse(null, { status: 204 })
    }

    // Resolve the visitor: signed-in → real email + person row; else the
    // anonymous-id marker.
    let email: string | null = null
    let personId: string | null = null
    const supabase = getServiceSupabase()
    try {
      const brand = await getServerBrand()
      const authed = await createAuthenticatedServerSupabase(brand)
      const { data } = await authed.auth.getUser()
      if (data?.user?.email) {
        email = data.user.email
        const { data: person } = await supabase
          .from('people')
          .select('id')
          .eq('auth_user_id', data.user.id)
          .maybeSingle()
        personId = (person as { id: string } | null)?.id ?? null
      }
    } catch {
      /* anonymous */
    }
    if (!email) {
      const anonymousId = anonymousIdFromCookieHeader(req.headers.get('cookie'))
      email = `anon-${anonymousId || 'unknown'}@anonymous.invalid`
    }

    const categories = {
      analytics: body.categories.analytics !== false,
      marketing: body.categories.marketing !== false,
      functional: body.categories.functional !== false,
    }
    const consented = categories.analytics

    const { error } = await supabase.from('compliance_consent_records').insert({
      person_id: personId,
      email,
      consent_type: 'cookies',
      consented,
      consent_text: JSON.stringify({
        categories,
        consentGiven: !!body.consentGiven,
        consentDenied: !!body.consentDenied,
        source: typeof body.source === 'string' ? body.source.slice(0, 50) : 'cookie_banner',
      }),
      ip_address: ip === 'unknown' ? null : ip,
      user_agent: req.headers.get('user-agent'),
      ...(consented ? {} : { withdrawn_at: new Date().toISOString() }),
    })
    if (error) {
      // 42P01 = table missing → compliance module not installed; fine.
      if (!error.message?.includes('compliance_consent_records')) {
        console.warn('[consent-record] insert failed:', error.message)
      }
    }

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[consent-record] error:', err)
    return new NextResponse(null, { status: 204 })
  }
}
