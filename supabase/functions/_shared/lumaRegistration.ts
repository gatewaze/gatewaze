import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { emitIntegrationEvent } from './integrationEvents.ts'

/**
 * Shared utilities for processing Luma registrations
 * Used by:
 * - process-luma-registration (email parsing for free calendars)
 * - process-luma-webhook (webhook handler for premium calendars)
 * - process-luma-csv (CSV import for bulk uploads)
 */

export interface RegistrationData {
  email: string
  firstName?: string
  lastName?: string
  fullName?: string
  phone?: string
  lumaUserId?: string
  lumaGuestId?: string
  ticketType?: string
  ticketAmount?: number // in cents for webhook, dollars for CSV (use amountInDollars for CSV)
  amountInDollars?: number // direct dollar amount (for CSV import)
  currency?: string
  approvalStatus?: string
  registrationAnswers?: Record<string, any>[] // webhook format
  surveyResponses?: Record<string, any> // CSV format (key-value pairs)
  registeredAt?: string
  couponCode?: string
  source?: 'luma_webhook' | 'luma_csv_upload' | 'luma_email_notification' | 'gradual_webhook' // registration source
  gradualUserId?: string // Gradual user ID
  trackingSessionId?: string // from Luma custom_source for conversion attribution
}

export interface EventData {
  eventId: string
  eventCity?: string | null
  eventCountryCode?: string | null
  venueAddress?: string | null
  // Extended location data for CSV import
  eventCountry?: string | null
  eventRegion?: string | null
  eventContinent?: string | null
  eventLocation?: string | null
}

export interface RegistrationResult {
  success: boolean
  error?: string
  personId?: string
  peopleProfileId?: string
  registrationId?: string
  action?: 'created' | 'updated' | 'already_exists'
}

export interface CancellationResult {
  success: boolean
  error?: string
  registrationId?: string
  previousStatus?: string
}

/**
 * Map Luma approval status to our registration status
 */
export function mapApprovalStatus(lumaStatus: string): 'pending' | 'confirmed' | 'cancelled' | 'waitlist' {
  switch (lumaStatus) {
    case 'approved':
      return 'confirmed'
    case 'pending_approval':
      return 'pending'
    case 'waitlist':
      return 'waitlist'
    case 'declined':
    case 'cancelled':
      return 'cancelled'
    case 'invited':
      return 'pending'
    case 'session':
      return 'confirmed'
    default:
      return 'confirmed'
  }
}

/**
 * Parse name into first and last name components
 */
export function parseName(fullName: string | undefined): { firstName: string; lastName: string } {
  if (!fullName) {
    return { firstName: '', lastName: '' }
  }

  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' }
  }

  const lastName = parts[parts.length - 1]
  const firstName = parts.slice(0, -1).join(' ')
  return { firstName, lastName }
}

/**
 * Create a full registration including auth user, person, people profile, and event registration
 */
export async function createFullRegistration(
  supabase: SupabaseClient,
  registration: RegistrationData,
  event: EventData,
  customerioSiteId?: string,
  customerioApiKey?: string,
  registrantMarketingConsent?: boolean
): Promise<RegistrationResult> {
  try {
    const email = registration.email.toLowerCase()

    // Parse name
    let firstName = registration.firstName
    let lastName = registration.lastName
    if ((!firstName || !lastName) && registration.fullName) {
      const parsed = parseName(registration.fullName)
      firstName = firstName || parsed.firstName
      lastName = lastName || parsed.lastName
    }

    // Check if person already exists
    let person: { id: string; cio_id: string } | null = null
    const { data: existingPerson } = await supabase
      .from('people')
      .select('id, cio_id, attributes')
      .ilike('email', email)
      .maybeSingle()

    if (existingPerson) {
      person = existingPerson

      // Update person attributes if we have new data
      const attrs = existingPerson.attributes as Record<string, any> || {}
      const updates: Record<string, any> = {}

      if (!attrs.city && event.eventCity) updates.city = event.eventCity
      if (!attrs.country && (event.eventCountry || event.eventCountryCode)) {
        updates.country = event.eventCountry || event.eventCountryCode
      }
      if (!attrs.country_code && event.eventCountryCode) updates.country_code = event.eventCountryCode
      if (!attrs.address && event.venueAddress) updates.address = event.venueAddress
      if (!attrs.region && event.eventRegion) updates.region = event.eventRegion
      if (!attrs.continent && event.eventContinent) updates.continent = event.eventContinent
      if (!attrs.location && event.eventLocation) updates.location = event.eventLocation
      if (!attrs.luma_user_id && registration.lumaUserId) updates.luma_user_id = registration.lumaUserId
      if (!attrs.gradual_user_id && registration.gradualUserId) updates.gradual_user_id = registration.gradualUserId
      if (!attrs.phone && registration.phone) updates.phone = registration.phone
      if (!attrs.first_name && firstName) updates.first_name = firstName
      if (!attrs.last_name && lastName) updates.last_name = lastName
      // Only upgrade marketing_consent from false/undefined to true, never downgrade
      if (registrantMarketingConsent === true && attrs.marketing_consent !== true) {
        updates.marketing_consent = true
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('people')
          .update({ attributes: { ...attrs, ...updates } })
          .eq('id', existingPerson.id)
        console.log(`Updated existing person ${existingPerson.id} with new attributes`)
      }
    } else {
      // Get or create auth user
      let authUserId: string | null = null

      const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()
      if (!listError && users) {
        const existingUser = users.find(u => u.email?.toLowerCase() === email)
        authUserId = existingUser?.id || null
      }

      if (!authUserId) {
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            first_name: firstName,
            last_name: lastName,
          },
        })

        if (authError) {
          if (authError.message?.includes('already been registered')) {
            const { data: { users: retryUsers } } = await supabase.auth.admin.listUsers()
            const existingUser = retryUsers?.find(u => u.email?.toLowerCase() === email)
            authUserId = existingUser?.id || null
          }
          if (!authUserId) {
            return { success: false, error: `Failed to create auth user: ${authError.message}` }
          }
        } else if (authData?.user) {
          authUserId = authData.user.id
        }
      }

      if (!authUserId) {
        return { success: false, error: 'Could not find or create auth user' }
      }

      // Determine source for tracking
      const registrationSource = registration.source || 'luma_webhook'

      // Fire-and-forget to Customer.io
      if (customerioSiteId && customerioApiKey) {
        const marketingConsent = registrantMarketingConsent === true
        const attributes: Record<string, any> = {
          first_name: firstName || null,
          last_name: lastName || null,
          source: registrationSource,
          signup_source: registrationSource,
          created_at: Math.floor(Date.now() / 1000),
          marketing_consent: marketingConsent,
        }
        if (event.eventCity) attributes.city = event.eventCity
        if (event.eventCountry || event.eventCountryCode) attributes.country = event.eventCountry || event.eventCountryCode
        if (event.eventCountryCode) attributes.country_code = event.eventCountryCode
        if (event.venueAddress) attributes.address = event.venueAddress
        if (event.eventRegion) attributes.region = event.eventRegion
        if (event.eventContinent) attributes.continent = event.eventContinent
        if (event.eventLocation) attributes.location = event.eventLocation
        if (registration.lumaUserId) attributes.luma_user_id = registration.lumaUserId
        if (registration.gradualUserId) attributes.gradual_user_id = registration.gradualUserId
        if (registration.phone) attributes.phone = registration.phone

        fetch(`https://track.customer.io/api/v1/customers/${encodeURIComponent(email)}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Basic ${btoa(`${customerioSiteId}:${customerioApiKey}`)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, ...attributes }),
        }).catch(error => {
          console.error('Error sending to Customer.io:', error)
        })
      }

      // Create person record
      const temporaryCioId = `email:${email}`
      const marketingConsentValue = registrantMarketingConsent === true
      const personAttributes: Record<string, any> = {
        first_name: firstName || null,
        last_name: lastName || null,
        source: registrationSource,
        marketing_consent: marketingConsentValue,
      }
      if (event.eventCity) personAttributes.city = event.eventCity
      if (event.eventCountry || event.eventCountryCode) personAttributes.country = event.eventCountry || event.eventCountryCode
      if (event.eventCountryCode) personAttributes.country_code = event.eventCountryCode
      if (event.venueAddress) personAttributes.address = event.venueAddress
      if (event.eventRegion) personAttributes.region = event.eventRegion
      if (event.eventContinent) personAttributes.continent = event.eventContinent
      if (event.eventLocation) personAttributes.location = event.eventLocation
      if (registration.lumaUserId) personAttributes.luma_user_id = registration.lumaUserId
      if (registration.gradualUserId) personAttributes.gradual_user_id = registration.gradualUserId
      if (registration.phone) personAttributes.phone = registration.phone

      const { data: newPerson, error: createError } = await supabase
        .from('people')
        .insert({
          cio_id: temporaryCioId,
          email,
          auth_user_id: authUserId,
          attributes: personAttributes,
          last_synced_at: new Date().toISOString(),
        })
        .select('id, cio_id')
        .single()

      if (createError) {
        return { success: false, error: `Failed to create person: ${createError.message}` }
      }
      person = newPerson
    }

    if (!person) {
      return { success: false, error: 'Could not find or create person' }
    }

    // Get or create people profile
    const { data: peopleProfileId, error: profileError } = await supabase
      .rpc('people_get_or_create_profile', {
        p_person_id: person.id,
      })

    if (profileError) {
      return { success: false, error: `Failed to create people profile: ${profileError.message}` }
    }

    // Check if already registered
    const { data: existingReg } = await supabase
      .from('events_registrations')
      .select('id, ticket_type, amount_paid, registration_metadata, registration_source')
      .eq('event_id', event.eventId)
      .eq('person_id', person.id)
      .maybeSingle()

    // Calculate amount - support both cents (webhook) and dollars (CSV)
    const amountInDollars = registration.amountInDollars ??
      (registration.ticketAmount ? registration.ticketAmount / 100 : null)

    if (existingReg) {
      // If new data source has richer data, update the registration
      const updates: Record<string, any> = {}

      // Update ticket_type if we have it and it's missing
      if (registration.ticketType && !existingReg.ticket_type) {
        updates.ticket_type = registration.ticketType
      }

      // Update amount_paid if we have it and it's missing or zero
      if (amountInDollars && (!existingReg.amount_paid || existingReg.amount_paid === 0)) {
        updates.amount_paid = amountInDollars
        updates.registration_type = amountInDollars > 0 ? 'paid' : 'free'
        updates.payment_status = amountInDollars > 0 ? 'paid' : 'waived'
      }

      // Update currency if provided
      if (registration.currency) {
        updates.currency = registration.currency
      }

      // Merge registration metadata (luma_guest_id, registration_answers, survey_responses, etc.)
      const existingMetadata = existingReg.registration_metadata as Record<string, any> || {}
      const newMetadata: Record<string, any> = { ...existingMetadata }
      let metadataUpdated = false

      if (registration.lumaGuestId && !existingMetadata.luma_guest_id) {
        newMetadata.luma_guest_id = registration.lumaGuestId
        metadataUpdated = true
      }
      if (registration.registrationAnswers?.length && !existingMetadata.registration_answers) {
        newMetadata.registration_answers = registration.registrationAnswers
        metadataUpdated = true
      }
      // CSV survey responses format
      if (registration.surveyResponses && Object.keys(registration.surveyResponses).length > 0 && !existingMetadata.luma_survey_responses) {
        newMetadata.luma_survey_responses = registration.surveyResponses
        metadataUpdated = true
      }
      if (metadataUpdated) {
        updates.registration_metadata = newMetadata
      }

      // Track source enrichment
      const currentSource = existingReg.registration_source
      const newSource = registration.source || 'luma_webhook'
      if (Object.keys(updates).length > 0 && currentSource && currentSource !== newSource) {
        // Append the new source to track enrichment history
        if (!currentSource.includes(newSource)) {
          updates.registration_source = `${currentSource}+${newSource.replace('luma_', '')}`
        }
      }

      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await supabase
          .from('events_registrations')
          .update(updates)
          .eq('id', existingReg.id)

        console.log(`Enriched existing registration ${existingReg.id} with data:`, Object.keys(updates))

        // Apply configured field mappings (non-blocking)
        supabase.rpc('apply_registration_mappings', {
          p_event_id: event.eventId,
          p_registration_ids: [existingReg.id],
        }).then(({ error: mappingError }) => {
          if (mappingError) console.error('Failed to apply field mappings:', mappingError.message)
          else console.log(`Applied field mappings for registration ${existingReg.id}`)
        })

        return {
          success: true,
          personId: person.id,
          peopleProfileId,
          registrationId: existingReg.id,
          action: 'updated',
        }
      }

      return {
        success: true,
        personId: person.id,
        peopleProfileId,
        registrationId: existingReg.id,
        action: 'already_exists',
      }
    }

    // Determine registration type and payment status
    const isPaid = amountInDollars && amountInDollars > 0
    const registrationType = isPaid ? 'paid' : 'free'
    const paymentStatus = isPaid ? 'paid' : 'waived'
    const status = registration.approvalStatus
      ? mapApprovalStatus(registration.approvalStatus)
      : 'confirmed'
    const registrationSource = registration.source || 'luma_webhook'

    // Build registration metadata
    const registrationMetadata: Record<string, any> = {}
    if (registration.lumaGuestId) registrationMetadata.luma_guest_id = registration.lumaGuestId
    if (registration.registrationAnswers?.length) {
      registrationMetadata.registration_answers = registration.registrationAnswers
    }
    // CSV survey responses format
    if (registration.surveyResponses && Object.keys(registration.surveyResponses).length > 0) {
      registrationMetadata.luma_survey_responses = registration.surveyResponses
    }
    // Tracking session ID from Luma custom_source for conversion attribution
    if (registration.trackingSessionId) {
      registrationMetadata.tracking_session_id = registration.trackingSessionId
    }

    // Create event registration
    const { data: newRegistration, error: regError } = await supabase
      .from('events_registrations')
      .insert({
        event_id: event.eventId,
        person_id: person.id,
        people_profile_id: peopleProfileId,
        registration_type: registrationType,
        registration_source: registrationSource,
        payment_status: paymentStatus,
        status,
        ticket_type: registration.ticketType || null,
        amount_paid: amountInDollars,
        currency: registration.currency || 'USD',
        registration_metadata: Object.keys(registrationMetadata).length > 0 ? registrationMetadata : {},
        registered_at: registration.registeredAt || new Date().toISOString(),
      })
      .select('id')
      .single()

    if (regError) {
      // Handle race condition: if another process already created this registration,
      // fetch the existing one and return success (treat as already_exists)
      if (regError.message?.includes('duplicate key') || regError.code === '23505') {
        const { data: existingAfterRace } = await supabase
          .from('events_registrations')
          .select('id')
          .eq('event_id', event.eventId)
          .eq('person_id', person.id)
          .maybeSingle()

        if (existingAfterRace) {
          console.log(`Registration already created by concurrent process: ${existingAfterRace.id}`)
          return {
            success: true,
            personId: person.id,
            peopleProfileId,
            registrationId: existingAfterRace.id,
            action: 'already_exists',
          }
        }
      }
      return { success: false, error: `Failed to create registration: ${regError.message}` }
    }

    // Apply configured field mappings (non-blocking)
    supabase.rpc('apply_registration_mappings', {
      p_event_id: event.eventId,
      p_registration_ids: [newRegistration.id],
    }).then(({ error: mappingError }) => {
      if (mappingError) console.error('Failed to apply field mappings:', mappingError.message)
      else console.log(`Applied field mappings for registration ${newRegistration.id}`)
    })

    // Notify integration modules about the new registration (fire-and-forget)
    emitIntegrationEvent(supabase, 'event.registered', {
      email,
      first_name: firstName,
      last_name: lastName,
      event_id: event.eventId,
      registration_id: newRegistration.id,
    })

    return {
      success: true,
      personId: person.id,
      peopleProfileId,
      registrationId: newRegistration.id,
      action: 'created',
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Unknown error' }
  }
}

/**
 * Cancel a registration by email and event ID
 */
export async function cancelRegistration(
  supabase: SupabaseClient,
  email: string,
  eventId: string
): Promise<CancellationResult> {
  try {
    const { data: person } = await supabase
      .from('people')
      .select('id')
      .ilike('email', email)
      .maybeSingle()

    if (!person) {
      return { success: false, error: `No person found with email: ${email}` }
    }

    const { data: registration } = await supabase
      .from('events_registrations')
      .select('id, status')
      .eq('event_id', eventId)
      .eq('person_id', person.id)
      .maybeSingle()

    if (!registration) {
      return { success: false, error: `No registration found for ${email} at event ${eventId}` }
    }

    const { error: updateError } = await supabase
      .from('events_registrations')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', registration.id)

    if (updateError) {
      return { success: false, error: `Failed to cancel registration: ${updateError.message}` }
    }

    return {
      success: true,
      registrationId: registration.id,
      previousStatus: registration.status,
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Unknown error' }
  }
}

/**
 * Update a registration status (e.g., from pending to confirmed, or to waitlist)
 */
export async function updateRegistrationStatus(
  supabase: SupabaseClient,
  email: string,
  eventId: string,
  newStatus: 'pending' | 'confirmed' | 'cancelled' | 'waitlist'
): Promise<{ success: boolean; error?: string; registrationId?: string; previousStatus?: string }> {
  try {
    const { data: person } = await supabase
      .from('people')
      .select('id')
      .ilike('email', email)
      .maybeSingle()

    if (!person) {
      return { success: false, error: `No person found with email: ${email}` }
    }

    const { data: registration } = await supabase
      .from('events_registrations')
      .select('id, status')
      .eq('event_id', eventId)
      .eq('person_id', person.id)
      .maybeSingle()

    if (!registration) {
      return { success: false, error: `No registration found for ${email} at event ${eventId}` }
    }

    const updateData: Record<string, any> = { status: newStatus }
    if (newStatus === 'cancelled') {
      updateData.cancelled_at = new Date().toISOString()
    }

    const { error: updateError } = await supabase
      .from('events_registrations')
      .update(updateData)
      .eq('id', registration.id)

    if (updateError) {
      return { success: false, error: `Failed to update registration: ${updateError.message}` }
    }

    return {
      success: true,
      registrationId: registration.id,
      previousStatus: registration.status,
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Unknown error' }
  }
}
