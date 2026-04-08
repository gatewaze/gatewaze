import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { isEmailConfigured, sendEmail } from '../_shared/email.ts';

async function handler(req: Request) {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createServiceClient();

  try {
    const { email, redirectTo } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Verify admin exists and is active (case-insensitive email match)
    const { data: profile } = await supabase
      .from('admin_profiles')
      .select('email, name, is_active')
      .ilike('email', normalizedEmail)
      .eq('is_active', true)
      .maybeSingle();

    if (!profile) {
      return new Response(
        JSON.stringify({ error: 'No active admin account found for this email' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // CI mode: generate magic link and return it directly (for testing)
    const ciMode = Deno.env.get('CI_MODE')?.toLowerCase() === 'true';
    if (ciMode) {
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: normalizedEmail,
        options: { redirectTo: redirectTo || undefined },
      });

      if (linkError || !linkData) {
        return new Response(
          JSON.stringify({ error: linkError?.message || 'Failed to generate magic link' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          magicLink: linkData.properties?.action_link,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Always return verifyOnly — the client calls signInWithOtp directly
    // which respects emailRedirectTo (redirects to admin.* not portal).
    // Using generateLink + sendEmail here would bypass emailRedirectTo and
    // redirect to the Supabase Site URL (the portal) instead.
    return new Response(
      JSON.stringify({ success: true, verifyOnly: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('admin-send-magic-link error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}

export default handler;
Deno.serve(handler);
