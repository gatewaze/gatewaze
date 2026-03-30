import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

interface ProfileUpdateRequest {
  first_name?: string
  last_name?: string
  company?: string
  job_title?: string
  linkedin_url?: string
  avatar_storage_path?: string
  marketing_consent?: boolean
}

interface ProfileUpdateResponse {
  success: boolean
  message?: string
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
    // Authenticate the request
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.split(' ')[1]
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      console.error('Auth error:', authError)
      return new Response(JSON.stringify({ success: false, error: 'Invalid or expired token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`📝 Processing profile update for user: ${user.id}`)

    const body: ProfileUpdateRequest = await req.json()

    // Get the person record for this auth user
    const { data: person, error: personError } = await supabase
      .from('people')
      .select('id, attributes')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (personError) {
      console.error('Error fetching person:', personError)
      return new Response(JSON.stringify({ success: false, error: 'Failed to fetch profile' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!person) {
      // No person record exists - create one
      console.log('📝 No existing person record, creating new one')

      const newAttributes: Record<string, any> = {}
      if (body.first_name) newAttributes.first_name = body.first_name
      if (body.last_name) newAttributes.last_name = body.last_name
      if (body.company) newAttributes.company = body.company
      if (body.job_title) newAttributes.job_title = body.job_title
      if (body.linkedin_url) newAttributes.linkedin_url = body.linkedin_url
      if (body.marketing_consent !== undefined) newAttributes.marketing_consent = body.marketing_consent

      const newPerson: Record<string, any> = {
        auth_user_id: user.id,
        email: user.email,
        attributes: newAttributes,
      }

      if (body.avatar_storage_path) {
        newPerson.avatar_storage_path = body.avatar_storage_path
        newPerson.avatar_source = 'uploaded'
        newPerson.avatar_updated_at = new Date().toISOString()
      }

      const { error: insertError } = await supabase
        .from('people')
        .insert(newPerson)

      if (insertError) {
        console.error('Error creating person:', insertError)
        return new Response(JSON.stringify({ success: false, error: 'Failed to create profile' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      console.log('✅ Person record created successfully')
      return new Response(JSON.stringify({ success: true, message: 'Profile created successfully' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Update existing person record
    const existingAttrs = (person.attributes as Record<string, any>) || {}
    const updatedAttrs = { ...existingAttrs }

    // Update attributes if provided
    if (body.first_name !== undefined) updatedAttrs.first_name = body.first_name
    if (body.last_name !== undefined) updatedAttrs.last_name = body.last_name
    if (body.company !== undefined) updatedAttrs.company = body.company
    if (body.job_title !== undefined) updatedAttrs.job_title = body.job_title
    if (body.linkedin_url !== undefined) updatedAttrs.linkedin_url = body.linkedin_url
    if (body.marketing_consent !== undefined) updatedAttrs.marketing_consent = body.marketing_consent

    const personUpdate: Record<string, any> = {
      attributes: updatedAttrs,
    }

    // Update avatar if provided
    if (body.avatar_storage_path) {
      personUpdate.avatar_storage_path = body.avatar_storage_path
      personUpdate.avatar_source = 'uploaded'
      personUpdate.avatar_updated_at = new Date().toISOString()
      console.log('📸 Updating avatar storage path:', body.avatar_storage_path)
    }

    const { error: updateError } = await supabase
      .from('people')
      .update(personUpdate)
      .eq('id', person.id)

    if (updateError) {
      console.error('Error updating person:', updateError)
      return new Response(JSON.stringify({ success: false, error: 'Failed to update profile' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Write consent record if marketing_consent was changed
    if (body.marketing_consent !== undefined && body.marketing_consent !== existingAttrs.marketing_consent) {
      const { error: consentError } = await supabase
        .from('compliance_consent_records')
        .insert({
          person_id: person.id,
          email: user.email,
          consent_type: 'marketing_email',
          consented: body.marketing_consent,
          consent_method: 'explicit_checkbox',
          consent_source: 'profile_update',
          consent_text: body.marketing_consent
            ? 'User opted in to marketing emails via profile settings'
            : 'User opted out of marketing emails via profile settings',
          consented_at: new Date().toISOString(),
        })

      if (consentError) {
        console.error('Error writing consent record:', consentError)
        // Don't fail the request - the preference was already saved
      }
    }

    console.log('✅ Person profile updated successfully')

    const response: ProfileUpdateResponse = {
      success: true,
      message: 'Profile updated successfully',
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('❌ Profile update error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}

export default handler;
if (import.meta.main) Deno.serve(handler);
