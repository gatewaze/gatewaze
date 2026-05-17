import { streamText, tool, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { getServerBrandConfig } from '@/config/brand'
import { checkRateLimit } from '@/lib/rate-limit'
import { resolveEventImages, resolveEventImagesList } from '@/lib/storage-resolve'

const USE_CASE = 'portal-chat'
const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

/**
 * Lazy-resolve the ai module's credential router + cost ledger. Same
 * pattern as portal/ai-search — the module isn't on the portal's
 * static require-path but lives next door in the workspace.
 */
async function loadAiHelpers() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('@gatewaze-modules/ai/lib/runner.js' as any).catch(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => import('../../../../../../../gatewaze-modules/modules/ai/lib/runner.ts' as any),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const creds = await import('@gatewaze-modules/ai/lib/credentials.js' as any).catch(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => import('../../../../../../../gatewaze-modules/modules/ai/lib/credentials.ts' as any),
  )
  return {
    resolveCredential: creds.resolveCredential as (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: any,
      opts: { provider: 'anthropic' | 'openai' | 'gemini'; userId: string | null; useCase: string; systemRunOnly?: boolean },
    ) => Promise<{ apiKey: string; source: string; last4: string; credentialId: string | null }>,
    recordUsage: mod.recordUsage ?? null,
  }
}

function parseCookies(cookieHeader: string): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=')
    if (key) cookies.set(key, rest.join('='))
  }
  return cookies
}

export async function POST(req: NextRequest) {
  // Credential resolution is now the ai module's job. We just need
  // SOMETHING resolvable for the portal-chat use-case (per-use-case
  // pin, system user override, or env). The ai module surfaces
  // NoCredentialsError if nothing's configured.

  // Extract JWT from Authorization header or Supabase session cookie
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : parseCookies(req.headers.get('cookie') ?? '').get('sb-access-token') ?? null

  // Rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rateLimitKey = token ? `chat:user:${token.slice(-16)}` : `chat:ip:${ip}`
  const maxRequests = token ? 60 : 20
  const rateLimit = checkRateLimit(rateLimitKey, maxRequests)

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfter) },
      },
    )
  }

  // Create Supabase client scoped to the user's session (RLS-enforced)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {},
  )

  const brandConfig = await getServerBrandConfig()
  const { messages } = await req.json()

  // Resolve the API key for the portal-chat use-case through the ai
  // module's credential router (user pin → use-case pin → env).
  const serviceRoleSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const ai = await loadAiHelpers().catch((err) => {
    console.warn('[portal-chat] ai module unavailable, falling back to env', err)
    return null
  })
  let anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (ai) {
    try {
      const resolved = await ai.resolveCredential(serviceRoleSupabase, {
        provider: 'anthropic',
        userId: null,                          // portal sessions are anonymous; system user
        useCase: USE_CASE,
      })
      anthropicApiKey = resolved.apiKey
    } catch (err) {
      console.warn('[portal-chat] ai credential resolution failed, falling back to env', err)
    }
  }
  if (!anthropicApiKey) {
    return NextResponse.json({ error: 'AI chat is not available' }, { status: 503 })
  }
  const anthropic = createAnthropic({ apiKey: anthropicApiKey })

  const result = streamText({
    model: anthropic(DEFAULT_MODEL),
    system: `You are the ${brandConfig.name} assistant, powered by Gatewaze.
Help users discover events, register, find networking opportunities, and navigate the platform.
Be concise, friendly, and helpful. Use markdown formatting where appropriate.
Today's date: ${new Date().toISOString().split('T')[0]}
Organization website: https://${brandConfig.domain}`,
    messages,
    tools: {
      searchEvents: tool({
        description: 'Search for events by topic, date, or location using semantic search',
        inputSchema: z.object({
          query: z.string().describe('Search query text'),
          location: z.string().optional().describe('City or venue name'),
        }),
        execute: async ({ query, location }) => {
          try {
            const { data: eventsRaw } = await supabase
              .from('events')
              .select('event_id, event_slug, event_title, event_start, event_end, event_city, event_country_code, event_location, listing_intro, event_logo, screenshot_url')
              .eq('is_live_in_production', true)
              .ilike('event_title', `%${query}%`)
              .order('event_start', { ascending: true })
              .limit(10)

            const events = eventsRaw ? resolveEventImagesList(eventsRaw, brandConfig.storageBucketUrl) : eventsRaw

            if (!events || events.length === 0) {
              return { results: [], message: 'No events found matching your search.' }
            }

            return {
              results: events.map((e) => ({
                id: e.event_id,
                title: e.event_title,
                date: e.event_start,
                endDate: e.event_end,
                location: [e.event_city, e.event_country_code].filter(Boolean).join(', '),
                description: e.listing_intro?.slice(0, 200) || null,
                url: `https://${brandConfig.domain}/events/${e.event_slug || e.event_id}`,
                imageUrl: e.event_logo || e.screenshot_url,
              })),
            }
          } catch (err) {
            console.error('searchEvents tool error:', err)
            return { error: 'Unable to search events right now. Please try again.' }
          }
        },
      }),

      getEventDetails: tool({
        description: 'Get full details for a specific event by ID or slug',
        inputSchema: z.object({
          identifier: z.string().describe('Event ID or URL slug'),
        }),
        execute: async ({ identifier }) => {
          try {
            let event = null

            // Try slug first
            const { data: bySlug } = await supabase
              .from('events')
              .select('event_id, event_slug, event_title, event_start, event_end, event_city, event_country_code, event_location, venue_address, event_description, listing_intro, event_logo, screenshot_url, event_link, enable_registration')
              .eq('event_slug', identifier)
              .eq('is_live_in_production', true)
              .maybeSingle()

            event = bySlug

            if (!event) {
              const { data: byId } = await supabase
                .from('events')
                .select('event_id, event_slug, event_title, event_start, event_end, event_city, event_country_code, event_location, venue_address, event_description, listing_intro, event_logo, screenshot_url, event_link, enable_registration')
                .eq('event_id', identifier)
                .eq('is_live_in_production', true)
                .maybeSingle()

              event = byId
            }

            event = resolveEventImages(event, brandConfig.storageBucketUrl)

            if (!event) {
              return { error: 'Event not found.' }
            }

            return {
              id: event.event_id,
              title: event.event_title,
              startDate: event.event_start,
              endDate: event.event_end,
              location: event.event_location || [event.event_city, event.event_country_code].filter(Boolean).join(', '),
              venue: event.venue_address,
              description: event.listing_intro || event.event_description?.slice(0, 500),
              registrationOpen: event.enable_registration ?? false,
              url: `https://${brandConfig.domain}/events/${event.event_slug || event.event_id}`,
              imageUrl: event.event_logo || event.screenshot_url,
              externalLink: event.event_link,
            }
          } catch (err) {
            console.error('getEventDetails tool error:', err)
            return { error: 'Unable to fetch event details right now.' }
          }
        },
      }),

      registerForEvent: tool({
        description: 'Register the authenticated user for an event. Requires login.',
        inputSchema: z.object({
          eventId: z.string().describe('Event ID'),
        }),
        execute: async ({ eventId }) => {
          if (!token) {
            return { error: 'Authentication required. Please log in to register for events.' }
          }

          try {
            // Get authenticated user
            const { data: { user }, error: authError } = await supabase.auth.getUser()
            if (authError || !user) {
              return { error: 'Authentication expired. Please log in again.' }
            }

            // Look up event UUID by event_id
            const { data: event } = await supabase
              .from('events')
              .select('id, event_id, event_title, enable_registration')
              .eq('event_id', eventId)
              .eq('is_live_in_production', true)
              .maybeSingle()

            if (!event) {
              return { error: 'Event not found.' }
            }

            if (!event.enable_registration) {
              return { error: 'Registration is not open for this event.' }
            }

            // Check existing registration
            const { data: existing } = await supabase
              .from('registrations')
              .select('id')
              .eq('event_id', event.event_id)
              .eq('user_id', user.id)
              .maybeSingle()

            if (existing) {
              return { success: true, message: `You're already registered for ${event.event_title}.` }
            }

            // Create registration
            const { data: registration, error: regError } = await supabase
              .from('registrations')
              .insert({
                event_id: event.event_id,
                user_id: user.id,
                email: user.email,
                status: 'confirmed',
              })
              .select('id')
              .single()

            if (regError) {
              console.error('Registration error:', regError)
              return { error: 'Unable to complete registration. Please try again.' }
            }

            return {
              success: true,
              confirmationId: registration.id,
              message: `Successfully registered for ${event.event_title}!`,
            }
          } catch (err) {
            console.error('registerForEvent tool error:', err)
            return { error: 'Unable to complete registration right now.' }
          }
        },
      }),

      findNetworkingMatches: tool({
        description: 'Find recommended networking connections at an event. Requires login.',
        inputSchema: z.object({
          eventId: z.string().describe('Event ID'),
        }),
        execute: async ({ eventId }) => {
          if (!token) {
            return { error: 'Authentication required to find networking matches.' }
          }

          try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
              return { error: 'Authentication expired. Please log in again.' }
            }

            // Get other registrants for this event with profile details
            const { data: registrants } = await supabase
              .from('registrations')
              .select('user_id, first_name, last_name, company, job_title')
              .eq('event_id', eventId)
              .neq('user_id', user.id)
              .limit(20)

            if (!registrants || registrants.length === 0) {
              return { matches: [], message: 'No other attendees found for this event yet.' }
            }

            return {
              matches: registrants.map((r) => ({
                name: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Anonymous',
                title: r.job_title || null,
                company: r.company || null,
              })),
              message: `Found ${registrants.length} attendees at this event.`,
            }
          } catch (err) {
            console.error('findNetworkingMatches tool error:', err)
            return { error: 'Unable to find networking matches right now.' }
          }
        },
      }),
    },
    stopWhen: stepCountIs(5),
    onFinish: async ({ usage }) => {
      // Record one ai_usage_events row per completed conversation so
      // portal-chat spend lands on the cost dashboard. Per
      // spec-ai-module §16 Phase D.
      if (!ai?.recordUsage) return
      try {
        await ai.recordUsage(serviceRoleSupabase, {
          userId: null,                     // anonymous session
          useCase: USE_CASE,
          threadId: null,
          messageId: null,
          kind: 'llm',
          provider: 'anthropic',
          model: DEFAULT_MODEL,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cachedTokens: 0,
          latencyMs: 0,                     // streaming SDK doesn't expose it cleanly
          status: 'ok',
        })
      } catch (err) {
        console.warn('[portal-chat] recordUsage failed', err)
      }
    },
  })

  return result.toUIMessageStreamResponse()
}
