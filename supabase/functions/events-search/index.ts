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
    const q = url.searchParams.get('q');
    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);

    if (!q || q.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Query parameter q is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createServiceClient();
    const searchTerm = q.trim();

    // Try pg_trgm similarity search via RPC first, fall back to ilike
    let data = null;
    let error = null;

    // Attempt fuzzy search using a database function if available
    const { data: fuzzyData, error: fuzzyError } = await supabase.rpc('search_events', {
      search_term: searchTerm,
      result_limit: limit,
    });

    if (!fuzzyError && fuzzyData) {
      data = fuzzyData;
    } else {
      // Fall back to ilike pattern matching
      const pattern = `%${searchTerm}%`;
      const { data: ilikeData, error: ilikeError } = await supabase
        .from('events')
        .select('event_id, event_title, event_description, event_start, start_time, event_location, venue, status, event_logo')
        .or(`event_title.ilike.${pattern},event_description.ilike.${pattern}`)
        .eq('status', 'published')
        .order('event_start', { ascending: true })
        .limit(limit);

      data = ilikeData;
      error = ilikeError;
    }

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        query: searchTerm,
        results: data ?? [],
        count: data?.length ?? 0,
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
