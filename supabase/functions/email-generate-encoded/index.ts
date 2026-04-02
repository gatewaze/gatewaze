/**
 * Generate Email Encoded
 *
 * This edge function generates the email_encoded attribute for people.
 * It's called by a database trigger when a person is inserted or their email changes.
 *
 * The email_encoded value is used for secure calendar links and tracking URLs.
 * It uses XOR encryption with Base64 encoding (matching the frontend/Customer.io format).
 *
 * Expected payload from pg_net trigger:
 * {
 *   customer_id: number,
 *   email: string,
 *   source?: string  // 'db_trigger' when called from database
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { emitIntegrationEvent } from '../_shared/integrationEvents.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Supabase client for updating person attributes
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface GenerateRequest {
  customer_id: number
  email: string
  source?: string
}

/**
 * Encode email for use in URLs/tracking
 * This matches the encoding used in:
 * - user-enrichment edge function
 * - user-warehouse edge function
 * - Frontend gateway app
 * - encodedCalendarService.ts
 */
function encodeEmail(email: string, passphrase = 'HideMe'): string {
  const emailLower = email.toLowerCase()
  const emailBytes = new TextEncoder().encode(emailLower)
  const passphraseBytes = new TextEncoder().encode(passphrase)

  const encodedChars: number[] = []
  for (let i = 0; i < emailBytes.length; i++) {
    const passphraseIndex = i % passphraseBytes.length
    encodedChars.push(emailBytes[i] ^ passphraseBytes[passphraseIndex])
  }

  const base64 = btoa(String.fromCharCode(...encodedChars))
  // Make URL-safe by replacing special characters
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
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
    const body: GenerateRequest = await req.json()
    const { customer_id, email, source } = body

    // Validate required fields
    if (!customer_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'customer_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!email) {
      return new Response(
        JSON.stringify({ success: false, error: 'email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`🔐 Generating email_encoded for person ${customer_id}: ${email} (source: ${source || 'unknown'})`)

    // Generate the encoded email
    const emailEncoded = encodeEmail(email)
    console.log(`   Generated: ${emailEncoded}`)

    // Update person attributes in Supabase
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // First fetch current attributes
    const { data: person, error: fetchError } = await supabase
      .from('people')
      .select('attributes')
      .eq('id', customer_id)
      .single()

    if (fetchError) {
      console.error('Failed to fetch person:', fetchError)
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch person' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Merge email_encoded into existing attributes
    const updatedAttributes = {
      ...(person?.attributes || {}),
      email_encoded: emailEncoded
    }

    // Update person with new attributes
    const { error: updateError } = await supabase
      .from('people')
      .update({ attributes: updatedAttributes })
      .eq('id', customer_id)

    if (updateError) {
      console.error('Failed to update person attributes:', updateError)
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update person attributes' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`✅ Updated person ${customer_id} with email_encoded in Supabase`)

    // Notify integration modules about the attribute update (fire-and-forget)
    emitIntegrationEvent(supabase, 'person.updated', { email, attributes: { email_encoded: emailEncoded } })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'email_encoded generated and stored',
        customer_id,
        email,
        email_encoded: emailEncoded
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in generate-email-encoded function:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate email_encoded',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
