import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';

export default async function(req: Request) {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const body = await req.json();
    const { email, first_name, last_name, bio, company, title, headshot_url, website, linkedin_url, twitter_url } = body;

    if (!email || !first_name || !last_name) {
      return new Response(
        JSON.stringify({ error: 'email, first_name, and last_name are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createServiceClient();

    // Check if speaker already exists by email
    const { data: existingSpeaker } = await supabase
      .from('speakers')
      .select('speaker_id')
      .eq('email', email)
      .maybeSingle();

    if (existingSpeaker) {
      // Update existing speaker
      const { data: updated, error: updateError } = await supabase
        .from('speakers')
        .update({
          first_name,
          last_name,
          bio: bio ?? null,
          company: company ?? null,
          title: title ?? null,
          headshot_url: headshot_url ?? null,
          website: website ?? null,
          linkedin_url: linkedin_url ?? null,
          twitter_url: twitter_url ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('speaker_id', existingSpeaker.speaker_id)
        .select()
        .single();

      if (updateError) {
        return new Response(
          JSON.stringify({ error: updateError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ speaker: updated, created: false }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Create new speaker
    const { data: newSpeaker, error: createError } = await supabase
      .from('speakers')
      .insert({
        email,
        first_name,
        last_name,
        bio: bio ?? null,
        company: company ?? null,
        title: title ?? null,
        headshot_url: headshot_url ?? null,
        website: website ?? null,
        linkedin_url: linkedin_url ?? null,
        twitter_url: twitter_url ?? null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError) {
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ speaker: newSpeaker, created: true }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}
