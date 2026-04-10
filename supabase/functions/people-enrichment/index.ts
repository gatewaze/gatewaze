import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { emitIntegrationEvent } from '../_shared/integrationEvents.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const enrichlayerApiKey = Deno.env.get('ENRICHLAYER_API_KEY')!

// API key for authenticating requests from the frontend
const API_BEARER_TOKEN = Deno.env.get('GW_API_BEARER') || 'YYv8gvrl55fVPmJDQAWz8JLmhtpZpWF1MlqOrv8dfs7yPfMHPLHTdAlUeJcDiIUe'

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
}

interface EnrichmentRequest {
  email: string
  linkedin_url?: string
  mode?: 'initial' | 'full' | 'sync' | 'webhook'
}

interface PersonSummary {
  email: string
  email_encoded?: string
  cleaned_email?: string
  first_name?: string
  last_name?: string
  job_title?: string
  company?: string
  linkedin_url?: string
  seniority?: string
  city?: string
  country?: string
  state?: string
  timezone?: string
  company_annual_revenue?: number
  company_annual_revenue_estimated?: string
  company_funding?: number
  company_employees?: number
  company_founded_year?: number
  company_sector?: string
  company_industry_group?: string
  company_industry?: string
  company_sub_industry?: string
  company_type?: string
  company_domain?: string
  occupation?: string
  summary?: string
  follower_count?: number
  skills?: string[]
  enrichment_updated?: number
}

/**
 * Encode email for use in URLs/tracking
 */
function encodeEmail(email: string, passphrase = 'HideMe'): string {
  const emailBytes = new TextEncoder().encode(email)
  const passphraseBytes = new TextEncoder().encode(passphrase)

  const encodedChars: number[] = []
  for (let i = 0; i < emailBytes.length; i++) {
    const passphraseIndex = i % passphraseBytes.length
    encodedChars.push(emailBytes[i] ^ passphraseBytes[passphraseIndex])
  }

  const base64 = btoa(String.fromCharCode(...encodedChars))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Clean email address (remove + aliases, lowercase)
 */
function cleanEmail(email: string): string {
  const parts = email.split('@')
  if (parts.length !== 2) return email.toLowerCase()
  const localPart = parts[0].split('+')[0].toLowerCase()
  return `${localPart}@${parts[1].toLowerCase()}`
}

/**
 * Get a Clearbit API key with available quota from the database.
 * Uses the clearbit_key_status view which calculates remaining calls per key.
 * Returns the key with the most remaining calls.
 */
async function getClearbitKey(): Promise<string | null> {
  // Query the view that shows keys with remaining quota
  const { data, error } = await supabase
    .from('clearbit_key_status')
    .select('api_key, remaining_calls')
    .gt('remaining_calls', 0)
    .order('remaining_calls', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('Error fetching Clearbit key:', error)
    return null
  }

  if (!data) {
    console.error('No Clearbit API keys available with remaining quota')
    return null
  }

  return data.api_key
}

/**
 * Log Clearbit API key usage
 */
async function logClearbitUsage(apiKey: string, email: string): Promise<void> {
  const { error } = await supabase
    .from('clearbit_key_usage')
    .insert({ api_key: apiKey, email })

  if (error) {
    console.error('Failed to log Clearbit usage:', error)
    // Don't throw - we don't want to break enrichment if logging fails
  }
}

/**
 * Log API failure for debugging
 */
async function logApiFailure(email: string, linkedinUrl: string | null, status: string): Promise<void> {
  await supabase
    .from('api_failure_logs')
    .insert({
      email,
      linkedin_url: linkedinUrl,
      status,
    })
}

/**
 * Store enrichment history (append-only, like BigQuery)
 */
async function storeEnrichmentHistory(
  email: string,
  apiSource: string,
  rawData: Record<string, any>
): Promise<void> {
  await supabase
    .from('enrichment_history')
    .insert({
      email: email.toLowerCase(),
      api_source: apiSource,
      raw_data: rawData,
    })
}

/**
 * Enrich with Clearbit Person API
 */
async function enrichWithClearbit(email: string): Promise<{
  person?: Record<string, any>
  company?: Record<string, any>
  summary?: Partial<PersonSummary>
} | null> {
  const clearbitKey = await getClearbitKey()
  if (!clearbitKey) {
    console.log('No Clearbit keys available (none configured or all at limit)')
    return null
  }

  try {
    const response = await fetch(
      `https://person-stream.clearbit.com/v2/combined/find?email=${encodeURIComponent(email)}`,
      {
        headers: {
          'Authorization': `Basic ${btoa(clearbitKey + ':')}`,
        },
      }
    )

    // Log usage regardless of outcome (we made an API call)
    await logClearbitUsage(clearbitKey, email)

    if (!response.ok) {
      console.error('Clearbit API error:', response.status)
      await logApiFailure(email, null, `clearbit_${response.status}`)
      return null
    }

    const data = await response.json()
    const person = data.person || {}
    const company = data.company || {}

    // Store raw response in enrichment history
    await storeEnrichmentHistory(email, 'clearbit', data)

    const linkedinHandle = person.linkedin?.handle
    const linkedinUrl = linkedinHandle ? `https://www.linkedin.com/${linkedinHandle}` : undefined

    const summary: Partial<PersonSummary> = {
      email: person.email,
      first_name: person.name?.givenName,
      last_name: person.name?.familyName,
      job_title: person.employment?.title,
      company: person.employment?.name || company.name,
      linkedin_url: linkedinUrl,
      seniority: person.employment?.seniority,
      city: person.geo?.city || company.geo?.city,
      country: person.geo?.country || company.geo?.country,
      state: person.geo?.state || company.geo?.state,
      timezone: person.timeZone || company.timeZone,
      company_annual_revenue: company.metrics?.annualRevenue,
      company_annual_revenue_estimated: company.metrics?.estimatedAnnualRevenue,
      company_funding: company.metrics?.raised,
      company_employees: company.metrics?.employees,
      company_founded_year: company.foundedYear,
      company_sector: company.category?.sector,
      company_industry_group: company.category?.industryGroup,
      company_industry: company.category?.industry,
      company_sub_industry: company.category?.subIndustry,
      company_type: company.type,
      company_domain: company.domain,
    }

    return { person, company, summary }
  } catch (error) {
    console.error('Clearbit error:', error)
    await logApiFailure(email, null, `clearbit_error: ${error instanceof Error ? error.message : 'unknown'}`)
    return null
  }
}

/**
 * Resolve email to LinkedIn URL using Enrich Layer
 */
async function resolveEmailToLinkedIn(email: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://enrichlayer.com/api/v2/person/lookup?email=${encodeURIComponent(email)}&enrich_profile=skip&lookup_depth=deep`,
      {
        headers: {
          'Authorization': `Bearer ${enrichlayerApiKey}`,
        },
      }
    )

    if (!response.ok) {
      console.log('Enrich Layer email resolution failed:', response.status)
      return null
    }

    const data = await response.json()
    return data.linkedin_profile_url || null
  } catch (error) {
    console.error('Enrich Layer email resolution error:', error)
    return null
  }
}

/**
 * Enrich with Enrich Layer (LinkedIn profile)
 */
async function enrichWithEnrichLayer(linkedinUrl: string, email: string): Promise<{
  profile?: Record<string, any>
  summary?: Partial<PersonSummary>
} | null> {
  try {
    const response = await fetch(
      `https://enrichlayer.com/api/v2/profile?url=${encodeURIComponent(linkedinUrl)}&extra=exclude&inferred_salary=exclude&skills=include`,
      {
        headers: {
          'Authorization': `Bearer ${enrichlayerApiKey}`,
        },
      }
    )

    const responseText = await response.text()

    if (responseText.includes('Person profile does not exist') || response.status === 404) {
      console.log('Enrich Layer: Profile not found')
      await logApiFailure(email, linkedinUrl, 'enrichlayer_profile_not_found')
      return null
    }

    if (!response.ok) {
      console.error('Enrich Layer API error:', response.status)
      await logApiFailure(email, linkedinUrl, `enrichlayer_${response.status}`)
      return null
    }

    const profile = JSON.parse(responseText)

    // Store raw response in enrichment history
    await storeEnrichmentHistory(email, 'enrichlayer', profile)

    // Get current company
    const currentCompanies = (profile.experiences || [])
      .filter((exp: any) => !exp.ends_at)
      .slice(0, 1)

    const currentCompany = currentCompanies[0]

    // Try to get company details
    let companyData: Record<string, any> | null = null
    if (currentCompany?.company_linkedin_profile_url) {
      try {
        const companyResponse = await fetch(
          `https://enrichlayer.com/api/v2/company/profile?url=${encodeURIComponent(currentCompany.company_linkedin_profile_url)}&resolve_numeric_id=true&categories=exclude&funding_data=exclude&extra=exclude&exit_data=exclude&acquisitions=exclude&use_cache=if-present`,
          {
            headers: {
              'Authorization': `Bearer ${enrichlayerApiKey}`,
            },
          }
        )

        if (companyResponse.ok) {
          companyData = await companyResponse.json()
          // Store company data in enrichment history as well
          await storeEnrichmentHistory(email, 'enrichlayer_company', companyData)
        }
      } catch (e) {
        console.log('Failed to fetch company data:', e)
      }
    }

    // Handle student case
    let studentTitle: string | undefined
    if (!profile.experiences?.length && profile.education?.length) {
      const edu = profile.education[0]
      studentTitle = `Student - ${edu.degree_name || ''}, ${edu.field_of_study || ''}`.trim()
    }

    const summary: Partial<PersonSummary> = {
      email,
      first_name: profile.first_name,
      last_name: profile.last_name,
      job_title: studentTitle || currentCompany?.title,
      company: companyData?.name || currentCompany?.company,
      linkedin_url: linkedinUrl,
      city: profile.city,
      country: profile.country_full_name,
      state: profile.state,
      company_employees: companyData?.company_size_on_linkedin,
      company_founded_year: companyData?.founded_year,
      company_industry: companyData?.industry,
      company_type: companyData?.type,
      company_domain: companyData?.website?.replace('https://', '').replace('http://', '').split('/')[0],
      occupation: profile.occupation,
      summary: profile.summary,
      follower_count: profile.follower_count,
      skills: profile.skills,
    }

    return { profile, summary }
  } catch (error) {
    console.error('Enrich Layer error:', error)
    await logApiFailure(email, linkedinUrl, `enrichlayer_error: ${error instanceof Error ? error.message : 'unknown'}`)
    return null
  }
}

/**
 * Create master summary by merging Clearbit and Enrich Layer data
 */
function createMasterSummary(
  clearbitSummary: Partial<PersonSummary> | undefined,
  enrichLayerSummary: Partial<PersonSummary> | undefined,
  originalEmail: string
): PersonSummary {
  // Prioritize Enrich Layer over Clearbit
  const summary: PersonSummary = {
    email: originalEmail,
    email_encoded: encodeEmail(originalEmail),
    cleaned_email: enrichLayerSummary?.email || clearbitSummary?.email,
    first_name: enrichLayerSummary?.first_name || clearbitSummary?.first_name,
    last_name: enrichLayerSummary?.last_name || clearbitSummary?.last_name,
    job_title: enrichLayerSummary?.job_title || clearbitSummary?.job_title,
    company: enrichLayerSummary?.company || clearbitSummary?.company,
    linkedin_url: enrichLayerSummary?.linkedin_url || clearbitSummary?.linkedin_url,
    seniority: enrichLayerSummary?.seniority || clearbitSummary?.seniority,
    city: enrichLayerSummary?.city || clearbitSummary?.city,
    country: enrichLayerSummary?.country || clearbitSummary?.country,
    state: enrichLayerSummary?.state || clearbitSummary?.state,
    timezone: enrichLayerSummary?.timezone || clearbitSummary?.timezone,
    company_annual_revenue: enrichLayerSummary?.company_annual_revenue || clearbitSummary?.company_annual_revenue,
    company_annual_revenue_estimated: enrichLayerSummary?.company_annual_revenue_estimated || clearbitSummary?.company_annual_revenue_estimated,
    company_funding: enrichLayerSummary?.company_funding || clearbitSummary?.company_funding,
    company_employees: enrichLayerSummary?.company_employees || clearbitSummary?.company_employees,
    company_founded_year: enrichLayerSummary?.company_founded_year || clearbitSummary?.company_founded_year,
    company_sector: enrichLayerSummary?.company_sector || clearbitSummary?.company_sector,
    company_industry_group: enrichLayerSummary?.company_industry_group || clearbitSummary?.company_industry_group,
    company_industry: enrichLayerSummary?.company_industry || clearbitSummary?.company_industry,
    company_sub_industry: enrichLayerSummary?.company_sub_industry || clearbitSummary?.company_sub_industry,
    company_type: enrichLayerSummary?.company_type || clearbitSummary?.company_type,
    company_domain: enrichLayerSummary?.company_domain || clearbitSummary?.company_domain,
    occupation: enrichLayerSummary?.occupation,
    summary: enrichLayerSummary?.summary,
    follower_count: enrichLayerSummary?.follower_count,
    skills: enrichLayerSummary?.skills,
    enrichment_updated: Math.floor(Date.now() / 1000),
  }

  return summary
}

/**
 * Store enrichment data in Supabase
 */
async function storeEnrichmentInSupabase(
  email: string,
  summary: PersonSummary,
  rawData: { clearbit?: any; enrichLayer?: any }
): Promise<void> {
  try {
    // Update person attributes
    const { data: person } = await supabase
      .from('people')
      .select('id, attributes')
      .ilike('email', email)
      .maybeSingle()

    if (person) {
      const mergedAttributes = {
        ...(person.attributes || {}),
        ...Object.fromEntries(
          Object.entries(summary).filter(([_, v]) => v !== null && v !== undefined)
        ),
      }

      await supabase
        .from('people')
        .update({
          attributes: mergedAttributes,
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', person.id)
    }

    // Store raw enrichment data for reference
    await supabase
      .from('people_enrichments')
      .upsert({
        email: email.toLowerCase(),
        clearbit_data: rawData.clearbit || null,
        enrichlayer_data: rawData.enrichLayer || null,
        summary: summary,
        enriched_at: new Date().toISOString(),
      }, {
        onConflict: 'email',
      })

  } catch (error) {
    console.error('Supabase storage error:', error)
  }
}

/**
 * Handle initial mode - just find LinkedIn URL
 */
async function handleInitialMode(email: string): Promise<Response> {
  const cleanedEmail = cleanEmail(email)

  // Try Clearbit first
  const clearbitResult = await enrichWithClearbit(cleanedEmail)
  let linkedinUrl = clearbitResult?.summary?.linkedin_url

  // If no LinkedIn URL from Clearbit, try Enrich Layer email resolution
  if (!linkedinUrl) {
    linkedinUrl = await resolveEmailToLinkedIn(cleanedEmail) || undefined
  }

  return new Response(JSON.stringify({
    linkedin_url: linkedinUrl || null,
    message: linkedinUrl ? undefined : 'No LinkedIn profile found',
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Handle full enrichment mode
 */
async function handleFullMode(
  originalEmail: string,
  linkedinUrl: string | undefined,
): Promise<Response> {
  const cleanedEmail = cleanEmail(originalEmail)

  let clearbitResult: Awaited<ReturnType<typeof enrichWithClearbit>> = null
  let enrichLayerResult: Awaited<ReturnType<typeof enrichWithEnrichLayer>> = null

  // If LinkedIn URL provided, try Enrich Layer first
  if (linkedinUrl) {
    enrichLayerResult = await enrichWithEnrichLayer(linkedinUrl, cleanedEmail)

    // If Enrich Layer failed, try Clearbit
    if (!enrichLayerResult) {
      clearbitResult = await enrichWithClearbit(cleanedEmail)
    }
  } else {
    // No LinkedIn URL - try Clearbit first to potentially get one
    clearbitResult = await enrichWithClearbit(cleanedEmail)

    // Check if Clearbit gave us a LinkedIn URL
    linkedinUrl = clearbitResult?.summary?.linkedin_url

    if (linkedinUrl) {
      // Try Enrich Layer with the LinkedIn URL from Clearbit
      enrichLayerResult = await enrichWithEnrichLayer(linkedinUrl, cleanedEmail)
    } else {
      // Try to resolve email to LinkedIn
      linkedinUrl = await resolveEmailToLinkedIn(cleanedEmail) || undefined

      if (linkedinUrl) {
        enrichLayerResult = await enrichWithEnrichLayer(linkedinUrl, cleanedEmail)
      }
    }
  }

  // Create master summary
  const summary = createMasterSummary(
    clearbitResult?.summary,
    enrichLayerResult?.summary,
    originalEmail
  )

  // Store master summary in enrichment history
  await storeEnrichmentHistory(originalEmail, 'master', summary)

  // Store in Supabase
  await storeEnrichmentInSupabase(originalEmail, summary, {
    clearbit: clearbitResult,
    enrichLayer: enrichLayerResult?.profile,
  })

  // Notify integration modules about the enrichment (fire-and-forget)
  const { email: _email, email_encoded: _enc, ...enrichedAttributes } = summary
  emitIntegrationEvent(supabase, 'person.enriched', { email: originalEmail, attributes: enrichedAttributes })

  return new Response(JSON.stringify({
    output: {
      clearbit: clearbitResult?.person ? { person: clearbitResult.person, company: clearbitResult.company } : undefined,
      enrichlayer: enrichLayerResult?.profile,
      summary,
    },
    status: {},
    error: {},
    api_summary: {
      clearbit: clearbitResult?.summary,
      enrichlayer: enrichLayerResult?.summary,
    },
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function handler(req: Request) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Only allow GET and POST
  if (!['GET', 'POST'].includes(req.method)) {
    return new Response(JSON.stringify({ error: 'Only GET and POST methods are allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Validate Authorization header — accept API bearer token OR valid Supabase JWT
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ status: { age: 'Error' }, message: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const token = authHeader.split(' ')[1]
  let isAuthorized = false

  // Check API bearer token first (backend/webhook calls)
  if (token === API_BEARER_TOKEN) {
    isAuthorized = true
  } else {
    // Try validating as a Supabase JWT (frontend calls via supabase.functions.invoke)
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (!error && user) {
      isAuthorized = true
    }
  }

  if (!isAuthorized) {
    return new Response(JSON.stringify({ status: { age: 'Error' }, message: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    let body: EnrichmentRequest

    if (req.method === 'GET') {
      const url = new URL(req.url)
      body = {
        email: url.searchParams.get('email') || '',
        linkedin_url: url.searchParams.get('linkedin_url') || undefined,
        mode: (url.searchParams.get('mode') as EnrichmentRequest['mode']) || 'full',
      }
    } else {
      body = await req.json()
    }

    const { email, linkedin_url, mode = 'full' } = body

    if (!email) {
      return new Response(JSON.stringify({ status: { age: 'Error' }, message: 'Email is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate email format
    const emailParts = email.split('@')
    if (emailParts.length !== 2) {
      return new Response(JSON.stringify({ status: { age: 'Error' }, message: 'Invalid email address' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Handle different modes
    switch (mode) {
      case 'initial':
        return await handleInitialMode(email)

      case 'webhook':
        // Start processing in background, return immediately
        // Note: Edge functions have limited background processing, so we do sync processing
        return await handleFullMode(email, linkedin_url)

      case 'sync':
      case 'full':
      default:
        return await handleFullMode(email, linkedin_url)
    }

  } catch (error) {
    console.error('Enrichment error:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}

export default handler;
Deno.serve(handler);
