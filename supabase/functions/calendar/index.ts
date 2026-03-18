import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';

export default async function(req: Request) {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get('slug');
    const id = url.searchParams.get('id');

    if (!slug && !id) {
      return new Response(
        JSON.stringify({ error: 'Either slug or id query parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createServiceClient();

    // Fetch the calendar
    let calendarQuery = supabase
      .from('calendars')
      .select('*');

    if (slug) {
      calendarQuery = calendarQuery.eq('slug', slug);
    } else if (id) {
      // Support both numeric id and CAL-XXX format
      calendarQuery = calendarQuery.eq('calendar_id', id);
    }

    const { data: calendar, error: calendarError } = await calendarQuery
      .eq('is_public', true)
      .eq('is_active', true)
      .single();

    if (calendarError || !calendar) {
      return new Response(
        JSON.stringify({ error: 'Calendar not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fetch events linked to this calendar via the junction table
    const { data: calendarEvents, error: eventsError } = await supabase
      .from('calendar_events')
      .select(`
        events (
          event_id,
          title,
          description,
          start_date,
          start_time,
          end_date,
          end_time,
          location,
          venue,
          status,
          image_url,
          tags
        )
      `)
      .eq('calendar_id', calendar.id);

    if (eventsError) {
      return new Response(
        JSON.stringify({ error: eventsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Extract events from the junction table join results
    const events = (calendarEvents ?? [])
      .map((row: Record<string, unknown>) => row.events)
      .filter(Boolean);

    return new Response(
      JSON.stringify({
        calendar,
        events,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}
