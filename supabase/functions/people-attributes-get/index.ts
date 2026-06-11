import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GetAttributesRequest {
  email: string
}

/**
 * Read a person's stored attributes by email.
 *
 * Replaces the read side of the legacy `user-warehouse` GET. Lets the frontend
 * prefill a returning person's profile without running enrichment. Segments are
 * no longer sourced from a third party — callers derive them client-side — so an
 * empty `segments` array is returned for response-shape compatibility.
 *
 * Auth: relies on the gateway (verify_jwt = true) — callers pass the project
 * anon key. Reads are performed with the service role so RLS doesn't block the
 * lookup, mirroring the other people-* functions.
 */
async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body: GetAttributesRequest = await req.json()
    const { email } = body

    if (!email) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required field: email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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

    const { data: person, error: lookupError } = await supabaseClient
      .from('people')
      .select('id, email, attributes')
      .ilike('email', normalizedEmail)
      .maybeSingle()

    if (lookupError) {
      console.error('Error looking up person:', lookupError)
      return new Response(
        JSON.stringify({ success: false, error: lookupError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!person) {
      return new Response(
        JSON.stringify({ error: 'No data found for the given email' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        email: person.email,
        person_id: person.id,
        attributes: person.attributes ?? {},
        segments: [], // segments are derived client-side; no third-party source
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in people-attributes-get function:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read person attributes',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

export default handler;
Deno.serve(handler);
