import { NextRequest } from 'next/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'

function createMcpServer(token: string | null) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {},
  )

  const server = new McpServer({
    name: 'gatewaze',
    version: '1.0.0',
  })

  // Resources
  server.resource('upcoming-events', 'events://upcoming', async (uri) => {
    const { data: events } = await supabase
      .from('events')
      .select('event_id, event_slug, event_title, event_start, event_end, event_city, event_country_code, event_logo')
      .eq('is_live_in_production', true)
      .gte('event_start', new Date().toISOString())
      .order('event_start', { ascending: true })
      .limit(50)

    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(events || []),
      }],
    }
  })

  // Tools
  server.tool(
    'search_events',
    'Search for events by topic, date, or location',
    {
      query: z.string().describe('Search query text'),
      location: z.string().optional().describe('City or venue name filter'),
      startDate: z.string().optional().describe('ISO 8601 date filter start'),
      endDate: z.string().optional().describe('ISO 8601 date filter end'),
    },
    async ({ query, location, startDate, endDate }) => {
      let q = supabase
        .from('events')
        .select('event_id, event_slug, event_title, event_start, event_end, event_city, event_country_code, listing_intro, event_logo')
        .eq('is_live_in_production', true)
        .ilike('event_title', `%${query}%`)
        .order('event_start', { ascending: true })
        .limit(20)

      if (location) q = q.ilike('event_city', `%${location}%`)
      if (startDate) q = q.gte('event_start', startDate)
      if (endDate) q = q.lte('event_start', endDate)

      const { data: events, error } = await q

      if (error) {
        return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(events || [], null, 2),
        }],
      }
    },
  )

  server.tool(
    'get_event',
    'Get full details for a specific event by ID or slug',
    {
      identifier: z.string().describe('Event ID or URL slug'),
    },
    async ({ identifier }) => {
      let event = null

      const { data: bySlug } = await supabase
        .from('events')
        .select('*')
        .eq('event_slug', identifier)
        .eq('is_live_in_production', true)
        .maybeSingle()

      event = bySlug

      if (!event) {
        const { data: byId } = await supabase
          .from('events')
          .select('*')
          .eq('event_id', identifier)
          .eq('is_live_in_production', true)
          .maybeSingle()

        event = byId
      }

      if (!event) {
        return { content: [{ type: 'text' as const, text: 'Event not found' }], isError: true }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(event, null, 2),
        }],
      }
    },
  )

  server.tool(
    'register',
    'Register the authenticated user for an event',
    {
      eventId: z.string().describe('Event ID to register for'),
    },
    async ({ eventId }) => {
      if (!token) {
        return {
          content: [{ type: 'text' as const, text: 'Authentication required. Please provide a JWT Bearer token.' }],
          isError: true,
        }
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        return {
          content: [{ type: 'text' as const, text: 'Invalid or expired authentication token.' }],
          isError: true,
        }
      }

      const { data: event } = await supabase
        .from('events')
        .select('id, event_id, event_title, enable_registration')
        .eq('event_id', eventId)
        .eq('is_live_in_production', true)
        .maybeSingle()

      if (!event) {
        return { content: [{ type: 'text' as const, text: 'Event not found.' }], isError: true }
      }

      if (!event.enable_registration) {
        return { content: [{ type: 'text' as const, text: 'Registration is not open for this event.' }], isError: true }
      }

      const { data: existing } = await supabase
        .from('registrations')
        .select('id')
        .eq('event_id', event.event_id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (existing) {
        return { content: [{ type: 'text' as const, text: `Already registered for ${event.event_title}.` }] }
      }

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
        return { content: [{ type: 'text' as const, text: `Registration failed: ${regError.message}` }], isError: true }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: true, confirmationId: registration.id, event: event.event_title }),
        }],
      }
    },
  )

  server.tool(
    'list_calendars',
    'List available event calendars',
    {},
    async () => {
      const { data: calendars, error } = await supabase
        .from('calendars')
        .select('slug, name, description')
        .eq('is_active', true)
        .order('name')

      if (error) {
        return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(calendars || [], null, 2),
        }],
      }
    },
  )

  // Prompts
  server.prompt(
    'discover_events',
    'What events are coming up that match my interests?',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: 'What events are coming up that might interest me? Please search for upcoming events and provide recommendations.',
        },
      }],
    }),
  )

  server.prompt(
    'plan_attendance',
    'Help me plan which events to attend this month',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: 'Help me plan which events to attend this month. Search for upcoming events in the next 30 days and help me prioritize.',
        },
      }],
    }),
  )

  return server
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  const server = createMcpServer(token)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })

  await server.connect(transport)

  // The web-standard transport takes a Request and returns a Response
  const response = await transport.handleRequest(req as unknown as Request)

  return response
}

export async function GET() {
  return new Response(null, { status: 405 })
}

export async function DELETE() {
  return new Response(null, { status: 200 })
}
