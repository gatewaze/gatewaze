import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { isEmailConfigured, sendEmail } from '../_shared/email.ts';
import { isCiModeAuthorized } from '../_shared/onboarding-gates.ts';

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

    // CI mode: generate the magic link and return it directly (local test
    // pipelines only). This function is public (verify_jwt off, CORS *), so
    // returning a working sign-in link for any active admin is account
    // takeover if CI_MODE is ever set on a deployed instance. The env flag
    // alone is therefore not enough: the caller must also present the
    // matching CI_MODE_SECRET (constant-time compare; gate logic unit-
    // tested via onboarding-gates). Unset secret = CI mode off.
    const ciModeFlag = Deno.env.get('CI_MODE');
    const ciMode = isCiModeAuthorized(ciModeFlag, Deno.env.get('CI_MODE_SECRET'), req.headers.get('x-ci-secret'));
    if (!ciMode && ciModeFlag?.toLowerCase() === 'true') {
      // A stack that sets CI_MODE but fails the gate silently behaves like
      // a normal stack, which is baffling to whoever set the flag. Say why
      // (never logging the secret itself).
      console.warn(
        '[admin-send-magic-link] CI_MODE is set but the direct-link path stayed off:',
        Deno.env.get('CI_MODE_SECRET') ? 'x-ci-secret header missing or mismatched' : 'CI_MODE_SECRET is not set',
      );
    }
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
