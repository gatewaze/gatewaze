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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Storage bucket name for downloadable files
const DOWNLOADS_BUCKET = 'downloads'

interface DownloadRequest {
  email: string
  file_id: string
}

interface DownloadResponse {
  success: boolean
  download_url?: string
  error?: string
}

interface OfferResource {
  id: string
  offer_id: string
  file_id: string
  storage_path: string
  download_filename: string
  is_active: boolean
}

async function handler(req: Request) {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    const body: DownloadRequest = await req.json()
    const { email, file_id } = body

    if (!email) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Email required'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!file_id) {
      return new Response(JSON.stringify({
        success: false,
        error: 'File ID required'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`Looking up resource for file_id: ${file_id}`)

    // Look up the resource from the database
    const { data: resource, error: resourceError } = await supabase
      .from('offer_resources')
      .select('id, offer_id, file_id, storage_path, download_filename, is_active')
      .eq('file_id', file_id)
      .maybeSingle()

    if (resourceError) {
      console.error('Error looking up resource:', resourceError)
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to look up resource'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!resource) {
      console.error(`Invalid file_id requested: ${file_id}`)
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid file ID'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!resource.is_active) {
      console.error(`Resource is not active: ${file_id}`)
      return new Response(JSON.stringify({
        success: false,
        error: 'This download is not currently available'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`Generating download token for: ${email}, file: ${file_id}`)

    // Optional: Verify the user exists in our system
    const { data: person } = await supabase
      .from('people')
      .select('id, email')
      .ilike('email', email)
      .maybeSingle()

    if (!person) {
      console.warn(`Download requested for unknown email: ${email}`)
      // Still allow download - they may have registered but not yet synced
    }

    // Log the download request for tracking
    try {
      await supabase
        .from('download_logs')
        .insert({
          email: email.toLowerCase(),
          file_id: file_id,
          file_path: resource.storage_path,
          person_id: person?.id || null,
          offer_id: resource.offer_id,
          resource_id: resource.id,
          downloaded_at: new Date().toISOString()
        })
      console.log('Download logged successfully')
    } catch (logError) {
      // Don't fail if logging fails - table might not exist yet
      console.warn('Could not log download (table may not exist):', logError)
    }

    // Generate a signed URL with download disposition
    // The URL expires after 5 minutes (300 seconds)
    const { data: signedUrl, error: signError } = await supabase.storage
      .from(DOWNLOADS_BUCKET)
      .createSignedUrl(resource.storage_path, 300, {
        download: resource.download_filename // Forces download with this filename
      })

    if (signError || !signedUrl) {
      console.error('Error generating signed URL:', signError)
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to generate download link'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('Signed URL generated successfully')

    const response: DownloadResponse = {
      success: true,
      download_url: signedUrl.signedUrl
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Download token generation error:', error)
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
Deno.serve(handler);
