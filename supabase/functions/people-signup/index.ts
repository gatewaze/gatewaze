import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { emitIntegrationEvent } from '../_shared/integrationEvents.ts'

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
}

interface SignupResponse {
  success: boolean
  message: string
  person_id?: string
  cio_id?: string
  missing_fields?: string[]
  user_id?: string
  error?: string
}

export default async function(req: Request) {
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
    const { email, user_metadata = {}, source, app } = body

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

    // Step 1: Check if person already exists in Supabase
    const { data: existingPerson } = await supabase
      .from('people')
      .select('id, cio_id, email, auth_user_id, attributes')
      .ilike('email', email)
      .maybeSingle()

    if (existingPerson?.auth_user_id) {
      console.log(`Person already exists with auth: ${existingPerson.auth_user_id}`)

      // Update attributes if new metadata provided OR IP location available
      const existingAttrs = existingPerson.attributes as Record<string, any> || {}
      const needsLocationUpdate = (!existingAttrs.city && ipLocation?.city) ||
                                   (!existingAttrs.country && ipLocation?.country) ||
                                   (!existingAttrs.country_code && ipLocation?.country_code) ||
                                   (!existingAttrs.continent && ipLocation?.continent) ||
                                   (!existingAttrs.location && ipLocation?.location)

      if (Object.keys(user_metadata).length > 0 || needsLocationUpdate) {
        const updatedAttributes: Record<string, any> = {
          ...existingAttrs,
          ...user_metadata,
          // Update source if different (track latest signup source)
          last_signup_source: source,
          // Set marketing_consent to true for direct signups, but don't overwrite an explicit false
          ...(existingAttrs.marketing_consent !== false ? { marketing_consent: true } : {}),
        }

        // Add IP location if missing
        if (!existingAttrs.city && ipLocation?.city) updatedAttributes.city = ipLocation.city
        if (!existingAttrs.country && ipLocation?.country) updatedAttributes.country = ipLocation.country
        if (!existingAttrs.country_code && ipLocation?.country_code) updatedAttributes.country_code = ipLocation.country_code
        if (!existingAttrs.continent && ipLocation?.continent) updatedAttributes.continent = ipLocation.continent
        if (!existingAttrs.location && ipLocation?.location) updatedAttributes.location = ipLocation.location

        await supabase
          .from('people')
          .update({ attributes: updatedAttributes })
          .eq('id', existingPerson.id)

        console.log(`Updated person ${existingPerson.id} with${needsLocationUpdate ? ' IP location and' : ''} attributes`)

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

      return new Response(JSON.stringify({
        success: true,
        message: 'Person already exists',
        person_id: existingPerson.id,
        cio_id: existingPerson.cio_id,
        user_id: existingPerson.auth_user_id,
        missing_fields: missingFields
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

    // Add IP location if available
    if (ipLocation?.city) attributes.city = ipLocation.city
    if (ipLocation?.country) attributes.country = ipLocation.country
    if (ipLocation?.country_code) attributes.country_code = ipLocation.country_code
    if (ipLocation?.continent) attributes.continent = ipLocation.continent
    if (ipLocation?.location) attributes.location = ipLocation.location

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

    // If no auth user from JWT token, look up by email
    if (!authUserId) {
      console.log('No auth user from token, looking up by email...')
      const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()
      if (!listError && users) {
        const existingUser = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
        authUserId = existingUser?.id || null
        console.log('Found auth user by email:', authUserId)
      }
    }

    // If still no auth user, create one (for admin invites)
    if (!authUserId) {
      console.log('No auth user found, creating new auth user...')
      try {
        const { data: newAuthUser, error: createError } = await supabase.auth.admin.createUser({
          email: email,
          email_confirm: false, // They'll need to verify via magic link
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
    // Check if person already exists (by email or cio_id)
    const { data: existingPersonRecord } = await supabase
      .from('people')
      .select('id, cio_id, email, auth_user_id, attributes')
      .or(`email.ilike.${email},cio_id.eq.${cioId}`)
      .maybeSingle()

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

    const response: SignupResponse = {
      success: true,
      message: missingFields.length > 0
        ? 'Additional information needed'
        : 'Signup complete',
      person_id: person.id,
      cio_id: person.cio_id,
      user_id: person.auth_user_id,
      missing_fields: missingFields
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
 * Get IP-based location from ip-api.com (free, no API key required)
 * Matches implementation from normalize-person-location edge function
 *
 * Returns:
 * - city: City name (e.g., "San Francisco")
 * - country: Full country name (e.g., "United States")
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
} | null> {
  if (!ipAddress) return null

  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ipAddress)}?fields=status,message,city,country,countryCode,continentCode,lat,lon`
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
