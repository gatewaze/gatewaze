import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EventsSearchParams {
  month?: string        // Format: YYYY-MM (e.g., "2026-01")
  region?: string       // Region code: eu, na, as, sa, af, oc, on (online)
  type?: string         // Event type: conference, meetup, webinar, workshop
  topics?: string[]     // Array of topic strings
  search?: string       // Free text search
  limit?: number        // Max results (default 100)
  offset?: number       // Pagination offset
}

export default async function(req: Request) {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)

    // Parse query parameters
    const params: EventsSearchParams = {
      month: url.searchParams.get('month') || undefined,
      region: url.searchParams.get('region') || undefined,
      type: url.searchParams.get('type') || undefined,
      topics: url.searchParams.get('topics')?.split(',').filter(Boolean) || undefined,
      search: url.searchParams.get('search') || undefined,
      limit: parseInt(url.searchParams.get('limit') || '100'),
      offset: parseInt(url.searchParams.get('offset') || '0'),
    }

    console.log('📤 Events search with params:', JSON.stringify(params))

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

    // Build the query
    let query = supabaseClient
      .from('events')
      .select(`
        id,
        event_id,
        event_title,
        event_link,
        event_logo,
        event_start,
        event_end,
        event_city,
        event_country_code,
        event_region,
        event_location,
        event_type,
        listing_intro,
        event_topics,
        offer_result,
        offer_close_display,
        offer_ticket_details,
        offer_value,
        offer_slug,
        offer_close_date,
        event_topics_updated_at,
        screenshot_url,
        is_live_in_production
      `, { count: 'exact' })

    // Filter by month (events that overlap with the specified month)
    if (params.month) {
      const [year, month] = params.month.split('-').map(Number)
      const startOfMonth = new Date(year, month - 1, 1).toISOString()
      const endOfMonth = new Date(year, month, 0, 23, 59, 59).toISOString()

      // Event overlaps with month if: event_start <= endOfMonth AND event_end >= startOfMonth
      query = query
        .lte('event_start', endOfMonth)
        .gte('event_end', startOfMonth)
    } else {
      // Default: only future events (event_end >= today)
      const today = new Date().toISOString().split('T')[0]
      query = query.gte('event_end', today)
    }

    // Filter by region
    if (params.region && params.region !== 'all') {
      query = query.eq('event_region', params.region)
    }

    // Filter by event type
    if (params.type && params.type !== 'all') {
      query = query.eq('event_type', params.type)
    }

    // Filter by topics (any match)
    if (params.topics && params.topics.length > 0) {
      // Use overlaps for array intersection
      query = query.overlaps('event_topics', params.topics)
    }

    // Free text search across multiple fields
    if (params.search && params.search.trim()) {
      const searchTerm = params.search.trim()
      // Use ilike for case-insensitive partial matching on title
      // Also search in city and topics
      query = query.or(`event_title.ilike.%${searchTerm}%,event_city.ilike.%${searchTerm}%,listing_intro.ilike.%${searchTerm}%`)
    }

    // Order by event start date
    query = query.order('event_start', { ascending: true })

    // Pagination
    query = query.range(params.offset, params.offset + params.limit - 1)

    const { data: events, error, count } = await query

    if (error) {
      console.error('❌ Error fetching events:', error)
      throw error
    }

    // Transform to camelCase for frontend consistency
    const transformedEvents = events?.map((event: any) => ({
      id: event.id,
      eventId: event.event_id,
      eventTitle: event.event_title,
      eventLink: event.event_link,
      eventLogo: event.event_logo,
      eventStart: event.event_start,
      eventEnd: event.event_end,
      eventCity: event.event_city,
      eventCountryCode: event.event_country_code,
      eventRegion: event.event_region,
      eventLocation: event.event_location,
      eventType: event.event_type,
      listingIntro: event.listing_intro,
      eventTopics: event.event_topics || [],
      offerResult: event.offer_result,
      offerCloseDisplay: event.offer_close_display,
      offerTicketDetails: event.offer_ticket_details,
      offerValue: event.offer_value,
      offerSlug: event.offer_slug,
      offerCloseDate: event.offer_close_date,
      eventTopicsUpdatedAt: event.event_topics_updated_at,
      screenshotUrl: event.screenshot_url,
      isLiveInProduction: event.is_live_in_production !== undefined ? event.is_live_in_production : true,
    })) || []

    console.log(`✅ Found ${transformedEvents.length} events (total: ${count})`)

    // Calculate cache TTL based on query type
    // Search queries: shorter cache (1 min)
    // Month/filter queries: longer cache (5 min)
    const cacheTTL = params.search ? 60 : 300

    return new Response(
      JSON.stringify({
        success: true,
        count: transformedEvents.length,
        total: count,
        events: transformedEvents,
        params: params, // Echo back params for debugging
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${cacheTTL}, s-maxage=${cacheTTL}, stale-while-revalidate=60`,
        },
      }
    )
  } catch (error) {
    console.error('❌ Error in events-search function:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to search events',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    )
  }
}
