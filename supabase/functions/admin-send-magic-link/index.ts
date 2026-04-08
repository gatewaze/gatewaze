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

    // Check if platform email is configured
    if (isEmailConfigured()) {
      // Generate magic link via admin API
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

      const magicLink = linkData.properties?.action_link;
      const appName = Deno.env.get('GW_APP_NAME') || 'Gatewaze';
      const firstName = profile.name?.split(' ')[0] || '';

      // Send via platform email service
      await sendEmail({
        to: normalizedEmail,
        subject: `Sign in to ${appName}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
            <h2 style="margin: 0 0 16px;">Sign in to ${appName}</h2>
            <p style="color: #555; line-height: 1.6;">
              ${firstName ? `Hi ${firstName},` : 'Hi,'}<br><br>
              Click the button below to sign in to your admin account.
            </p>
            <div style="margin: 32px 0;">
              <a clicktracking="off" href="${magicLink}" style="display: inline-block; padding: 12px 32px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500;">
                Sign In
              </a>
            </div>
            <p style="color: #999; font-size: 13px; line-height: 1.5;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <a clicktracking="off" href="${magicLink}" style="color: #999; word-break: break-all;">${magicLink}</a>
            </p>
            <p style="color: #999; font-size: 13px;">This link expires in 1 hour.</p>
          </div>
        `,
        text: `Sign in to ${appName}\n\nClick here to sign in: ${magicLink}\n\nThis link expires in 1 hour.`,
      });

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fallback: no platform email configured — tell client to use signInWithOtp
    // (requires GoTrue SMTP to be configured separately)
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
