import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { sendEmail, isEmailConfigured } from '../_shared/email.ts';

const SETUP_EMAIL = 'admin@setup.localhost';

async function handler(req: Request) {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // GET (or POST without body) returns email configuration status for the onboarding UI.
  // supabase.functions.invoke() sends POST by default, so we also detect an empty
  // body as a config check to support both GET and invoke({ method: 'GET' }).
  const body = req.method === 'POST' ? await req.text() : null;

  if (req.method === 'GET' || (req.method === 'POST' && !body)) {
    return new Response(
      JSON.stringify({ emailConfigured: isEmailConfigured() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createServiceClient();

  try {
    const { name, email } = JSON.parse(body!);

    if (!name || !email) {
      return new Response(
        JSON.stringify({ error: 'Name and email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Check if email is configured
    const emailReady = isEmailConfigured();

    // Create new auth user
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name, role: 'super_admin' },
    });

    if (createError) {
      return new Response(
        JSON.stringify({ error: `Failed to create user: ${createError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Create admin profile for new user
    const { error: profileError } = await supabase
      .from('admin_profiles')
      .insert({
        user_id: newUser.user.id,
        email,
        name,
        role: 'super_admin',
        is_active: true,
      });

    if (profileError) {
      // Clean up auth user if profile creation fails
      await supabase.auth.admin.deleteUser(newUser.user.id);
      return new Response(
        JSON.stringify({ error: `Failed to create admin profile: ${profileError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Create people record so admin appears on the People page
    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || name;
    const lastName = nameParts.slice(1).join(' ') || '';

    const { error: peopleError } = await supabase
      .from('people')
      .insert({
        email,
        auth_user_id: newUser.user.id,
        attributes: {
          first_name: firstName,
          last_name: lastName,
        },
      });

    if (peopleError) {
      console.error('Failed to create people record (non-fatal):', peopleError.message);
    }

    // Delete temp setup admin
    const { data: tempProfile } = await supabase
      .from('admin_profiles')
      .select('user_id')
      .eq('email', SETUP_EMAIL)
      .maybeSingle();

    if (tempProfile?.user_id) {
      await supabase.auth.admin.deleteUser(tempProfile.user_id);
      await supabase
        .from('admin_profiles')
        .delete()
        .eq('email', SETUP_EMAIL);
    }

    // Mark onboarding step so the guard redirects to module selection
    await supabase
      .from('platform_settings')
      .upsert({ key: 'onboarding_step', value: 'admin_created' }, { onConflict: 'key' });

    // Generate magic link for the new admin, redirecting back to the calling app
    const origin = req.headers.get('origin') || '';
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: origin ? { redirectTo: origin } : undefined,
    });

    // Ensure redirect_to points to the admin app
    let magicLink = linkData?.properties?.action_link;
    if (magicLink && origin) {
      const url = new URL(magicLink);
      url.searchParams.set('redirect_to', origin);
      magicLink = url.toString();
    }

    // If email is configured, send welcome email; otherwise return magic link directly
    if (emailReady && magicLink) {
      try {
        const { data: appNameSetting } = await supabase
          .from('platform_settings')
          .select('value')
          .eq('key', 'app_name')
          .maybeSingle();

        const appName = appNameSetting?.value || 'Gatewaze';

        await sendEmail({
          to: email,
          subject: `Welcome to ${appName} — Sign in to get started`,
          html: `
            <h2>Welcome to ${appName}!</h2>
            <p>Hi ${name},</p>
            <p>Your admin account has been created. Click the link below to sign in:</p>
            <p><a clicktracking="off" href="${magicLink}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Sign In</a></p>
            <p>Or copy and paste this URL into your browser:</p>
            <p style="word-break:break-all;color:#6b7280;"><a clicktracking="off" href="${magicLink}" style="color:#6b7280;">${magicLink}</a></p>
            <p style="color:#9ca3af;font-size:12px;">This link expires in 1 hour.</p>
          `,
          text: `Welcome to ${appName}!\n\nHi ${name},\n\nYour admin account has been created. Sign in here:\n${magicLink}\n\nThis link expires in 1 hour.`,
        });
      } catch (emailErr) {
        // Don't fail the whole operation if email sending fails
        console.error('Failed to send welcome email:', emailErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, magicLink: emailReady ? undefined : magicLink }),
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
