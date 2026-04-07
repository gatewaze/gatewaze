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

interface SpeakerSubmissionRequest {
  // Required fields
  email: string
  event_id: string // Can be UUID or short event_id
  talk_title: string
  talk_synopsis: string

  // Person profile fields
  first_name?: string
  last_name?: string
  company?: string
  job_title?: string
  phone?: string
  linkedin_url?: string
  avatar_url?: string // External URL to download avatar from
  company_logo_url?: string // URL to company logo

  // Speaker-specific fields
  speaker_title?: string // Title/role specifically for this speaking engagement
  speaker_bio?: string // Bio specifically for this event
  speaker_topic?: string // Topic area
  talk_duration_minutes?: number // Talk duration in minutes
  initial_status?: string // Optional initial status (defaults to 'pending')

  // Tracking fields
  source?: string
  referrer?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  notes?: string
  metadata?: Record<string, any>
}

interface SpeakerSubmissionResponse {
  success: boolean
  message: string
  speaker_id?: string
  talk_id?: string
  member_profile_id?: string
  person_id?: number
  already_submitted?: boolean
  edit_token?: string  // Talk's token for editing submission without sign-in
  error?: string
}

async function handler(req: Request) {
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
    const body: SpeakerSubmissionRequest = await req.json()
    const {
      email,
      event_id,
      talk_title,
      talk_synopsis,
      first_name,
      last_name,
      company,
      job_title,
      phone,
      linkedin_url,
      avatar_url,
      company_logo_url,
      speaker_title,
      speaker_bio,
      speaker_topic,
      talk_duration_minutes,
      initial_status,
      source,
      referrer,
      utm_source,
      utm_medium,
      utm_campaign,
      notes,
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

    if (!talk_title) {
      return new Response(JSON.stringify({ success: false, error: 'Talk title is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!talk_synopsis) {
      return new Response(JSON.stringify({ success: false, error: 'Talk synopsis is required' }), {
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
    console.log(`📝 Processing speaker submission for: ${normalizedEmail}, event: ${event_id}`)

    // Step 1: Verify event exists and check if call-for-speakers is enabled
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    let eventQuery = supabase.from('events').select('id, event_id, event_title, enable_call_for_speakers')

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

    // Check if call-for-speakers is enabled for this event
    if (eventRecord.enable_call_for_speakers === false) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Call for speakers is not enabled for this event'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const eventUuid = eventRecord.id
    console.log(`✅ Event verified: ${eventRecord.event_title} (${eventRecord.event_id})`)

    // Step 2: Find or create person
    const personResult = await findOrCreatePerson(normalizedEmail, {
      first_name,
      last_name,
      company,
      job_title,
      phone,
      linkedin_url,
      source: source || 'speaker_submission'
    })

    if (!personResult) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to create or find person record'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`✅ Person: ${personResult.id}`)

    // Step 3: Download and store avatar if provided
    if (avatar_url) {
      await downloadAndStoreAvatar(personResult.id, avatar_url)
    }

    // Step 4: Get or create member profile
    const memberProfile = await getOrCreateMemberProfile(personResult.id)

    if (!memberProfile) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to create member profile'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`✅ Member profile: ${memberProfile.id}`)

    // Step 5: Check if speaker record already exists for this event
    // If so, we reuse it (speaker = identity) and create a new talk
    const { data: existingSpeaker } = await supabase
      .from('events_speakers')
      .select('id')
      .eq('event_uuid', eventUuid)
      .eq('people_profile_id', memberProfile.id)
      .maybeSingle()

    // Valid statuses: pending, approved, confirmed, reserve
    const validStatuses = ['pending', 'approved', 'confirmed', 'reserve']
    const talkStatus = initial_status && validStatuses.includes(initial_status.toLowerCase())
      ? initial_status.toLowerCase()
      : 'pending'

    let speakerId: string

    if (existingSpeaker) {
      // Reuse existing speaker record (identity) for additional talk
      speakerId = existingSpeaker.id
      console.log(`✅ Reusing existing speaker record: ${speakerId}`)

      // Update speaker profile fields if provided (they may have changed)
      const speakerUpdates: Record<string, any> = {}
      if (speaker_title) speakerUpdates.speaker_title = speaker_title
      if (speaker_bio) speakerUpdates.speaker_bio = speaker_bio
      if (speaker_topic) speakerUpdates.speaker_topic = speaker_topic

      if (Object.keys(speakerUpdates).length > 0) {
        await supabase
          .from('events_speakers')
          .update(speakerUpdates)
          .eq('id', speakerId)
      }
    } else {
      // Step 6: Create new speaker record (identity)
      // Extract storage path from company logo URL if provided
      let companyLogoStoragePath: string | null = null
      if (company_logo_url) {
        // Extract the path from the full URL
        // URL format: https://xxx.supabase.co/storage/v1/object/public/speaker-logos/speaker-submissions/xxx.png
        const match = company_logo_url.match(/\/speaker-logos\/(.+)$/)
        if (match) {
          companyLogoStoragePath = match[1]
        }
      }

      const speakerData: Record<string, any> = {
        event_uuid: eventUuid,
        people_profile_id: memberProfile.id,
        // Speaker profile fields only - talk data is stored in event_talks
        speaker_title: speaker_title || null,
        speaker_bio: speaker_bio || null,
        speaker_topic: speaker_topic || null,
        company_logo_storage_path: companyLogoStoragePath,
        sort_order: 0,
        is_featured: false,
      }

      const { data: speaker, error: speakerError } = await supabase
        .from('events_speakers')
        .insert(speakerData)
        .select('id')
        .single()

      if (speakerError) {
        console.error('Error creating speaker:', speakerError)
        return new Response(JSON.stringify({
          success: false,
          error: `Failed to create speaker submission: ${speakerError.message}`
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      speakerId = speaker.id
      console.log(`✅ Speaker record created: ${speakerId}`)
    }

    // Step 6b: Create talk record (content) in event_talks table
    const talkData: Record<string, any> = {
      event_uuid: eventUuid,
      title: talk_title,
      synopsis: talk_synopsis || null,
      duration_minutes: talk_duration_minutes || null,
      session_type: 'talk',  // Default for submissions
      status: talkStatus,
      submitted_at: new Date().toISOString(),
      sort_order: 0,
      is_featured: false,
    }

    const { data: talk, error: talkError } = await supabase
      .from('events_talks')
      .insert(talkData)
      .select('id, edit_token')
      .single()

    if (talkError) {
      console.error('Error creating talk:', talkError)
      // Clean up speaker record only if we just created it (not if reusing existing)
      if (!existingSpeaker) {
        await supabase.from('events_speakers').delete().eq('id', speakerId)
      }
      return new Response(JSON.stringify({
        success: false,
        error: `Failed to create talk submission: ${talkError.message}`
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`✅ Talk record created: ${talk.id}`)

    // Step 6c: Link speaker to talk via event_talk_speakers junction table
    const { error: linkError } = await supabase
      .from('events_talk_speakers')
      .insert({
        talk_id: talk.id,
        speaker_id: speakerId,
        role: 'presenter',
        is_primary: true,
        sort_order: 0,
      })

    if (linkError) {
      console.error('Error linking speaker to talk:', linkError)
      // This is not fatal - the records exist, just not linked
      // Log but continue
    }

    console.log(`✅ Speaker-talk link created`)

    // Step 7: Send automated submission email if enabled
    await sendSpeakerSubmittedEmail(
      eventUuid,
      eventRecord.event_id,
      eventRecord.event_title,
      normalizedEmail,
      first_name || '',
      last_name || '',
      talk_title,
      talk_synopsis,
      company || '',
      job_title || ''
    ).catch(err => console.error('Failed to send speaker submitted email:', err))

    // Step 8: Emit integration event (non-blocking)
    emitIntegrationEvent(supabase, 'event.registered', {
      email: normalizedEmail,
      event_id: eventRecord.event_id,
      event_title: eventRecord.event_title,
      talk_title,
      source: source || utm_source || 'direct',
    })

    const response: SpeakerSubmissionResponse = {
      success: true,
      message: 'Speaker submission received successfully. Your application is pending review.',
      speaker_id: speakerId,
      talk_id: talk.id,
      member_profile_id: memberProfile.id,
      person_id: personResult.id,
      already_submitted: false,
      edit_token: talk.edit_token  // Talk's edit token for self-editing without sign-in
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('❌ Speaker submission error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}

export default handler
Deno.serve(handler)

/**
 * Find existing person or create new one
 */
async function findOrCreatePerson(
  email: string,
  attributes: Record<string, any>
): Promise<{ id: number; cio_id: string } | null> {
  try {
    // Check if person already exists
    const { data: existingPerson } = await supabase
      .from('people')
      .select('id, cio_id')
      .ilike('email', email)
      .maybeSingle()

    if (existingPerson) {
      console.log('Person exists:', existingPerson.id)

      // Update local person attributes if we have new data
      const updateAttrs: Record<string, any> = {}
      if (attributes.first_name) updateAttrs.first_name = attributes.first_name
      if (attributes.last_name) updateAttrs.last_name = attributes.last_name
      if (attributes.company) updateAttrs.company = attributes.company
      if (attributes.job_title) updateAttrs.job_title = attributes.job_title
      if (attributes.phone) updateAttrs.phone = attributes.phone
      if (attributes.linkedin_url) updateAttrs.linkedin_url = attributes.linkedin_url

      if (Object.keys(updateAttrs).length > 0) {
        await supabase
          .from('people')
          .update({ attributes: updateAttrs })
          .eq('id', existingPerson.id)

        // Notify integration modules about the attribute update
        emitIntegrationEvent(supabase, 'person.updated', { email, attributes: updateAttrs })
      }

      return existingPerson
    }

    console.log('Creating new person:', email)

    // Use temporary cio_id based on email
    // The real cio_id will be updated when CIO sends a webhook after indexing
    const cioId = `email:${email.toLowerCase()}`

    // Create auth user
    let authUserId: string | null = null
    try {
      const { data: newAuthUser, error: createError } = await supabase.auth.admin.createUser({
        email: email,
        email_confirm: false,
      })

      if (createError) {
        console.error('Failed to create auth user:', createError)
      } else if (newAuthUser.user) {
        authUserId = newAuthUser.user.id
        console.log('Created auth user:', authUserId)
      }
    } catch (error) {
      console.error('Error creating auth user:', error)
    }

    // Create person record in Supabase
    const personAttributes: Record<string, any> = {}
    if (attributes.first_name) personAttributes.first_name = attributes.first_name
    if (attributes.last_name) personAttributes.last_name = attributes.last_name
    if (attributes.company) personAttributes.company = attributes.company
    if (attributes.job_title) personAttributes.job_title = attributes.job_title
    if (attributes.phone) personAttributes.phone = attributes.phone
    if (attributes.linkedin_url) personAttributes.linkedin_url = attributes.linkedin_url

    const { data: newPerson, error: insertError } = await supabase
      .from('people')
      .insert({
        cio_id: cioId,
        email: email,
        auth_user_id: authUserId,
        attributes: personAttributes,
        last_synced_at: new Date().toISOString()
      })
      .select('id, cio_id')
      .single()

    if (insertError) {
      console.error('Error creating person:', insertError)
      return null
    }

    console.log('Person created in Supabase:', newPerson.id)

    // Notify integration modules about the new person
    emitIntegrationEvent(supabase, 'person.created', { email, attributes: personAttributes })

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
 * Download avatar from URL and store it for person
 */
async function downloadAndStoreAvatar(personId: number, imageUrl: string): Promise<boolean> {
  try {
    console.log(`Downloading avatar from: ${imageUrl}`)

    // Fetch image
    const response = await fetch(imageUrl)
    if (!response.ok) {
      console.error(`Failed to fetch avatar: ${response.statusText}`)
      return false
    }

    // Get blob
    const blob = await response.blob()

    // Validate size (5MB max)
    if (blob.size > 5 * 1024 * 1024) {
      console.error('Avatar too large (>5MB)')
      return false
    }

    // Validate type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(blob.type)) {
      console.error(`Invalid avatar type: ${blob.type}`)
      return false
    }

    // Generate filename
    const fileExt = blob.type.split('/')[1]
    const fileName = `${personId}-uploaded-${Date.now()}.${fileExt}`
    const filePath = `people/${fileName}`

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(filePath, blob, {
        contentType: blob.type,
        cacheControl: '3600',
        upsert: false
      })

    if (uploadError) {
      console.error('Failed to upload avatar:', uploadError)
      return false
    }

    // Update person record using RPC
    const { error: updateError } = await supabase.rpc('people_update_avatar', {
      p_person_id: personId,
      p_avatar_source: 'uploaded',
      p_storage_path: filePath,
      p_linkedin_url: null
    })

    if (updateError) {
      console.error('Failed to update person avatar:', updateError)
      // Try to clean up uploaded file
      await supabase.storage.from('media').remove([filePath])
      return false
    }

    console.log(`✅ Avatar stored: ${filePath}`)
    return true

  } catch (error) {
    console.error('Error downloading avatar:', error)
    return false
  }
}

/**
 * Send automated speaker submitted email if enabled
 */
async function sendSpeakerSubmittedEmail(
  eventUuid: string,
  eventId: string,
  eventTitle: string,
  speakerEmail: string,
  firstName: string,
  lastName: string,
  talkTitle: string,
  talkSynopsis: string,
  company: string,
  jobTitle: string
): Promise<void> {
  try {
    // Check if speaker submitted email is enabled for this event
    const { data: settings, error: settingsError } = await supabase
      .from('events_communication_settings')
      .select(`
        speaker_submitted_email_enabled,
        speaker_submitted_email_template_id,
        speaker_submitted_email_from_key,
        speaker_submitted_email_reply_to,
        speaker_submitted_email_cc,
        speaker_submitted_email_subject,
        speaker_submitted_email_content
      `)
      .eq('event_id', eventId)
      .maybeSingle()

    if (settingsError) {
      console.error('Error fetching communication settings:', settingsError)
      return
    }

    if (!settings || !settings.speaker_submitted_email_enabled) {
      console.log('Speaker submitted email is disabled for this event')
      return
    }

    // Get subject and content - prefer inline content, fall back to template
    let emailSubject: string | null = null
    let emailContent: string | null = null

    if (settings.speaker_submitted_email_subject && settings.speaker_submitted_email_content) {
      // Use inline content (Start from Scratch)
      emailSubject = settings.speaker_submitted_email_subject
      emailContent = settings.speaker_submitted_email_content
    } else if (settings.speaker_submitted_email_template_id) {
      // Get the email template
      const { data: template, error: templateError } = await supabase
        .from('email_templates')
        .select('subject, content_html')
        .eq('id', settings.speaker_submitted_email_template_id)
        .single()

      if (templateError || !template) {
        console.error('Error fetching email template:', templateError)
        return
      }
      emailSubject = template.subject
      emailContent = template.content_html
    } else {
      console.log('No template or inline content configured for speaker submitted email')
      return
    }

    // Get event details for template variables
    const { data: eventDetails } = await supabase
      .from('events')
      .select('event_title, event_slug, event_city, event_country_code, event_start, event_end')
      .eq('id', eventUuid)
      .single()

    // Replace template variables
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || speakerEmail
    const context: Record<string, Record<string, string>> = {
      customer: {
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        email: speakerEmail,
      },
      speaker: {
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        email: speakerEmail,
        talk_title: talkTitle,
        talk_synopsis: talkSynopsis,
        company: company,
        job_title: jobTitle,
      },
      event: {
        name: eventDetails?.event_title || eventTitle,
        slug: eventDetails?.event_slug || '',
        id: eventId, // Short 6-character event ID
        city: eventDetails?.event_city || '',
        country: eventDetails?.event_country_code || '',
        start_date: eventDetails?.event_start ? new Date(eventDetails.event_start).toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) : '',
        end_date: eventDetails?.event_end ? new Date(eventDetails.event_end).toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) : '',
      },
    }

    const processedSubject = replaceTemplateVariables(emailSubject!, context)
    const processedHtml = replaceTemplateVariables(emailContent!, context)

    // Get from address based on key
    const fromAddresses: Record<string, string> = {
      default: Deno.env.get('SENDGRID_FROM_DEFAULT') || '',
      partners: Deno.env.get('SENDGRID_FROM_PARTNERS') || '',
      admin: Deno.env.get('SENDGRID_FROM_ADMIN') || '',
      members: Deno.env.get('SENDGRID_FROM_MEMBERS') || '',
      events: Deno.env.get('SENDGRID_FROM_EVENTS') || '',
    }

    const fromKey = settings.speaker_submitted_email_from_key || 'events'
    const fromAddress = fromAddresses[fromKey] || fromAddresses.events

    if (!fromAddress) {
      console.error('No from address configured')
      return
    }

    // Parse the from address (format: "Name - email@example.com")
    const fromParts = fromAddress.split(' - ')
    const fromEmail = fromParts.length === 2 ? fromParts[1].trim() : fromAddress.trim()
    const fromName = fromParts.length === 2 ? fromParts[0].trim() : undefined

    // Send the email via the send-email edge function (handles logging)
    const { error: sendError } = await supabase.functions.invoke('email-send', {
      body: {
        to: speakerEmail,
        cc: settings.speaker_submitted_email_cc || undefined,
        from: fromEmail,
        fromName: fromName,
        subject: processedSubject,
        html: processedHtml,
        replyTo: settings.speaker_submitted_email_reply_to || undefined,
      }
    })

    if (sendError) {
      console.error('Error sending email via send-email function:', sendError)
      return
    }

    console.log(`✅ Speaker submitted email sent to ${speakerEmail}`)

    // Increment template usage (simple increment)
    const { data: currentTemplate } = await supabase
      .from('email_templates')
      .select('times_used')
      .eq('id', settings.speaker_submitted_email_template_id)
      .single()

    if (currentTemplate) {
      await supabase
        .from('email_templates')
        .update({ times_used: (currentTemplate.times_used || 0) + 1 })
        .eq('id', settings.speaker_submitted_email_template_id)
    }

  } catch (error) {
    console.error('Error sending speaker submitted email:', error)
  }
}

/**
 * Replace template variables in a string
 * Supports filters like: {{scope.field | default:"fallback"}}
 */
function replaceTemplateVariables(template: string, context: Record<string, Record<string, string>>): string {
  // Match variables with optional filters: {{scope.field}} or {{scope.field | filter:"value"}}
  const variableRegex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*((?:\|\s*[a-zA-Z_][a-zA-Z0-9_]*(?::"[^"]*")?\s*)*)\}\}/g

  return template.replace(variableRegex, (_match, scope, field, filtersStr) => {
    // Get the value from context
    let value = context[scope]?.[field] || ''

    // Parse and apply filters
    if (filtersStr) {
      const filterMatches = filtersStr.matchAll(/\|\s*([a-zA-Z_][a-zA-Z0-9_]*)(?::"([^"]*)")?/g)
      for (const fm of filterMatches) {
        const filterName = fm[1]
        const filterValue = fm[2]

        switch (filterName) {
          case 'default':
            if (!value || value.trim() === '') {
              value = filterValue || ''
            }
            break
          case 'uppercase':
            value = value.toUpperCase()
            break
          case 'lowercase':
            value = value.toLowerCase()
            break
          case 'capitalize':
            value = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
            break
          // Add more filters as needed
        }
      }
    }

    return value
  })
}
