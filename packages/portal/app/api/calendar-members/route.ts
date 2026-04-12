import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedServerSupabase } from '@/lib/supabase/server'
import { getServerBrand } from '@/config/brand'

/**
 * Portal-internal API for calendar member signup.
 *
 * Flow — matches the standard sign-in page flow:
 *
 *   1. Find-or-create the `people` row for the submitted email
 *   2. Upsert a `calendars_members` row with membership_status='active'
 *   3. If the caller is NOT already authenticated, call the `people-signup`
 *      edge function (the same one used by /sign-in). That function uses
 *      `supabase.auth.admin.generateLink({ type: 'magiclink' })` and sends
 *      the email via the custom email system (GoTrue SMTP is intentionally
 *      disabled platform-wide).
 *   4. The magic link redirects to `/sign-in?redirectTo={calendar-url}`,
 *      so the sign-in page's existing hash-token handler picks up the
 *      `#access_token` fragment, calls `setSession()`, and forwards the
 *      user to the calendar landing page.
 *   5. If the caller IS already authenticated, skip the magic link.
 */

interface SignupBody {
  calendar_id: string
  name: string
  email: string
  phone?: string
  notification_preferences?: {
    email?: boolean
    sms?: boolean
    push?: boolean
  }
  marketing_consent?: boolean
}

function getServiceSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function generateUnsubscribeToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const b64 = Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function errorResponse(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
  return NextResponse.json(
    { data: null, error: { code, message, details } },
    { status }
  )
}

interface CalendarRow {
  id: string
  name: string
  slug: string | null
  calendar_id: string
  logo_url: string | null
  settings?: Record<string, unknown> | null
}

/**
 * Find an existing person by email or create a new one.
 * Reused from the open-rsvp pattern.
 */
async function findOrCreatePerson(
  supabase: ReturnType<typeof getServiceSupabase>,
  input: { email: string; name?: string; phone?: string }
): Promise<string | null> {
  const email = input.email.toLowerCase().trim()
  if (!email) return null

  const { data: existing } = await supabase
    .from('people')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing) return (existing as { id: string }).id

  const attributes: Record<string, unknown> = {}
  if (input.name) {
    const parts = input.name.trim().split(/\s+/)
    attributes.first_name = parts[0]
    if (parts.length > 1) attributes.last_name = parts.slice(1).join(' ')
  }

  const { data: newPerson, error } = await supabase
    .from('people')
    .insert({
      email,
      phone: input.phone || null,
      attributes,
      is_guest: true,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[calendar-members] findOrCreatePerson failed:', error)
    return null
  }

  return (newPerson as { id: string }).id
}

/**
 * Delegate magic link sending to the `people-signup` edge function — the
 * same path used by the /sign-in page. GoTrue SMTP is disabled platform-wide,
 * so people-signup uses `admin.generateLink` + the custom email system
 * (SendGrid / configured SMTP).
 *
 * `redirectTo` should point to /sign-in with a `redirectTo` query param, so
 * the sign-in page's hash-token handler can pick up the `#access_token`
 * fragment and forward the user to the final destination.
 */
async function triggerPeopleSignupMagicLink(args: {
  email: string
  name: string
  redirectTo: string
  clientIp?: string | null
}): Promise<boolean> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    console.error('[calendar-members] Missing Supabase URL/anon key for people-signup')
    return false
  }

  const parts = args.name.trim().split(/\s+/)
  const firstName = parts[0] || null
  const lastName = parts.slice(1).join(' ') || null

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/people-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        ...(args.clientIp ? { 'x-forwarded-for': args.clientIp } : {}),
      },
      body: JSON.stringify({
        email: args.email,
        source: 'calendar_member_signup',
        app: 'portal',
        redirect_to: args.redirectTo,
        user_metadata: {
          first_name: firstName,
          last_name: lastName,
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[calendar-members] people-signup failed:', res.status, text)
      return false
    }

    const body = await res.json().catch(() => ({}))
    const sent = !!body?.magic_link_sent
    console.log(`[calendar-members] people-signup result for ${args.email}: magic_link_sent=${sent}`)
    return sent
  } catch (err) {
    console.error('[calendar-members] people-signup threw:', err)
    return false
  }
}

export async function POST(request: NextRequest) {
  let body: SignupBody
  try {
    body = (await request.json()) as SignupBody
  } catch {
    return errorResponse(400, 'INVALID_INPUT', 'Body must be valid JSON.')
  }

  // Validate inputs
  if (!body.calendar_id || typeof body.calendar_id !== 'string') {
    return errorResponse(400, 'INVALID_INPUT', 'calendar_id is required.', { field: 'calendar_id' })
  }
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return errorResponse(400, 'INVALID_INPUT', 'Name is required.', { field: 'name' })
  }
  if (body.name.length > 120) {
    return errorResponse(400, 'INVALID_INPUT', 'Name is too long.', { field: 'name' })
  }
  if (!body.email || typeof body.email !== 'string' || !EMAIL_RE.test(body.email)) {
    return errorResponse(400, 'INVALID_INPUT', 'Email is invalid.', { field: 'email' })
  }

  const supabase = getServiceSupabase()
  const normalizedEmail = body.email.toLowerCase().trim()

  // Verify the calendar exists and is public
  const { data: calendar, error: calErr } = await supabase
    .from('calendars')
    .select('id, name, slug, calendar_id, logo_url, settings')
    .eq('id', body.calendar_id)
    .eq('is_active', true)
    .eq('visibility', 'public')
    .maybeSingle()

  if (calErr || !calendar) {
    return errorResponse(404, 'CALENDAR_NOT_FOUND', 'Calendar not found.')
  }

  // Find or create person
  const personId = await findOrCreatePerson(supabase, {
    email: normalizedEmail,
    name: body.name,
    phone: body.phone,
  })

  if (!personId) {
    return errorResponse(500, 'INTERNAL', 'Could not create person record.')
  }

  // Is the caller already authenticated as this email?
  let alreadyAuthed = false
  try {
    const brand = await getServerBrand()
    const authedClient = await createAuthenticatedServerSupabase(brand)
    const { data: authRes } = await authedClient.auth.getUser()
    const authedEmail = authRes?.user?.email?.toLowerCase().trim()
    if (authedEmail && authedEmail === normalizedEmail) {
      alreadyAuthed = true
    }
  } catch (err) {
    console.warn('[calendar-members] auth check failed:', err)
  }

  const now = new Date().toISOString()

  // Upsert the calendar_members row. Always active — no double-opt-in.
  const { data: existingMember } = await supabase
    .from('calendars_members')
    .select('id, membership_status')
    .eq('calendar_id', (calendar as CalendarRow).id)
    .eq('person_id', personId)
    .maybeSingle()

  if (existingMember) {
    const existing = existingMember as { id: string; membership_status: string }
    if (existing.membership_status !== 'active') {
      await supabase
        .from('calendars_members')
        .update({
          membership_status: 'active',
          confirmed_at: now,
          confirmation_token: null,
          confirmation_sent_at: null,
        })
        .eq('id', existing.id)
    }
  } else {
    const { error: insertErr } = await supabase
      .from('calendars_members')
      .insert({
        calendar_id: (calendar as CalendarRow).id,
        person_id: personId,
        email: normalizedEmail,
        membership_type: 'subscriber',
        membership_status: 'active',
        email_notifications: body.notification_preferences?.email !== false,
        push_notifications: body.notification_preferences?.push === true,
        signup_source: 'portal_form',
        confirmed_at: now,
        unsubscribe_token: generateUnsubscribeToken(),
        marketing_consent_at: body.marketing_consent ? now : null,
      })

    if (insertErr) {
      console.error('[calendar-members] insert failed:', insertErr)
      return errorResponse(500, 'INTERNAL', 'Something went wrong. Please try again.')
    }
  }

  // If the caller isn't already signed in, trigger a magic link via the
  // standard people-signup edge function. The link lands on /sign-in, which
  // picks up the hash tokens and forwards the user to the calendar page.
  let magicLinkSent = false
  if (!alreadyAuthed) {
    const portalBase = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
    const slug = (calendar as CalendarRow).slug || (calendar as CalendarRow).calendar_id
    const calendarUrl = `${portalBase}/calendars/${slug}?joined=1`
    const signInCallback = `${portalBase}/sign-in?redirectTo=${encodeURIComponent(calendarUrl)}`
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     request.headers.get('x-real-ip') ||
                     null
    magicLinkSent = await triggerPeopleSignupMagicLink({
      email: normalizedEmail,
      name: body.name,
      redirectTo: signInCallback,
      clientIp,
    })
  }

  return NextResponse.json({
    data: {
      status: 'active',
      message: alreadyAuthed
        ? `You're now a member of ${(calendar as CalendarRow).name}.`
        : `You're in! Check your email for a magic link to sign in.`,
      magic_link_sent: magicLinkSent,
      already_authed: alreadyAuthed,
    },
    error: null,
  })
}
