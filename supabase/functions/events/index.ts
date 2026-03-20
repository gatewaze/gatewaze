import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export default async function(req: Request) {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
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

    console.log('📤 Fetching all events from database...')

    // Fetch all events from the database with pagination to handle large datasets
    let allEvents: any[] = []
    let from = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
      const { data: events, error } = await supabaseClient
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
        `)
        .order('event_start', { ascending: false })
        .range(from, from + pageSize - 1)

      if (error) {
        console.error('❌ Error fetching events:', error)
        throw error
      }

      if (events && events.length > 0) {
        allEvents = allEvents.concat(events)
        from += events.length
        hasMore = events.length === pageSize
        console.log(`  📄 Fetched ${events.length} events (total: ${allEvents.length})`)
      } else {
        hasMore = false
      }
    }

    const events = allEvents

    // Transform to camelCase for consistency with export script
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

    console.log(`✅ Successfully fetched ${transformedEvents.length} events`)

    return new Response(
      JSON.stringify({
        success: true,
        count: transformedEvents.length,
        events: transformedEvents,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    )
  } catch (error) {
    console.error('❌ Error in events function:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to fetch events',
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
