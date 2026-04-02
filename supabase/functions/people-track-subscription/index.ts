import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { emitIntegrationEvent } from '../_shared/integrationEvents.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TrackSubscriptionRequest {
  email: string
  list_id: string
  subscribed: boolean
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
    const body: TrackSubscriptionRequest = await req.json()
    const { email, list_id, subscribed, source } = body

    // Validate required fields
    if (!email || !list_id || subscribed === undefined) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required fields: email, list_id, and subscribed are required'
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

    console.log(`📧 Tracking subscription: ${normalizedEmail} -> ${list_id} = ${subscribed}`)

    // Look up customer_id by email for proper relational integrity
    const { data: person, error: personLookupError } = await supabaseClient
      .from('people')
      .select('id')
      .ilike('email', normalizedEmail)
      .maybeSingle()

    if (personLookupError) {
      console.warn(`⚠️ Person lookup error for ${normalizedEmail}:`, personLookupError.message)
    }

    const personId = person?.id
    // Use customer_id,list_id constraint if we found the person, otherwise fall back to email,list_id
    const onConflict = personId ? 'customer_id,list_id' : 'email,list_id'

    console.log(`   Person ID: ${personId || 'not found'}, using onConflict: ${onConflict}`)

    // Write to Supabase (source of truth)
    const { data, error } = await supabaseClient
      .from('email_subscriptions')
      .upsert({
        customer_id: personId || null,
        email: normalizedEmail,
        list_id,
        subscribed,
        subscribed_at: subscribed ? now : null,
        unsubscribed_at: subscribed ? null : now,
        source: source || 'frontend',
        updated_at: now
      }, { onConflict })
      .select()
      .single()

    if (error) {
      console.error('Error upserting subscription:', error)
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`✅ Subscription saved to Supabase: ${data?.id}`)

    // Notify integration modules (e.g. Customer.io) about the subscription change
    emitIntegrationEvent(supabaseClient, 'person.subscribed', {
      email: normalizedEmail,
      list_id,
      subscribed,
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Subscription tracked successfully',
        subscription_id: data?.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in track-subscription function:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to track subscription',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
