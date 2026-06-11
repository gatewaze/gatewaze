import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { emitIntegrationEvent } from '../_shared/integrationEvents.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TrackEventRequest {
  email: string
  type?: string                    // legacy: always 'track' — accepted but not required
  event: string                    // event name
  properties?: Record<string, any> // event payload
  timestamp?: string               // ISO timestamp of when the event occurred
  source?: string
}

async function handler(req: Request) {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Only accept POST requests
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const body: TrackEventRequest = await req.json()
    const { email, event, properties, timestamp, source } = body

    // Validate required fields
    if (!email || !event) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required fields: email and event are required'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client with service role key for full access
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const normalizedEmail = email.toLowerCase().trim()
    const eventData = properties ?? {}

    // Resolve occurred_at from the optional client timestamp
    let occurredAt = new Date().toISOString()
    if (timestamp) {
      const parsed = new Date(timestamp)
      if (isNaN(parsed.getTime())) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid timestamp format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      occurredAt = parsed.toISOString()
    }

    console.log(`📊 Tracking person event: ${normalizedEmail} -> ${event}`)

    // Look up the person by email so we can link the event. The person may not
    // exist yet (e.g. an event fired before profile creation) — we still record
    // the event by email with a null person_id rather than dropping it.
    const { data: person, error: lookupError } = await supabaseClient
      .from('people')
      .select('id')
      .ilike('email', normalizedEmail)
      .maybeSingle()

    if (lookupError) {
      console.error('Error looking up person:', lookupError)
    }

    const { data: inserted, error: insertError } = await supabaseClient
      .from('people_events')
      .insert({
        person_id: person?.id ?? null,
        email: normalizedEmail,
        event_name: event,
        event_data: eventData,
        source: source ?? 'frontend',
        occurred_at: occurredAt,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('Error inserting person event:', insertError)
      return new Response(
        JSON.stringify({
          success: false,
          error: insertError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Notify integration modules (e.g. Customer.io) about the event.
    emitIntegrationEvent(supabaseClient, 'event.tracked', {
      email: normalizedEmail,
      event_name: event,
      properties: eventData,
      occurred_at: occurredAt,
      source: source ?? 'frontend',
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Person event tracked successfully',
        event_id: inserted?.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in people-track-event function:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to track person event',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
}

export default handler;
Deno.serve(handler);
