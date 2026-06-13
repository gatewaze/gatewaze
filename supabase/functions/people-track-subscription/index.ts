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

    console.log(`   Person ID: ${personId || 'not found'}`)

    // Resolve the list. Callers may pass either a list UUID (e.g. from the
    // portal) or a human-friendly list slug (e.g. 'user-community' from the
    // onboarding frontend). When it isn't a UUID, look the list up by slug and
    // store its canonical id so all subscription rows for a list share one
    // list_id. Unknown slugs fall through to the raw value (logged), so a typo
    // never silently drops the subscription.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(list_id)
    let resolvedListId = list_id
    if (!isUuid) {
      const { data: list, error: listLookupError } = await supabaseClient
        .from('lists')
        .select('id')
        .eq('slug', list_id)
        .maybeSingle()

      if (listLookupError) {
        console.warn(`⚠️ List lookup error for slug '${list_id}':`, listLookupError.message)
      }

      if (list?.id) {
        resolvedListId = list.id
        console.log(`   Resolved list slug '${list_id}' -> ${resolvedListId}`)
      } else {
        console.warn(`⚠️ No list found for slug '${list_id}' — storing raw value`)
      }
    }

    // Write to Supabase (source of truth)
    const { data, error } = await supabaseClient
      .from('list_subscriptions')
      .upsert({
        person_id: personId || null,
        email: normalizedEmail,
        list_id: resolvedListId,
        subscribed,
        subscribed_at: subscribed ? now : null,
        unsubscribed_at: subscribed ? null : now,
        source: source || 'frontend',
        updated_at: now
      }, { onConflict: 'list_id,email' })
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
      list_id: resolvedListId,
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
}

export default handler;
Deno.serve(handler);
