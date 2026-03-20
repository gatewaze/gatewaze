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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EventRegistrationRequest {
  email: string
  event_id: string // Can be UUID or short event_id
  first_name?: string
  last_name?: string
  company?: string
  job_title?: string
  phone?: string
  linkedin_url?: string
  registration_type?: 'free' | 'paid' | 'comp' | 'sponsor' | 'speaker' | 'staff' | 'vip' | 'individual' | 'sponsor_staff'
  ticket_type?: string
  payment_status?: 'pending' | 'paid' | 'refunded' | 'comp'
  amount_paid?: number
  currency?: string
  sponsor_permission?: boolean
  marketing_consent?: boolean // Whether registrant consents to marketing emails (default: false)
  source?: string // Marketing source: linkedin, facebook, email_campaign, referral, website, partner, organic, ads
  utm_source?: string // UTM source parameter
  utm_medium?: string // UTM medium parameter (e.g., email, social, cpc)
  utm_campaign?: string // UTM campaign name
  referrer?: string // Referrer URL or identifier
  metadata?: Record<string, any>
}

interface EventRegistrationResponse {
  success: boolean
  message: string
  registration_id?: string
  member_profile_id?: string
  person_id?: number
  already_registered?: boolean
  error?: string
}

export default async function(req: Request) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    const body: EventRegistrationRequest = await req.json()
    const {
      email,
      event_id,
      first_name,
      last_name,
      company,
      job_title,
      phone,
      linkedin_url,
      registration_type = 'free',
      ticket_type,
      payment_status = 'comp',
      amount_paid,
      currency = 'USD',
      sponsor_permission,
      marketing_consent = false,
      source,
      utm_source,
      utm_medium,
      utm_campaign,
      referrer,
      metadata = {}
    } = body

    // Validate required fields
    if (!email) {
      return new Response(JSON.stringify({ success: false, error: 'Email is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!event_id) {
      return new Response(JSON.stringify({ success: false, error: 'Event ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid email format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const normalizedEmail = email.toLowerCase().trim()
    console.log(`📝 Processing event registration for: ${normalizedEmail}, event: ${event_id}`)

    // Step 1: Verify event exists and get the short event_id (include location for person attributes)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    let eventQuery = supabase.from('events').select('id, event_id, event_title, enable_registration, event_city, event_country_code, venue_address')

    if (uuidRegex.test(event_id)) {
      eventQuery = eventQuery.eq('id', event_id)
    } else {
      eventQuery = eventQuery.eq('event_id', event_id)
    }

    const { data: eventRecord, error: eventError } = await eventQuery.maybeSingle()

    if (eventError) {
      console.error('Error fetching event:', eventError)
      return new Response(JSON.stringify({ success: false, error: 'Failed to verify event' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!eventRecord) {
      return new Response(JSON.stringify({ success: false, error: `Event not found: ${event_id}` }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check if registration is enabled for this event
    if (eventRecord.enable_registration === false) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Registration is not enabled for this event'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const resolvedEventId = eventRecord.event_id // Use short event_id for registration
    console.log(`✅ Event verified: ${eventRecord.event_title} (${resolvedEventId})`)

    // Step 2: Get IP-based location (prioritize this over event location)
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     req.headers.get('x-real-ip') ||
                     null
    const ipLocation = await getIpLocation(clientIp)
    if (ipLocation?.city) {
      console.log(`📍 IP location detected: ${ipLocation.city}, ${ipLocation.country}`)
    }

    // Step 3: Find or create person (pass both IP location and event location)
    let person = await findOrCreatePerson(normalizedEmail, {
      first_name,
      last_name,
      company,
      job_title,
      phone,
      linkedin_url,
      source: 'event_registration',
      marketing_consent,
    }, {
      city: eventRecord.event_city,
      country: eventRecord.event_country_code,
      address: eventRecord.venue_address,
    }, ipLocation)

    if (!person) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to create or find person'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`✅ Person ready: id=${person.id}`)

    // Step 4: Get or create member profile
    const memberProfile = await getOrCreateMemberProfile(person.id)

    if (!memberProfile) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to create member profile'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`✅ Member profile ready: id=${memberProfile.id}`)

    // Step 5: Check if already registered
    const { data: existingReg } = await supabase
      .from('events_registrations')
      .select('id')
      .eq('event_id', resolvedEventId)
      .eq('people_profile_id', memberProfile.id)
      .maybeSingle()

    if (existingReg) {
      console.log(`⚠️ Already registered: ${existingReg.id}`)
      return new Response(JSON.stringify({
        success: true,
        message: 'Already registered for this event',
        registration_id: existingReg.id,
        people_profile_id: memberProfile.id,
        person_id: person.id,
        already_registered: true
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Step 6: Create registration
    const registrationData: Record<string, any> = {
      event_id: resolvedEventId,
      people_profile_id: memberProfile.id,
      registration_type,
      ticket_type: ticket_type || null,
      registration_source: 'website',
      payment_status,
      amount_paid: amount_paid || null,
      currency,
      status: 'confirmed',
      registration_metadata: metadata,
      registered_at: new Date().toISOString()
    }

    // Add optional fields
    if (sponsor_permission !== undefined) {
      registrationData.sponsor_permission = sponsor_permission
    }
    // If source is not provided, fall back to utm_source
    if (source) {
      registrationData.source = source
    } else if (utm_source) {
      registrationData.source = utm_source
    }
    // Add UTM tracking fields
    if (utm_source) {
      registrationData.utm_source = utm_source
    }
    if (utm_medium) {
      registrationData.utm_medium = utm_medium
    }
    if (utm_campaign) {
      registrationData.utm_campaign = utm_campaign
    }
    if (referrer) {
      registrationData.referrer = referrer
    }

    const { data: registration, error: regError } = await supabase
      .from('events_registrations')
      .insert(registrationData)
      .select('id')
      .single()

    if (regError) {
      console.error('Error creating registration:', regError)
      return new Response(JSON.stringify({
        success: false,
        error: `Failed to create registration: ${regError.message}`
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`✅ Registration created: ${registration.id}`)

    // Step 7: Notify integration modules about the registration (non-blocking)
    emitIntegrationEvent(supabase, 'event.registered', {
      email: normalizedEmail,
      event_id: resolvedEventId,
      event_title: eventRecord.event_title,
      registration_type,
      registration_source: 'website',
    })

    // Step 8: Send registration confirmation email if enabled (non-blocking)
    sendRegistrationEmail({
      eventId: resolvedEventId,
      eventTitle: eventRecord.event_title,
      email: normalizedEmail,
      firstName: first_name,
      lastName: last_name,
      personId: person.id,
    }).catch(err => console.error('Failed to send registration email:', err))

    // Conversion tracking is now handled by the DB trigger on event_registrations INSERT
    // (send_conversion_on_registration) — tracking_session_id is stored in registration_metadata

    const response: EventRegistrationResponse = {
      success: true,
      message: 'Successfully registered for event',
      registration_id: registration.id,
      people_profile_id: memberProfile.id,
      person_id: person.id,
      already_registered: false
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('❌ Event registration error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
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
 * Find existing person or create new one
 */
async function findOrCreatePerson(
  email: string,
  attributes: Record<string, any>,
  eventLocation?: { city?: string | null; country?: string | null; address?: string | null },
  ipLocation?: { city?: string; country?: string; country_code?: string; continent?: string; location?: string } | null
): Promise<{ id: number; cio_id: string } | null> {
  try {
    // Check if person already exists
    const { data: existingPerson } = await supabase
      .from('people')
      .select('id, cio_id, attributes')
      .ilike('email', email)
      .maybeSingle()

    if (existingPerson) {
      console.log('Person exists:', existingPerson.id)

      // Check if we need to update location fields - prioritize IP location over event location
      const existingAttrs = existingPerson.attributes as Record<string, any> || {}
      const needsCity = !existingAttrs.city && (ipLocation?.city || eventLocation?.city)
      const needsCountry = !existingAttrs.country && (ipLocation?.country || eventLocation?.country)
      const needsCountryCode = !existingAttrs.country_code && ipLocation?.country_code
      const needsContinent = !existingAttrs.continent && ipLocation?.continent
      const needsLocation = !existingAttrs.location && ipLocation?.location
      const needsAddress = !existingAttrs.address && eventLocation?.address

      if (needsCity || needsCountry || needsCountryCode || needsContinent || needsLocation || needsAddress) {
        const updatedAttrs = { ...existingAttrs }
        if (needsCity) updatedAttrs.city = ipLocation?.city || eventLocation?.city
        if (needsCountry) updatedAttrs.country = ipLocation?.country || eventLocation?.country
        if (needsCountryCode) updatedAttrs.country_code = ipLocation?.country_code
        if (needsContinent) updatedAttrs.continent = ipLocation?.continent
        if (needsLocation) updatedAttrs.location = ipLocation?.location
        if (needsAddress) updatedAttrs.address = eventLocation?.address

        await supabase
          .from('people')
          .update({ attributes: updatedAttrs })
          .eq('id', existingPerson.id)

        const locationSource = ipLocation?.city ? 'IP address' : 'event venue'
        console.log(`Updated existing person ${existingPerson.id} with location from ${locationSource}`)

        // Notify integration modules about the location update (fire-and-forget)
        const locationAttrs: Record<string, unknown> = {}
        if (needsCity) locationAttrs.city = ipLocation?.city || eventLocation?.city
        if (needsCountry) locationAttrs.country = ipLocation?.country || eventLocation?.country
        if (needsCountryCode) locationAttrs.country_code = ipLocation?.country_code
        if (needsContinent) locationAttrs.continent = ipLocation?.continent
        if (needsLocation) locationAttrs.location = ipLocation?.location
        if (needsAddress) locationAttrs.address = eventLocation?.address
        emitIntegrationEvent(supabase, 'person.updated', { email, attributes: locationAttrs })
      }

      // Only upgrade marketing_consent from false/undefined to true, never downgrade
      if (attributes.marketing_consent === true && existingAttrs.marketing_consent !== true) {
        const updatedAttrs = { ...existingAttrs, marketing_consent: true }
        await supabase
          .from('people')
          .update({ attributes: updatedAttrs })
          .eq('id', existingPerson.id)
        console.log(`Upgraded marketing_consent to true for person ${existingPerson.id}`)
      }

      // Notify integration modules about attribute updates (fire-and-forget)
      if (attributes.first_name || attributes.last_name || attributes.company) {
        const profileAttrs: Record<string, unknown> = {}
        if (attributes.first_name) profileAttrs.first_name = attributes.first_name
        if (attributes.last_name) profileAttrs.last_name = attributes.last_name
        if (attributes.company) profileAttrs.company = attributes.company
        if (attributes.job_title) profileAttrs.job_title = attributes.job_title
        if (attributes.phone) profileAttrs.phone = attributes.phone
        if (attributes.linkedin_url) profileAttrs.linkedin_url = attributes.linkedin_url
        emitIntegrationEvent(supabase, 'person.updated', { email, attributes: profileAttrs })
      }

      return existingPerson
    }

    console.log('Creating new person:', email)

    // Prepare attributes for new person
    const newPersonAttrs: Record<string, any> = {
      email,
      source: attributes.source || 'event_registration',
      signup_source: 'event_registration',
      created_at: Math.floor(Date.now() / 1000),
      marketing_consent: attributes.marketing_consent === true,
    }

    // Add profile fields if provided
    if (attributes.first_name) newPersonAttrs.first_name = attributes.first_name
    if (attributes.last_name) newPersonAttrs.last_name = attributes.last_name
    if (attributes.company) newPersonAttrs.company = attributes.company
    if (attributes.job_title) newPersonAttrs.job_title = attributes.job_title
    if (attributes.phone) newPersonAttrs.phone = attributes.phone
    if (attributes.linkedin_url) newPersonAttrs.linkedin_url = attributes.linkedin_url
    // Add location - prioritize IP location over event location
    newPersonAttrs.city = ipLocation?.city || eventLocation?.city
    newPersonAttrs.country = ipLocation?.country || eventLocation?.country
    if (ipLocation?.country_code) newPersonAttrs.country_code = ipLocation.country_code
    if (ipLocation?.continent) newPersonAttrs.continent = ipLocation.continent
    if (ipLocation?.location) newPersonAttrs.location = ipLocation.location
    if (eventLocation?.address) newPersonAttrs.address = eventLocation.address

    // Notify integration modules about the new person (fire-and-forget)
    emitIntegrationEvent(supabase, 'person.created', { email, attributes: newPersonAttrs })

    // Use temporary cio_id based on email - will be updated by customerio-webhook
    const temporaryCioId = `email:${email.toLowerCase()}`
    console.log('Using temporary cio_id:', temporaryCioId)

    // Create auth user
    let authUserId: string | null = null
    try {
      const { data: newAuthUser, error: createError } = await supabase.auth.admin.createUser({
        email: email,
        email_confirm: false,
      })

      if (createError) {
        // Check if auth user already exists
        if (createError.message?.includes('already been registered')) {
          console.log('Auth user already exists, looking up ID...')
          // Use our RPC function to get the auth user ID
          const { data: existingAuthUserId } = await supabase
            .rpc('get_auth_user_id_by_email', { p_email: email })
          if (existingAuthUserId) {
            authUserId = existingAuthUserId
            console.log('Found existing auth user:', authUserId)
          }
        } else {
          console.error('Failed to create auth user:', createError)
        }
      } else if (newAuthUser.user) {
        authUserId = newAuthUser.user.id
        console.log('Created auth user:', authUserId)
      }
    } catch (error) {
      console.error('Error creating auth user:', error)
    }

    // Create person record in Supabase
    const personAttributes: Record<string, any> = {
      marketing_consent: attributes.marketing_consent === true,
    }
    if (attributes.first_name) personAttributes.first_name = attributes.first_name
    if (attributes.last_name) personAttributes.last_name = attributes.last_name
    if (attributes.company) personAttributes.company = attributes.company
    if (attributes.job_title) personAttributes.job_title = attributes.job_title
    if (attributes.phone) personAttributes.phone = attributes.phone
    if (attributes.linkedin_url) personAttributes.linkedin_url = attributes.linkedin_url
    // Add location - prioritize IP location over event location
    if (ipLocation?.city || eventLocation?.city) personAttributes.city = ipLocation?.city || eventLocation.city
    if (ipLocation?.country || eventLocation?.country) personAttributes.country = ipLocation?.country || eventLocation.country
    if (ipLocation?.country_code) personAttributes.country_code = ipLocation.country_code
    if (ipLocation?.continent) personAttributes.continent = ipLocation.continent
    if (ipLocation?.location) personAttributes.location = ipLocation.location
    if (eventLocation?.address) personAttributes.address = eventLocation.address

    const { data: newPerson, error: insertError } = await supabase
      .from('people')
      .insert({
        cio_id: temporaryCioId,
        email: email,
        auth_user_id: authUserId,
        attributes: personAttributes,
        last_synced_at: new Date().toISOString()
      })
      .select('id, cio_id')
      .single()

    if (insertError) {
      console.error('Error creating person:', insertError)
      // Try to fetch in case of race condition (person was created by another request)
      const { data: retryPerson } = await supabase
        .from('people')
        .select('id, cio_id')
        .ilike('email', email)
        .maybeSingle()

      if (retryPerson) {
        console.log('Found person on retry:', retryPerson.id)
        return retryPerson
      }
      return null
    }

    console.log('Person created in Supabase:', newPerson.id)
    return newPerson

  } catch (error) {
    console.error('Error in findOrCreatePerson:', error)
    return null
  }
}

/**
 * Get or create member profile for person
 */
async function getOrCreateMemberProfile(personId: number): Promise<{ id: string } | null> {
  try {
    // Use the RPC function that handles QR code generation
    const { data: memberProfileId, error: rpcError } = await supabase
      .rpc('people_get_or_create_profile', {
        p_person_id: personId,
      })

    if (rpcError) {
      console.error('Error creating member profile:', rpcError)
      return null
    }

    return { id: memberProfileId }
  } catch (error) {
    console.error('Error in getOrCreateMemberProfile:', error)
    return null
  }
}

/**
 * Encode email for calendar URLs using XOR encryption
 * This matches the encoding used by the calendar edge function
 */
function encodeEmailForCalendar(email: string): string {
  const passphrase = 'HideMe'
  const emailLower = email.toLowerCase()
  const bytes: number[] = []
  for (let i = 0; i < emailLower.length; i++) {
    const emailCharCode = emailLower.charCodeAt(i)
    const passCharCode = passphrase.charCodeAt(i % passphrase.length)
    bytes.push(emailCharCode ^ passCharCode)
  }
  // Convert to base64 and make URL-safe
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  return base64
}

// SendGrid from address configuration (matching emailService.ts)
const FROM_ADDRESSES: Record<string, string> = {
  events: Deno.env.get('SENDGRID_FROM_EVENTS') || 'events@techtickets.dev',
  partners: Deno.env.get('SENDGRID_FROM_PARTNERS') || 'partners@techtickets.dev',
  members: Deno.env.get('SENDGRID_FROM_MEMBERS') || 'members@techtickets.dev',
  admin: Deno.env.get('SENDGRID_FROM_ADMIN') || 'admin@techtickets.dev',
  default: Deno.env.get('SENDGRID_FROM_DEFAULT') || 'hello@techtickets.dev',
}

interface SendRegistrationEmailParams {
  eventId: string
  eventTitle: string
  email: string
  firstName?: string
  lastName?: string
  personId: number
}

/**
 * Send registration confirmation email if enabled for the event
 */
async function sendRegistrationEmail(params: SendRegistrationEmailParams): Promise<void> {
  const { eventId, eventTitle, email, firstName, lastName, personId } = params

  try {
    // Check if event has registration email enabled
    const { data: settings, error: settingsError } = await supabase
      .from('events_communication_settings')
      .select('registration_email_enabled, registration_email_template_id, registration_email_from_key, registration_email_reply_to, registration_email_subject, registration_email_content')
      .eq('event_id', eventId)
      .maybeSingle()

    if (settingsError) {
      console.error('Error fetching communication settings:', settingsError)
      return
    }

    if (!settings || !settings.registration_email_enabled) {
      console.log('Registration email not enabled for event:', eventId)
      return
    }

    // Get subject and content from template or inline settings
    let emailSubject: string | null = null
    let emailContent: string | null = null

    if (settings.registration_email_template_id) {
      // Get the email template
      const { data: template, error: templateError } = await supabase
        .from('email_templates')
        .select('subject, content_html')
        .eq('id', settings.registration_email_template_id)
        .eq('is_active', true)
        .maybeSingle()

      if (templateError) {
        console.error('Error fetching email template:', templateError)
      }

      if (template) {
        emailSubject = template.subject
        emailContent = template.content_html
      }
    }

    // Fall back to inline content if no template or template not found
    if (!emailSubject || !emailContent) {
      emailSubject = settings.registration_email_subject || null
      emailContent = settings.registration_email_content || null
    }

    // Return if neither template nor inline content available
    if (!emailSubject || !emailContent) {
      console.log('No email content configured for event:', eventId)
      return
    }

    // Get event details for template variables
    const { data: eventDetails } = await supabase
      .from('events')
      .select('event_title, event_city, event_country_code, event_start, event_end, event_location, event_link')
      .eq('event_id', eventId)
      .maybeSingle()

    // Generate encoded email for calendar links
    const emailEncoded = encodeEmailForCalendar(email)
    const calendarBaseUrl = `${supabaseUrl}/functions/v1/calendar`

    // Build template context
    const context = {
      customer: {
        first_name: firstName || '',
        last_name: lastName || '',
        full_name: [firstName, lastName].filter(Boolean).join(' ') || '',
        email: email,
      },
      event: {
        name: eventDetails?.event_title || eventTitle,
        title: eventDetails?.event_title || eventTitle,
        city: eventDetails?.event_city || '',
        country: eventDetails?.event_country_code || '',
        location: eventDetails?.event_location || '',
        link: eventDetails?.event_link || '',
        start_date: eventDetails?.event_start ? new Date(eventDetails.event_start).toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) : '',
        end_date: eventDetails?.event_end ? new Date(eventDetails.event_end).toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) : '',
      },
      calendar: {
        google: `${calendarBaseUrl}/${eventId}/google/${emailEncoded}`,
        outlook: `${calendarBaseUrl}/${eventId}/outlook/${emailEncoded}`,
        apple: `${calendarBaseUrl}/${eventId}/apple/${emailEncoded}`,
        ics: `${calendarBaseUrl}/${eventId}/ics/${emailEncoded}`,
      },
    }

    // Replace template variables (Customer.io style: {{scope.field}} or {{scope.field | default:"value"}})
    const replaceVariables = (text: string): string => {
      return text.replace(/\{\{([^}]+)\}\}/g, (match, content) => {
        // Parse the content - check for default value
        const defaultMatch = content.match(/^(.+?)\s*\|\s*default:\s*"([^"]*)"/)
        const path = defaultMatch ? defaultMatch[1].trim() : content.trim()
        const defaultValue = defaultMatch ? defaultMatch[2] : ''

        const parts = path.split('.')
        let value: any = context
        for (const part of parts) {
          if (value && typeof value === 'object' && part in value) {
            value = value[part]
          } else {
            value = null
            break
          }
        }

        // Use value if it's a non-empty string, otherwise use default
        if (typeof value === 'string' && value.length > 0) {
          return value
        }
        return defaultValue || match
      })
    }

    const processedSubject = replaceVariables(emailSubject)
    const processedHtml = replaceVariables(emailContent)

    // Get from address
    const fromKey = settings.registration_email_from_key || 'events'
    const fromAddress = FROM_ADDRESSES[fromKey] || FROM_ADDRESSES.events

    console.log(`📧 Sending registration confirmation email to ${email} for event ${eventId}`)

    // Send email via the send-email edge function
    const sendEmailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: email,
        from: fromAddress,
        subject: processedSubject,
        html: processedHtml,
        replyTo: settings.registration_email_reply_to || undefined,
        personId: personId,
      }),
    })

    if (!sendEmailResponse.ok) {
      const errorText = await sendEmailResponse.text()
      console.error('Failed to send registration email:', errorText)
      return
    }

    console.log(`✅ Registration confirmation email sent to ${email}`)

    // Increment template usage count (non-blocking) - only if we used a template
    if (settings.registration_email_template_id) {
      supabase.rpc('increment_email_template_usage', {
        template_id: settings.registration_email_template_id,
      }).catch(() => {
        // Ignore errors from missing RPC
      })
    }

  } catch (error) {
    console.error('Error sending registration email:', error)
  }
}
