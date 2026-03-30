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

    // Check email is configured
    const configured = isEmailConfigured();
    if (!configured) {
      return new Response(
        JSON.stringify({ error: 'Email sending is not configured. Please contact your administrator.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Generate magic link, redirecting back to the calling app
    const origin = req.headers.get('origin') || '';
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: normalizedEmail,
      options: origin ? { redirectTo: origin } : undefined,
    });

    if (linkError || !linkData?.properties?.action_link) {
      return new Response(
        JSON.stringify({ error: 'Failed to generate login link' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Ensure redirect_to points to the admin app
    let magicLink = linkData.properties.action_link;
    if (origin) {
      const url = new URL(magicLink);
      url.searchParams.set('redirect_to', origin);
      magicLink = url.toString();
    }

    // Send the email
    await sendEmail({
      to: normalizedEmail,
      subject: 'Your Sign-In Link',
      html: `
        <h2>Sign In</h2>
        <p>Click the link below to sign in to your account:</p>
        <p><a href="${magicLink}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">Sign In</a></p>
        <p>Or copy this URL into your browser:</p>
        <p style="word-break:break-all;color:#666;">${magicLink}</p>
        <p style="color:#999;font-size:12px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      `,
      text: `Sign in to your account:\n\n${magicLink}\n\nThis link expires in 1 hour.`,
    });

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
