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
    const { email } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Verify admin exists and is active
    const { data: profile } = await supabase
      .from('admin_profiles')
      .select('email, is_active')
      .eq('email', normalizedEmail)
      .eq('is_active', true)
      .maybeSingle();

    if (!profile) {
      return new Response(
        JSON.stringify({ error: 'No active admin account found for this email' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Send magic link via Supabase Auth (respects emailRedirectTo for correct redirect)
    const origin = req.headers.get('origin') || '';
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: origin || undefined,
        shouldCreateUser: false,
      },
    });

    if (otpError) {
      return new Response(
        JSON.stringify({ error: otpError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}

export default handler;
if (import.meta.main) Deno.serve(handler);
