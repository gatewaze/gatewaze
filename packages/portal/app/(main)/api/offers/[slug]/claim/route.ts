import { isIP } from 'node:net'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse, after } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * POST /api/offers/<slug>/claim  { email }
 *
 * Reveals a shared-code offer's code and records the claim against the email
 * (discounts migration 003, events_claim_shared_offer). Signed-out by design:
 * the offer page learns the address from the encoded email in the link, which
 * identifies the visitor but does not authenticate them. That is acceptable
 * because the code is the same for everyone; the worst a forged address does
 * is add a claim row. The IP limit bounds how fast anyone can do that.
 *
 * Service role is required: the RPC is not callable by anon or authenticated.
 *
 * A claimant we have never seen becomes a person with a (silent, confirmed)
 * auth user, through the same people-signup function the sign-in page uses,
 * so they can sign in later with this address. No email is sent. This runs
 * after the response, so the code is shown without waiting for it.
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// Ordinary addresses only. Besides validation, this keeps characters that
// mean something to PostgREST filters (, ( ) * % ") out of everything
// downstream, including people-signup's lookups.
const EMAIL_RE = /^[a-z0-9._+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * Create the person and auth user for a new claimant via people-signup.
 * Skipped when the address already has a person linked to an auth user, so a
 * known recipient's sign-up source and consent are left as they are. Called
 * without `app`, so people-signup sends no magic link.
 */
async function ensurePerson(email: string, clientIp: string | null): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return

  // Case-insensitive, as people-signup matches; escape the LIKE wildcards
  // that EMAIL_RE still allows (_).
  const pattern = email.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  const { data: existing } = await getSupabase()
    .from('people')
    .select('id')
    .ilike('email', pattern)
    .not('auth_user_id', 'is', null)
    .limit(1)
  if (existing && existing.length > 0) return

  const res = await fetch(`${supabaseUrl}/functions/v1/people-signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Service role, so people-signup accepts client_ip: the Supabase gateway
      // replaces X-Forwarded-For with this server's address, which geolocated
      // every claimant to the cluster's data centre.
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ email, source: 'discount_offer_claim', ...(clientIp ? { client_ip: clientIp } : {}) }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    console.error('[offer-claim] people-signup failed', res.status)
  }
}

/** A public address: not private, loopback, link-local or CGNAT (e.g. the
 *  NodeBalancer's 192.168.x when proxy protocol is off). */
function isPublicIp(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127))
  }
  if (kind === 6) {
    const s = ip.toLowerCase()
    return !(s.includes('%') || s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || /^fe[89ab]/.test(s))
  }
  return false
}

function json(body: Record<string, unknown>, status: number, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  // Recipients at one company can share an office IP, and a person may retry
  // a couple of times, so this is generous per minute but stops a script.
  const rateLimit = checkRateLimit(`offer-claim:${ip}`, 20, 60_000)
  if (!rateLimit.allowed) {
    return json(
      { error: 'Too many attempts. Please wait a minute and try again.' },
      429,
      { 'Retry-After': String(rateLimit.retryAfter ?? 60) },
    )
  }

  const { slug } = await params
  if (typeof slug !== 'string' || slug.length > 120 || !SLUG_RE.test(slug)) {
    return json({ error: 'Offer not found' }, 404)
  }

  let email = ''
  try {
    const body = await request.json()
    email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  } catch {
    return json({ error: 'Enter a valid email address' }, 400)
  }
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ error: 'Enter a valid email address' }, 400)
  }

  const { data, error } = await getSupabase().rpc('events_claim_shared_offer', {
    p_slug: slug,
    p_email: email,
    p_source: 'offer-page',
  })
  if (error) {
    console.error('[offer-claim] rpc failed', error.message)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }

  const row = Array.isArray(data) ? data[0] : data
  switch (row?.status) {
    case 'claimed':
      after(() =>
        ensurePerson(email, isPublicIp(ip) ? ip : null).catch((err) =>
          console.error('[offer-claim] ensurePerson threw', err instanceof Error ? err.message : err),
        ),
      )
      return json({ code: row.code }, 200)
    case 'closed':
      return json({ error: 'This offer has closed.' }, 410)
    case 'bad_email':
      return json({ error: 'Enter a valid email address' }, 400)
    default:
      return json({ error: 'Offer not found' }, 404)
  }
}
