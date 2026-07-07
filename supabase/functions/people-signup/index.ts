import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { emitIntegrationEvent } from '../_shared/integrationEvents.ts'
import { isEmailConfigured, sendEmail } from '../_shared/email.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SignupRequest {
  email: string
  user_metadata?: {
    first_name?: string
    last_name?: string
    company?: string
    job_title?: string
    full_name?: string
    avatar_url?: string
    provider?: string
    [key: string]: any // Allow additional custom fields
  }
  source: string // Required - identifies which app/platform the signup came from
  app?: string // Optional - app identifier (cohorts, app, etc.)
  redirect_to?: string // Optional - callback URL for magic link redirect
  geo_refresh?: boolean // Geo-only refresh (portal visit): update IP/location, nothing else
  timezone?: string // Optional - browser IANA timezone, used as a fallback when IP geo yields none
}

interface SignupResponse {
  success: boolean
  message: string
  person_id?: string
  cio_id?: string
  missing_fields?: string[]
  user_id?: string
  error?: string
  magic_link_sent?: boolean
}

async function handler(req: Request) {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    const body: SignupRequest = await req.json()
    const { email, user_metadata = {}, source, app, redirect_to } = body

    if (!email) {
      return new Response(JSON.stringify({ error: 'Email required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!source) {
      return new Response(JSON.stringify({ error: 'Source required (e.g., "cohorts_email_signup", "app_google_oauth")' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`Processing signup for: ${email} from source: ${source}`)
    console.log('User metadata:', user_metadata)

    // Get IP-based location
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     req.headers.get('x-real-ip') ||
                     null
    const ipLocation = await getIpLocation(clientIp)
    if (ipLocation?.city) {
      console.log(`📍 IP location detected: ${ipLocation.city}, ${ipLocation.country}`)
    }
    // Browser-supplied IANA timezone (validated). Used ONLY as a fallback when
    // IP geolocation resolves no timezone (localhost/private IPs, VPNs, proxies)
    // and the user hasn't already set one — a real IP result always wins.
    const browserTz = validTimezone(body.timezone)

    // Get auth user ID from request JWT token
    // NOTE: For admin_team_invite, we should NOT use the current user's auth ID
    // because that would be the admin creating the invite, not the new team member
    const authHeader = req.headers.get('Authorization')
    let currentAuthUserId: string | null = null

    // Only use the JWT user ID if this is NOT an admin team invite
    // For admin invites, we want to create/lookup the auth user for the invited email
    const isAdminInvite = source === 'admin_team_invite'

    if (!isAdminInvite && authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '')
      // Only try to get user if it's not the anon key
      if (token !== Deno.env.get('SUPABASE_ANON_KEY')) {
        const { data: { user } } = await supabase.auth.getUser(token)
        currentAuthUserId = user?.id || null
      }
    }

    // Geo-only refresh (portal visit). Securely scoped to the caller's own person
    // via their JWT — refreshes IP-derived location and nothing else (no consent,
    // source, person creation, or magic link). Called once per session.
    if (body.geo_refresh) {
      if (currentAuthUserId && (ipLocation || clientIp)) {
        const { data: gp } = await supabase
          .from('people')
          .select('id, attributes')
          .eq('auth_user_id', currentAuthUserId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (gp) {
          const ex = (gp.attributes as Record<string, any>) || {}
          const upd: Record<string, any> = { ...ex }
          if (ipLocation?.city) upd.city = ipLocation.city
          if (ipLocation?.country) upd.country = ipLocation.country
          if (ipLocation?.country_code) upd.country_code = ipLocation.country_code
          if (ipLocation?.continent) upd.continent = ipLocation.continent
          if (ipLocation?.location) upd.location = ipLocation.location
          if (ipLocation?.timezone && !ex.timezone) upd.timezone = ipLocation.timezone
          else if (browserTz && !ex.timezone) upd.timezone = browserTz
          if (clientIp) upd.ip_address = clientIp
          upd.geo_updated_at = new Date().toISOString()
          await supabase.from('people').update({ attributes: upd }).eq('id', gp.id)
        }
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Step 1: Check if person already exists in Supabase.
    // Duplicate rows for one human exist in the wild (case-variant emails from
    // imports vs signups — 708 such pairs found in prod on 2026-07-07).
    // maybeSingle() ERRORS on those, the error was destructured away, and the
    // undefined result read as "no person" — so every sign-in for an affected
    // user minted ANOTHER duplicate row. Fetch all matches and pick
    // deterministically instead. Also escape ilike wildcards: an unescaped
    // underscore (diego_ibarrola@…) matches any character and can hit a
    // different person's row.
    const emailPattern = email.replace(/[\\%_]/g, (ch) => `\\${ch}`)
    const { data: personMatches } = await supabase
      .from('people')
      .select('id, cio_id, email, auth_user_id, attributes')
      .ilike('email', emailPattern)
      .order('created_at', { ascending: true })
    // Prefer a row already linked to an auth user, else the oldest.
    const existingPerson = personMatches?.find((p) => p.auth_user_id) ?? personMatches?.[0] ?? null

    // Before trusting the people row's auth_user_id, verify it still points
    // at an auth user whose email matches the target. A stale row (e.g.
    // poisoned by a previous call that leaked a different caller's JWT)
    // would otherwise make us return the wrong auth_user_id here — the
    // admin UI would then find the *wrong* admin_profile and skip
    // creating a new one, silently dropping the invite.
    const existingAuthIsTrusted = existingPerson?.auth_user_id
      ? await authUserMatchesEmail(existingPerson.auth_user_id, email)
      : false
    if (existingPerson?.auth_user_id && !existingAuthIsTrusted) {
      console.warn(
        `[people-signup] people row ${existingPerson.id} points at auth_user_id ` +
        `${existingPerson.auth_user_id} but that user's email does not match ` +
        `${email}. Ignoring the stale link — the row will be rewritten later.`,
      )
    }

    if (existingPerson?.auth_user_id && existingAuthIsTrusted) {
      console.log(`Person already exists with auth: ${existingPerson.auth_user_id}`)

      // Update attributes if new metadata provided OR IP location available.
      // IP-derived details are REFRESHED (overwritten) on each sign-in/visit.
      const existingAttrs = existingPerson.attributes as Record<string, any> || {}
      const hasLocation = !!(ipLocation || clientIp)

      if (Object.keys(user_metadata).length > 0 || hasLocation) {
        const updatedAttributes: Record<string, any> = {
          ...existingAttrs,
          ...user_metadata,
          // Update source if different (track latest signup source)
          last_signup_source: source,
          // Set marketing_consent to true for direct signups, but don't overwrite an explicit false
          ...(existingAttrs.marketing_consent !== false ? { marketing_consent: true } : {}),
        }

        // Refresh IP-derived location on every sign-in/visit (overwrite stale data).
        if (ipLocation?.city) updatedAttributes.city = ipLocation.city
        if (ipLocation?.country) updatedAttributes.country = ipLocation.country
        if (ipLocation?.country_code) updatedAttributes.country_code = ipLocation.country_code
        if (ipLocation?.continent) updatedAttributes.continent = ipLocation.continent
        if (ipLocation?.location) updatedAttributes.location = ipLocation.location
        // Timezone from IP only fills a gap — never override a user-set timezone.
        if (ipLocation?.timezone && !existingAttrs.timezone && !user_metadata.timezone) {
          updatedAttributes.timezone = ipLocation.timezone
        } else if (browserTz && !existingAttrs.timezone && !user_metadata.timezone) {
          updatedAttributes.timezone = browserTz
        }
        if (clientIp) updatedAttributes.ip_address = clientIp
        if (hasLocation) updatedAttributes.geo_updated_at = new Date().toISOString()

        await supabase
          .from('people')
          .update({ attributes: updatedAttributes })
          .eq('id', existingPerson.id)

        console.log(`Updated person ${existingPerson.id} with${hasLocation ? ' refreshed IP location and' : ''} attributes`)

        // Notify integration modules about the attribute update
        emitIntegrationEvent(supabase, 'person.updated', { email, attributes: updatedAttributes })
      }

      // Determine missing fields based on people_attributes config
      const requiredFields = await getRequiredAttributeKeys()
      const missingFields: string[] = []
      const combinedData = { ...existingPerson.attributes, ...user_metadata }

      for (const field of requiredFields) {
        if (!combinedData[field]) {
          missingFields.push(field)
        }
      }

      // Send magic link if requested (portal sign-in flow). Skipped when the
      // caller is already authenticated (e.g. profile wizard after SSO).
      const magicLinkSent = await sendMagicLinkIfRequested(email, app, redirect_to, !!currentAuthUserId)

      return new Response(JSON.stringify({
        success: true,
        message: 'Person already exists',
        person_id: existingPerson.id,
        cio_id: existingPerson.cio_id,
        user_id: existingPerson.auth_user_id,
        missing_fields: missingFields,
        magic_link_sent: magicLinkSent,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Step 2: Prepare attributes for Customer.io
    const appPrefix = app || extractAppFromSource(source)
    const attributes: Record<string, any> = {
      ...user_metadata,
      source, // Original signup source
      signup_source: source, // Alias for clarity
      created_at: Math.floor(Date.now() / 1000),
      signup_platform: app || appPrefix,
      marketing_consent: true, // Direct platform signups consent by default
    }

    // Add IP-derived location + the raw IP if available
    if (ipLocation?.city) attributes.city = ipLocation.city
    if (ipLocation?.country) attributes.country = ipLocation.country
    if (ipLocation?.country_code) attributes.country_code = ipLocation.country_code
    if (ipLocation?.continent) attributes.continent = ipLocation.continent
    if (ipLocation?.location) attributes.location = ipLocation.location
    // Timezone from IP only as a fallback — don't override a user-provided one.
    if (ipLocation?.timezone && !attributes.timezone) attributes.timezone = ipLocation.timezone
    else if (browserTz && !attributes.timezone) attributes.timezone = browserTz
    if (clientIp) attributes.ip_address = clientIp
    if (ipLocation || clientIp) attributes.geo_updated_at = new Date().toISOString()

    console.log('Preparing person record for email:', email)
    console.log('Attributes:', attributes)

    // Step 3: Use temporary cio_id based on email
    // The real cio_id will be updated when CIO sends a webhook after indexing
    const temporaryCioId = `email:${email.toLowerCase()}`
    console.log('Using temporary cio_id:', temporaryCioId)

    // Notify integration modules about the new person
    emitIntegrationEvent(supabase, 'person.created', { email, attributes })

    // Use temporary cio_id - will be updated by customerio-webhook when CIO sends customer_created event
    const cioId = temporaryCioId

    // Step 5: Get the auth user ID
    let authUserId = currentAuthUserId

    // NEVER link the CALLER's auth user to a person with a different email.
    // When an admin invites a member (source admin_member_invite etc.), the JWT
    // is the ADMIN's — blindly attaching it stamped the admin's auth_user_id
    // onto invited people, so the admin's portal person-lookup then matched
    // several rows and their profile/wizard broke (observed in prod 2026-07-07:
    // dbaker's auth user owned rahul's + demetrios's people rows).
    if (authUserId && !(await authUserMatchesEmail(authUserId, email))) {
      console.log('JWT user email differs from person email — not linking caller auth user')
      authUserId = null
    }

    // If no auth user from JWT token, look up by email. listUsers is paged —
    // the bare call returns only the first 50 users, so past that point the
    // lookup silently missed existing users and the createUser below 500'd
    // with "already registered". Page through until found.
    if (!authUserId) {
      console.log('No auth user from token, looking up by email...')
      const target = email.toLowerCase()
      for (let page = 1; page <= 200 && !authUserId; page++) {
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
        if (listError || !users?.length) break
        authUserId = users.find(u => u.email?.toLowerCase() === target)?.id || null
        if (users.length < 1000) break
      }
      console.log('Found auth user by email:', authUserId)
    }

    // If still no auth user, create one (for admin invites)
    if (!authUserId) {
      console.log('No auth user found, creating new auth user...')
      try {
        // Auto-confirm so GoTrue never sends its own "Confirm your email"
        // template. Subsequent signInWithOtp() calls hit the magic_link
        // template (the desired flow); when email_confirm was false,
        // GoTrue treated the first OTP request as a signup confirmation
        // and emailed the 6-digit code instead of a magic link.
        const { data: newAuthUser, error: createError } = await supabase.auth.admin.createUser({
          email: email,
          email_confirm: true,
          user_metadata: user_metadata
        })

        if (createError || !newAuthUser.user) {
          console.error('Failed to create auth user:', createError)
          return new Response(JSON.stringify({
            success: false,
            error: createError?.message || 'Failed to create auth user',
            message: 'Could not create user account'
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        authUserId = newAuthUser.user.id
        console.log('Created new auth user with ID:', authUserId)
      } catch (error) {
        console.error('Error creating auth user:', error)
        return new Response(JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          message: 'Failed to create auth user'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // Step 6: Create or update person record in Supabase with the cio_id from Customer.io
    // Check if person already exists (by email or cio_id). Same duplicate-row
    // hazard as Step 1: maybeSingle() errors when case-variant duplicates
    // exist, which read as "no person" and inserted another duplicate. Fetch
    // all matches and pick deterministically (auth-linked first, else oldest).
    const { data: recordMatches } = await supabase
      .from('people')
      .select('id, cio_id, email, auth_user_id, attributes')
      .or(`email.ilike.${emailPattern},cio_id.eq.${cioId}`)
      .order('created_at', { ascending: true })
    const existingPersonRecord = recordMatches?.find((p) => p.auth_user_id) ?? recordMatches?.[0] ?? null

    let person

    if (existingPersonRecord) {
      // Update existing person
      console.log('Person record already exists, updating...')
      const { data: updatedPerson, error: updateError } = await supabase
        .from('people')
        .update({
          cio_id: cioId,
          email: email,
          auth_user_id: authUserId,
          attributes: {
            ...existingPersonRecord.attributes,
            ...attributes
          },
          last_synced_at: new Date().toISOString()
        })
        .eq('id', existingPersonRecord.id)
        .select('id, cio_id, email, auth_user_id, attributes')
        .single()

      if (updateError) {
        console.error('Error updating person record:', updateError)
        return new Response(JSON.stringify({
          success: false,
          error: updateError.message,
          message: 'Failed to update person record'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      person = updatedPerson
      console.log('Person record updated in Supabase successfully')
    } else {
      // Create new person
      const { data: newPerson, error: insertError } = await supabase
        .from('people')
        .insert({
          cio_id: cioId,
          email: email,
          auth_user_id: authUserId,
          attributes: attributes,
          last_synced_at: new Date().toISOString()
        })
        .select('id, cio_id, email, auth_user_id, attributes')
        .single()

      if (insertError) {
        console.error('Error creating person record:', insertError)
        return new Response(JSON.stringify({
          success: false,
          error: insertError.message,
          message: 'Failed to create person record'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      person = newPerson
      console.log('Person record created in Supabase successfully')
    }

    // Step 7: Trigger enrichment if people-enrichment module is enabled
    await triggerEnrichmentIfEnabled(email)

    // Step 8: Determine missing fields based on people_attributes config
    const requiredFields = await getRequiredAttributeKeys()
    const missingFields: string[] = []

    for (const field of requiredFields) {
      if (!person.attributes?.[field] && !user_metadata[field]) {
        missingFields.push(field)
      }
    }

    // Send magic link if requested (portal sign-in flow). Skipped when the
    // caller is already authenticated (e.g. profile wizard after SSO).
    const magicLinkSent = await sendMagicLinkIfRequested(email, app, redirect_to, !!currentAuthUserId)

    const response: SignupResponse = {
      success: true,
      message: missingFields.length > 0
        ? 'Additional information needed'
        : 'Signup complete',
      person_id: person.id,
      cio_id: person.cio_id,
      user_id: person.auth_user_id,
      missing_fields: missingFields,
      magic_link_sent: magicLinkSent,
    }

    console.log('Signup response:', response)

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Signup error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Signup failed'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}

/**
 * Check that an auth.users row with this id actually has the given email.
 *
 * Used to defend against stale/poisoned people.auth_user_id links — if
 * the row claims an auth_user_id whose email no longer matches (e.g.
 * because an earlier call attached the caller's auth_id to a different
 * person record by mistake), we'd otherwise return the wrong id to the
 * caller and the admin UI would silently skip creating a new admin
 * profile.
 */
async function authUserMatchesEmail(authUserId: string, email: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(authUserId)
    if (error || !data?.user?.email) return false
    return data.user.email.toLowerCase() === email.toLowerCase()
  } catch {
    return false
  }
}

/**
 * Get IP-based location from ip-api.com (free, no API key required)
 * Matches implementation from normalize-person-location edge function
 *
 * Returns:
 * - city: City name (e.g., "San Francisco")
 * - country: Full country name (e.g., "United States")
 * Validate a client-supplied IANA timezone string. Returns the zone when it's a
 * real, resolvable timezone (checked via Intl), else null — so a bad/hostile
 * value can never be written to a person's attributes.
 */
function validTimezone(tz: unknown): string | null {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return null
  try {
    // Throws RangeError for an unknown timezone.
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

/**
 * - country_code: 2-letter uppercase code (e.g., "US")
 * - continent: 2-letter lowercase code (e.g., "na", "eu", "as")
 * - location: "latitude,longitude" string
 */
async function getIpLocation(ipAddress: string | null): Promise<{
  city?: string;
  country?: string;
  country_code?: string;
  continent?: string;
  location?: string;
  timezone?: string;
} | null> {
  if (!ipAddress) return null

  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ipAddress)}?fields=status,message,city,country,countryCode,continentCode,lat,lon,timezone`
    const response = await fetch(url)

    if (!response.ok) {
      console.error(`IP geolocation API error: ${response.status}`)
      return null
    }

    const data = await response.json()

    if (data.status === 'fail') {
      console.error(`IP geolocation failed: ${data.message}`)
      return null
    }

    return {
      city: data.city || undefined,
      country: data.country || undefined, // Full name: "United States"
      country_code: data.countryCode || undefined, // 2-letter code: "US"
      continent: data.continentCode ? data.continentCode.toLowerCase() : undefined, // Lowercase: "na", "eu", "as"
      location: data.lat && data.lon ? `${data.lat},${data.lon}` : undefined, // "lat,lng"
      timezone: data.timezone || undefined, // IANA tz: "America/New_York"
    }
  } catch (error) {
    console.error('Error fetching IP location:', error)
    return null
  }
}

/**
 * Extract app name from source string
 * Examples: "cohorts_email_signup" -> "cohorts", "app_google_oauth" -> "app"
 */
function extractAppFromSource(source: string): string {
  const parts = source.split('_')
  return parts[0] || 'unknown'
}

/**
 * Fetch the list of required attribute keys from the people_attributes platform setting.
 * Falls back to ['first_name', 'last_name', 'company', 'job_title'] if not configured.
 */
async function getRequiredAttributeKeys(): Promise<string[]> {
  const defaultRequired = ['first_name', 'last_name', 'company', 'job_title']

  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'people_attributes')
      .maybeSingle()

    if (error || !data?.value) return defaultRequired

    const parsed = JSON.parse(data.value)
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultRequired

    return parsed
      .filter((a: { enabled?: boolean; required?: boolean }) => a.enabled && a.required)
      .map((a: { key: string }) => a.key)
  } catch {
    return defaultRequired
  }
}

/**
 * Generate and send a magic link email when the request comes from the portal.
 * GoTrue SMTP is intentionally disabled — magic links are sent via the custom
 * email system (SendGrid / SMTP configured in environment).
 *
 * Returns true if the magic link was sent, false otherwise.
 */
async function sendMagicLinkIfRequested(
  email: string,
  app: string | undefined,
  redirectTo: string | undefined,
  alreadyAuthenticated: boolean,
): Promise<boolean> {
  if (app !== 'portal') return false
  // Never email a "here's your login link" to someone who is already signed in.
  // This is the case when an authenticated user completes the profile wizard
  // (e.g. after LFID SSO) — they have a live session, so a magic link is both
  // pointless and confusing.
  if (alreadyAuthenticated) return false
  if (!isEmailConfigured()) {
    console.warn('[magic-link] Email not configured, skipping magic link send')
    return false
  }

  try {
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: redirectTo ? { redirectTo } : undefined,
    })

    if (linkError || !linkData?.properties?.action_link) {
      console.error('[magic-link] Failed to generate link:', linkError)
      return false
    }

    // The generated action_link may have redirect_to set to the default site_url.
    // Replace it with the actual portal redirect URL if one was requested.
    let magicLink = linkData.properties.action_link
    if (redirectTo) {
      try {
        const linkUrl = new URL(magicLink)
        linkUrl.searchParams.set('redirect_to', redirectTo)
        magicLink = linkUrl.toString()
      } catch {
        // If URL parsing fails, use as-is
      }
    }

    // Fetch brand name for email template
    const { data: brandSetting } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'brand_name')
      .maybeSingle()
    const brandName = brandSetting?.value || 'Gatewaze'

    await sendEmail({
      to: email,
      subject: `Your Sign-In Link — ${brandName}`,
      html: `
        <h2>Sign In</h2>
        <p>Click the button below to sign in to ${brandName}:</p>
        <p><a href="${magicLink}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">Sign In</a></p>
        <p>Or copy this URL into your browser:</p>
        <p style="word-break:break-all;color:#666;">${magicLink}</p>
        <p style="color:#999;font-size:12px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      `,
      text: `Sign in to ${brandName}:\n\n${magicLink}\n\nThis link expires in 1 hour.`,
    })

    console.log(`[magic-link] Sent magic link to ${email}`)
    return true
  } catch (err) {
    console.error('[magic-link] Error sending magic link:', err)
    return false
  }
}

/**
 * Check if the people-enrichment module is enabled and has API keys configured,
 * then trigger enrichment for the given email address.
 * Runs as a fire-and-forget — does not block signup if enrichment fails.
 */
async function triggerEnrichmentIfEnabled(email: string): Promise<void> {
  try {
    // Check if the people-enrichment module is enabled
    const { data: mod } = await supabase
      .from('installed_modules')
      .select('status, config')
      .eq('id', 'people-enrichment')
      .maybeSingle()

    if (!mod || mod.status !== 'enabled') return

    const config = (mod.config ?? {}) as Record<string, string>

    // Check if auto-enrich is enabled (default: true)
    if (config.AUTO_ENRICH_ON_CREATE === 'false') return

    // Check if at least one enrichment API key is configured
    const hasClearbit = !!config.CLEARBIT_API_KEY
    const hasEnrichLayer = !!config.ENRICHLAYER_API_KEY
    if (!hasClearbit && !hasEnrichLayer) return

    const enrichmentMode = config.ENRICHMENT_MODE || 'full'
    console.log(`[enrichment] Triggering ${enrichmentMode} enrichment for ${email}`)

    // Call the people-enrichment edge function (fire-and-forget)
    const enrichmentUrl = `${supabaseUrl}/functions/v1/people-enrichment`
    const bearerToken = Deno.env.get('GW_API_BEARER') || ''

    fetch(enrichmentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({ email, mode: enrichmentMode }),
    }).catch((err) => {
      console.error('[enrichment] Failed to trigger enrichment:', err)
    })
  } catch (err) {
    // Don't block signup if enrichment check fails
    console.error('[enrichment] Error checking enrichment module:', err)
  }
}

export default handler;
Deno.serve(handler);
