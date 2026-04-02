import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { emitIntegrationEvent } from '../_shared/integrationEvents.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TrackPersonAttributeRequest {
  email: string
  attributes: Record<string, any>
  source?: string
}

Deno.serve(async (req) => {
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
    const body: TrackPersonAttributeRequest = await req.json()
    const { email, attributes, source } = body

    // Validate required fields
    if (!email || !attributes || Object.keys(attributes).length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required fields: email and attributes are required'
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
    const now = new Date().toISOString()

    console.log(`📝 Tracking person attributes: ${normalizedEmail}`)
    console.log(`   Attributes: ${JSON.stringify(attributes)}`)

    // Look up existing person by email
    const { data: existingPerson, error: lookupError } = await supabaseClient
      .from('people')
      .select('id, cio_id, email, attributes')
      .ilike('email', normalizedEmail)
      .maybeSingle()

    if (lookupError) {
      console.error('Error looking up person:', lookupError)
      return new Response(
        JSON.stringify({
          success: false,
          error: lookupError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let personId: number | null = null

    if (existingPerson) {
      // Merge new attributes with existing ones (new values take precedence)
      const mergedAttributes = {
        ...existingPerson.attributes,
        ...attributes
      }

      const { error: updateError } = await supabaseClient
        .from('people')
        .update({
          attributes: mergedAttributes,
          last_synced_at: now
        })
        .eq('id', existingPerson.id)

      if (updateError) {
        console.error('Error updating person:', updateError)
        return new Response(
          JSON.stringify({
            success: false,
            error: updateError.message
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      personId = existingPerson.id
      console.log(`✅ Updated person ${personId} attributes`)
    } else {
      // Person doesn't exist - create them
      const { data: newPerson, error: insertError } = await supabaseClient
        .from('people')
        .insert({
          cio_id: `email:${normalizedEmail}`, // Temporary cio_id until CIO assigns one
          email: normalizedEmail,
          attributes: attributes,
          last_synced_at: now
        })
        .select('id')
        .single()

      if (insertError) {
        console.error('Error creating person:', insertError)
        return new Response(
          JSON.stringify({
            success: false,
            error: insertError.message
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      personId = newPerson?.id
      console.log(`✅ Created new person ${personId}`)
    }

    // Notify integration modules (e.g. Customer.io) about the attribute change
    emitIntegrationEvent(supabaseClient, 'person.updated', {
      email: normalizedEmail,
      attributes,
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Person attributes tracked successfully',
        person_id: personId,
        attributes_updated: Object.keys(attributes)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in track-person-attribute function:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to track person attributes',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
