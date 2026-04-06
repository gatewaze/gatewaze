import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://deno.land/x/openai@v4.24.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Job function categories
const JOB_FUNCTIONS = [
  'Engineering',
  'Data Science',
  'Machine Learning',
  'Product',
  'Design',
  'Executive',
  'Sales',
  'Marketing',
  'Operations',
  'Research',
  'Finance',
  'HR',
  'Legal',
  'Other',
] as const

// Job seniority levels
const JOB_SENIORITIES = [
  'C-Level',
  'VP',
  'Manager',
  'Senior IC',
  'IC',
  'Entry',
  'Founder',
  'Student',
  'Other',
] as const

type JobFunction = typeof JOB_FUNCTIONS[number]
type JobSeniority = typeof JOB_SENIORITIES[number]

interface ClassificationResult {
  job_title: string
  job_function: JobFunction
  job_seniority: JobSeniority
  country?: string | null
}

interface JobTitleWithContext {
  job_title: string
  country?: string | null
  country_code?: string | null
}

interface RequestBody {
  // Option 1: Classify specific job titles
  job_titles?: string[]
  // Option 2: Classify people by event
  event_id?: string
  // Option 3: Classify specific person IDs
  person_ids?: number[]
  // Whether to update the person attributes (default: true)
  update_people?: boolean
  // Dry run mode - just return classifications without updating
  dry_run?: boolean
}

// Helper to create a unique key for job title + country combination
function makeContextKey(jobTitle: string, country?: string | null): string {
  return `${jobTitle}|||${country || 'unknown'}`
}

function parseContextKey(key: string): { jobTitle: string; country: string } {
  const [jobTitle, country] = key.split('|||')
  return { jobTitle, country }
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const openai = new OpenAI({ apiKey: openaiKey })

    const body: RequestBody = await req.json()
    const { job_titles, event_id, person_ids, update_people = true, dry_run = false } = body

    let titlesToClassify: JobTitleWithContext[] = []
    // Map of "job_title|||country" -> customer_ids (for grouping same title+country)
    let personMap: Map<string, number[]> = new Map()

    // Determine which job titles to classify
    if (job_titles && job_titles.length > 0) {
      // Option 1: Direct list of job titles (no location context available)
      titlesToClassify = [...new Set(job_titles.filter(t => t && t.trim()))].map(t => ({ job_title: t }))
    } else if (event_id) {
      // Option 2: Get job titles from event registrants
      const { data: registrants, error } = await supabase
        .from('events_registrations')
        .select(`
          people_profile_id,
          people_profiles!inner(person_id)
        `)
        .eq('event_id', event_id)

      if (error) throw error

      const personIds = registrants
        ?.map((r: any) => r.people_profiles?.person_id)
        .filter(Boolean)

      if (!personIds || personIds.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          message: 'No registrants found for this event',
          classified: 0
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Get people with job titles that don't have classifications yet
      // Also fetch country/country_code for location-aware classification
      const { data: people, error: peopleError } = await supabase
        .from('people')
        .select('id, attributes')
        .in('id', personIds)
        .not('attributes->job_title', 'is', null)

      if (peopleError) throw peopleError

      // Filter to people without existing classification
      const peopleToClassify = people?.filter((c: any) => {
        const attrs = c.attributes || {}
        return attrs.job_title && (!attrs.job_function || !attrs.job_seniority)
      }) || []

      // Build map of job title+country to person IDs
      for (const person of peopleToClassify) {
        const attrs = person.attributes || {}
        const jobTitle = attrs.job_title?.trim()
        const country = attrs.country || attrs.country_code || null

        if (jobTitle) {
          const key = makeContextKey(jobTitle, country)
          if (!personMap.has(key)) {
            personMap.set(key, [])
          }
          personMap.get(key)!.push(person.id)
        }
      }

      // Build list of unique job title + country combinations
      titlesToClassify = [...personMap.keys()].map(key => {
        const { jobTitle, country } = parseContextKey(key)
        return { job_title: jobTitle, country: country !== 'unknown' ? country : null }
      })
    } else if (person_ids && person_ids.length > 0) {
      // Option 3: Specific person IDs
      const { data: people, error } = await supabase
        .from('people')
        .select('id, attributes')
        .in('id', person_ids)
        .not('attributes->job_title', 'is', null)

      if (error) throw error

      // Filter to people without existing classification
      const peopleToClassify = people?.filter((c: any) => {
        const attrs = c.attributes || {}
        return attrs.job_title && (!attrs.job_function || !attrs.job_seniority)
      }) || []

      for (const person of peopleToClassify) {
        const attrs = person.attributes || {}
        const jobTitle = attrs.job_title?.trim()
        const country = attrs.country || attrs.country_code || null

        if (jobTitle) {
          const key = makeContextKey(jobTitle, country)
          if (!personMap.has(key)) {
            personMap.set(key, [])
          }
          personMap.get(key)!.push(person.id)
        }
      }

      titlesToClassify = [...personMap.keys()].map(key => {
        const { jobTitle, country } = parseContextKey(key)
        return { job_title: jobTitle, country: country !== 'unknown' ? country : null }
      })
    } else {
      return new Response(JSON.stringify({
        error: 'Must provide job_titles, event_id, or person_ids'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (titlesToClassify.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No job titles to classify (all may already be classified)',
        classified: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`Classifying ${titlesToClassify.length} unique job title + country combinations`)

    // Classify job titles using OpenAI (with location context)
    const classifications = await classifyJobTitlesWithContext(openai, titlesToClassify)

    // Update people if requested and not dry run
    let updatedCount = 0
    if (update_people && !dry_run && personMap.size > 0) {
      for (const classification of classifications) {
        // Find people by matching job_title + country
        const key = makeContextKey(classification.job_title, classification.country)
        const matchingPersonIds = personMap.get(key)

        if (matchingPersonIds && matchingPersonIds.length > 0) {
          // Update each person with the classification
          for (const personId of matchingPersonIds) {
            const { data: person } = await supabase
              .from('people')
              .select('attributes')
              .eq('id', personId)
              .single()

            if (person) {
              const updatedAttrs = {
                ...person.attributes,
                job_function: classification.job_function,
                job_seniority: classification.job_seniority,
              }

              const { error: updateError } = await supabase
                .from('people')
                .update({ attributes: updatedAttrs })
                .eq('id', personId)

              if (!updateError) {
                updatedCount++
              } else {
                console.error(`Failed to update person ${personId}:`, updateError)
              }
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      classified: classifications.length,
      updated: updatedCount,
      dry_run,
      classifications,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('Error classifying job titles:', error)
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}

export default handler;
if (import.meta.main) Deno.serve(handler);

// Location-aware classification function
async function classifyJobTitlesWithContext(
  openai: OpenAI,
  titlesWithContext: JobTitleWithContext[]
): Promise<ClassificationResult[]> {
  // Process in batches of 50 to avoid token limits
  const BATCH_SIZE = 50
  const results: ClassificationResult[] = []

  for (let i = 0; i < titlesWithContext.length; i += BATCH_SIZE) {
    const batch = titlesWithContext.slice(i, i + BATCH_SIZE)
    const batchResults = await classifyBatchWithContext(openai, batch)
    results.push(...batchResults)
  }

  return results
}

async function classifyBatchWithContext(
  openai: OpenAI,
  titlesWithContext: JobTitleWithContext[]
): Promise<ClassificationResult[]> {
  const prompt = `Classify each job title into a job function and seniority level.
IMPORTANT: Consider the person's country when determining seniority, as title meanings vary by region.

Job Functions (choose exactly one):
- Engineering: Software engineers, developers, SREs, DevOps, platform engineers, Data Engineers
- Data Science: Data scientists, data analysts, BI analysts
- Machine Learning: ML engineers, AI engineers, MLOps, research scientists (ML/AI focused)
- Product: Product managers, product owners, TPMs
- Design: UX designers, UI designers, product designers
- Executive: CEOs, CTOs, CIOs, CMOs, COOs, C-level executives, Directors without department, Founders without other role, general leadership titles
- Sales: Sales reps, account executives, SDRs, sales managers
- Marketing: Marketing managers, growth, content, brand
- Operations: Operations managers, project managers, program managers
- Research: Research scientists, research engineers (non-ML), academics
- Finance: Finance, accounting, investors, VCs
- HR: Human resources, recruiting, people operations
- Legal: Lawyers, legal counsel, compliance
- Other: ONLY use this when title is truly unclassifiable (e.g., "Teacher Assistant", "Editor"). Most titles should fit a category above.

Job Seniority Levels (choose exactly one):
- C-Level: CEO, CTO, CIO, CMO, COO, Chief *, plus see regional rules below
- VP: Vice President, SVP, EVP (more senior in US, less so in UK/EU)
- Manager: Manager, Team Lead, Lead (when managing people)
- Senior IC: Senior engineer, Senior developer, Staff, Principal (IC role), Lead (technical lead)
- IC: Mid-level individual contributors, standard engineer/analyst/designer titles
- Entry: Junior, Associate, Intern, Entry-level
- Founder: Founder, Co-founder (regardless of other title)
- Student: Student, Teaching Assistant, PhD candidate
- Other: Cannot determine

REGIONAL SENIORITY RULES (VERY IMPORTANT):
- UK/GB/United Kingdom/Ireland: "Director" and "Head of" are C-Level (board-level positions, legally responsible)
- EU/Europe (Germany, France, Netherlands, etc.): "Director" and "Head of" are typically C-Level
- US/United States/Canada: "Director" is often below VP (mid-senior), "Head of" is usually C-Level
- If country is unknown, default to UK/EU interpretation (Director = C-Level)

Special rules:
- "Founder" or "Co-founder" in title -> Seniority = "Founder", Function = "Executive" (unless they have another specific role like "Founding Engineer" -> Engineering)
- "CEO" or "CTO" or "Chief" -> Seniority = "C-Level", Function = "Executive"
- ML Engineer, MLOps, AI Engineer -> Function = "Machine Learning"
- Data Engineer -> Function = "Engineering"
- Someone who is both "CEO" and "Founder" -> Seniority = "Founder" (founder takes precedence)

Job Titles to classify (with country context when available):
${titlesWithContext.map((t, i) => {
  if (t.country) {
    return `${i + 1}. "${t.job_title}" (Country: ${t.country})`
  }
  return `${i + 1}. "${t.job_title}" (Country: unknown)`
}).join('\n')}

Respond with a JSON array of objects with this exact structure:
[
  {"job_title": "exact title from input", "job_function": "one of the functions", "job_seniority": "one of the seniorities", "country": "country from input or null"},
  ...
]

Only respond with the JSON array, no other text.`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a job title classification expert with knowledge of regional differences in job title meanings. In the UK/EU, "Director" is a board-level position (C-Level). In the US, "Director" is typically mid-senior level. Always consider the country context when classifying seniority. Respond with valid JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.1,
    max_tokens: 4000,
  })

  const content = response.choices[0]?.message?.content || '[]'

  try {
    // Parse the JSON response
    const parsed = JSON.parse(content.trim())

    // Validate and normalize the results
    return parsed.map((item: any) => ({
      job_title: item.job_title,
      job_function: JOB_FUNCTIONS.includes(item.job_function) ? item.job_function : 'Other',
      job_seniority: JOB_SENIORITIES.includes(item.job_seniority) ? item.job_seniority : 'Other',
      country: item.country || null,
    }))
  } catch (parseError) {
    console.error('Failed to parse OpenAI response:', content)
    // Return empty results for this batch if parsing fails
    return titlesWithContext.map(item => ({
      job_title: item.job_title,
      job_function: 'Other' as JobFunction,
      job_seniority: 'Other' as JobSeniority,
      country: item.country || null,
    }))
  }
}
