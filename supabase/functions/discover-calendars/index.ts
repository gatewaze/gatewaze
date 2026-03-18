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
    const supabase = createServiceClient();

    // Fetch all public, active calendars
    const { data: calendars, error: calendarsError } = await supabase
      .from('calendars')
      .select('*')
      .eq('is_public', true)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (calendarsError) {
      return new Response(
        JSON.stringify({ error: calendarsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get event counts for each calendar
    const calendarsWithCounts = await Promise.all(
      (calendars ?? []).map(async (calendar) => {
        const { count, error: countError } = await supabase
          .from('calendar_events')
          .select('*', { count: 'exact', head: true })
          .eq('calendar_id', calendar.id);

        return {
          ...calendar,
          event_count: countError ? 0 : (count ?? 0),
        };
      }),
    );

    return new Response(
      JSON.stringify({ calendars: calendarsWithCounts }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}
