import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { syncRegistrantToCvent } from './cventApi.ts'

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
  ticketQuantity?: number // Number of tickets purchased (default 1)
  ticketAmount?: number // in cents for webhook, dollars for CSV (use amountInDollars for CSV)
  amountInDollars?: number // direct dollar amount (for CSV import)
  currency?: string
  approvalStatus?: string
  registrationAnswers?: Record<string, any>[] // webhook format
  surveyResponses?: Record<string, any> // CSV format (key-value pairs)
  registeredAt?: string
  externalQrCode?: string // Luma QR code URL for check-in
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
  // Cvent integration (set when event has cvent_sync_enabled = true)
  cventEventId?: string | null
  cventAdmissionItemId?: string | null
}

export interface RegistrationResult {
  success: boolean
  error?: string
  customerId?: number
  memberProfileId?: string
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
 * Create a full registration including auth user, customer, member profile, and event registration
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

    // Check if customer already exists
    let customer: { id: number; cio_id: string } | null = null
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id, cio_id, attributes')
      .ilike('email', email)
      .maybeSingle()

    if (existingCustomer) {
      customer = existingCustomer

      // Update customer attributes if we have new data
      const attrs = existingCustomer.attributes as Record<string, any> || {}
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
          .from('customers')
          .update({ attributes: { ...attrs, ...updates } })
          .eq('id', existingCustomer.id)
        console.log(`Updated existing customer ${existingCustomer.id} with new attributes`)
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

      // Create customer record
      const temporaryCioId = `email:${email}`
      const marketingConsentValue = registrantMarketingConsent === true
      const customerAttributes: Record<string, any> = {
        first_name: firstName || null,
        last_name: lastName || null,
        source: registrationSource,
        marketing_consent: marketingConsentValue,
      }
      if (event.eventCity) customerAttributes.city = event.eventCity
      if (event.eventCountry || event.eventCountryCode) customerAttributes.country = event.eventCountry || event.eventCountryCode
      if (event.eventCountryCode) customerAttributes.country_code = event.eventCountryCode
      if (event.venueAddress) customerAttributes.address = event.venueAddress
      if (event.eventRegion) customerAttributes.region = event.eventRegion
      if (event.eventContinent) customerAttributes.continent = event.eventContinent
      if (event.eventLocation) customerAttributes.location = event.eventLocation
      if (registration.lumaUserId) customerAttributes.luma_user_id = registration.lumaUserId
      if (registration.gradualUserId) customerAttributes.gradual_user_id = registration.gradualUserId
      if (registration.phone) customerAttributes.phone = registration.phone

      const { data: newCustomer, error: createError } = await supabase
        .from('customers')
        .insert({
          cio_id: temporaryCioId,
          email,
          auth_user_id: authUserId,
          attributes: customerAttributes,
          last_synced_at: new Date().toISOString(),
        })
        .select('id, cio_id')
        .single()

      if (createError) {
        return { success: false, error: `Failed to create customer: ${createError.message}` }
      }
      customer = newCustomer
    }

    if (!customer) {
      return { success: false, error: 'Could not find or create customer' }
    }

    // Get or create member profile
    const { data: memberProfileId, error: memberError } = await supabase
      .rpc('get_or_create_member_from_customer', {
        p_customer_id: customer.id,
      })

    if (memberError) {
      return { success: false, error: `Failed to create member profile: ${memberError.message}` }
    }

    // Update member profile with phone if we have it
    if (registration.phone) {
      await supabase
        .from('member_profiles')
        .update({ phone: registration.phone })
        .eq('id', memberProfileId)
        .is('phone', null)
    }

    // Check if already registered
    const { data: existingReg } = await supabase
      .from('event_registrations')
      .select('id, ticket_type, ticket_quantity, amount_paid, registration_metadata, registration_source, external_qr_code, sponsor_permission')
      .eq('event_id', event.eventId)
      .eq('member_profile_id', memberProfileId)
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

      // Update ticket_quantity if we have a multi-ticket purchase
      if (registration.ticketQuantity && registration.ticketQuantity > 1 && (!existingReg.ticket_quantity || existingReg.ticket_quantity === 1)) {
        updates.ticket_quantity = registration.ticketQuantity
      }

      // Update amount_paid if we have it and it's missing or zero
      if (amountInDollars && (!existingReg.amount_paid || existingReg.amount_paid === 0)) {
        updates.amount_paid = amountInDollars
        updates.registration_type = amountInDollars > 0 ? 'paid' : 'free'
        updates.payment_status = amountInDollars > 0 ? 'paid' : 'comp'
      }

      // Update currency if provided
      if (registration.currency) {
        updates.currency = registration.currency
      }

      // Update external QR code if provided and missing
      if (registration.externalQrCode && !existingReg.external_qr_code) {
        updates.external_qr_code = registration.externalQrCode
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
          .from('event_registrations')
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
          customerId: customer.id,
          memberProfileId,
          registrationId: existingReg.id,
          action: 'updated',
        }
      }

      return {
        success: true,
        customerId: customer.id,
        memberProfileId,
        registrationId: existingReg.id,
        action: 'already_exists',
      }
    }

    // Determine registration type and payment status
    const isPaid = amountInDollars && amountInDollars > 0
    const registrationType = isPaid ? 'paid' : 'free'
    const paymentStatus = isPaid ? 'paid' : 'comp'
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
      .from('event_registrations')
      .insert({
        event_id: event.eventId,
        member_profile_id: memberProfileId,
        registration_type: registrationType,
        registration_source: registrationSource,
        payment_status: paymentStatus,
        status,
        ticket_type: registration.ticketType || null,
        ticket_quantity: registration.ticketQuantity || 1,
        amount_paid: amountInDollars,
        currency: registration.currency || 'USD',
        external_qr_code: registration.externalQrCode || null,
        registration_metadata: Object.keys(registrationMetadata).length > 0 ? registrationMetadata : {},
        registered_at: registration.registeredAt || new Date().toISOString(),
        sponsor_permission: null,
      })
      .select('id')
      .single()

    if (regError) {
      // Handle race condition: if another process already created this registration,
      // fetch the existing one and return success (treat as already_exists)
      if (regError.message?.includes('duplicate key') || regError.code === '23505') {
        const { data: existingAfterRace } = await supabase
          .from('event_registrations')
          .select('id')
          .eq('event_id', event.eventId)
          .eq('member_profile_id', memberProfileId)
          .maybeSingle()

        if (existingAfterRace) {
          console.log(`Registration already created by concurrent process: ${existingAfterRace.id}`)
          return {
            success: true,
            customerId: customer.id,
            memberProfileId,
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

    // Sync to Cvent if configured (non-blocking, fire-and-forget)
    if (event.cventEventId && event.cventAdmissionItemId) {
      const cventClientId = Deno.env.get('CVENT_CLIENT_ID')
      const cventClientSecret = Deno.env.get('CVENT_CLIENT_SECRET')
      if (cventClientId && cventClientSecret) {
        syncRegistrantToCvent(
          cventClientId,
          cventClientSecret,
          event.cventEventId,
          event.cventAdmissionItemId,
          email,
          firstName,
          lastName
        ).then(result => {
          if (result.success) {
            console.log(`Cvent sync OK for ${email}: ${result.action}`)
          } else {
            console.error(`Cvent sync failed for ${email}: ${result.error}`)
          }
        }).catch(err => {
          console.error('Cvent sync error:', err)
        })
      }
    }

    return {
      success: true,
      customerId: customer.id,
      memberProfileId,
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
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .ilike('email', email)
      .maybeSingle()

    if (!customer) {
      return { success: false, error: `No customer found with email: ${email}` }
    }

    const { data: memberProfile } = await supabase
      .from('member_profiles')
      .select('id')
      .eq('customer_id', customer.id)
      .maybeSingle()

    if (!memberProfile) {
      return { success: false, error: `No member profile found for customer: ${email}` }
    }

    const { data: registration } = await supabase
      .from('event_registrations')
      .select('id, status')
      .eq('event_id', eventId)
      .eq('member_profile_id', memberProfile.id)
      .maybeSingle()

    if (!registration) {
      return { success: false, error: `No registration found for ${email} at event ${eventId}` }
    }

    const { error: updateError } = await supabase
      .from('event_registrations')
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
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .ilike('email', email)
      .maybeSingle()

    if (!customer) {
      return { success: false, error: `No customer found with email: ${email}` }
    }

    const { data: memberProfile } = await supabase
      .from('member_profiles')
      .select('id')
      .eq('customer_id', customer.id)
      .maybeSingle()

    if (!memberProfile) {
      return { success: false, error: `No member profile found for customer: ${email}` }
    }

    const { data: registration } = await supabase
      .from('event_registrations')
      .select('id, status')
      .eq('event_id', eventId)
      .eq('member_profile_id', memberProfile.id)
      .maybeSingle()

    if (!registration) {
      return { success: false, error: `No registration found for ${email} at event ${eventId}` }
    }

    const updateData: Record<string, any> = { status: newStatus }
    if (newStatus === 'cancelled') {
      updateData.cancelled_at = new Date().toISOString()
    }

    const { error: updateError } = await supabase
      .from('event_registrations')
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
