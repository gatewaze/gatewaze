import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';

const SETUP_EMAIL = 'admin@setup.localhost';

async function handler(req: Request) {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();

  // GET — check if setup is needed
  if (req.method === 'GET') {
    const { data } = await supabase
      .from('admin_profiles')
      .select('id')
      .not('user_id', 'is', null)
      .limit(1);

    return new Response(
      JSON.stringify({ needsSetup: !data || data.length === 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // POST — perform first-time setup
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    // Check if already configured
    const { data: existingAdmins } = await supabase
      .from('admin_profiles')
      .select('id')
      .not('user_id', 'is', null)
      .limit(1);

    if (existingAdmins && existingAdmins.length > 0) {
      return new Response(
        JSON.stringify({ status: 'already_configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { appName, namespace } = await req.json();

    // Create temp auth user for initial setup
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: SETUP_EMAIL,
      email_confirm: true,
      user_metadata: { name: 'Admin', role: 'super_admin' },
    });

    if (authError) {
      return new Response(
        JSON.stringify({ error: authError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const userId = authData.user.id;

    // Create admin profile
    const { error: insertError } = await supabase
      .from('admin_profiles')
      .insert({
        user_id: userId,
        email: SETUP_EMAIL,
        name: 'Admin',
        role: 'super_admin',
        is_active: true,
      });

    if (insertError) {
      await supabase.auth.admin.deleteUser(userId);
      return new Response(
        JSON.stringify({ error: `Profile creation failed: ${insertError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Save app settings
    const finalAppName = appName?.trim() || 'Gatewaze';
    const finalNamespace = namespace?.trim() || toNamespace(finalAppName);
    await supabase
      .from('platform_settings')
      .upsert([
        { key: 'app_name', value: finalAppName },
        { key: 'namespace', value: finalNamespace },
        { key: 'setup_complete', value: 'true' },
      ], { onConflict: 'key' });

    // Generate magic link for auto-login, redirecting back to the calling app
    const origin = req.headers.get('origin') || '';
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: SETUP_EMAIL,
      options: origin ? { redirectTo: origin } : undefined,
    });

    // Rewrite redirect_to in the link to ensure it points to the admin app
    let magicLink = linkData?.properties?.action_link;
    if (magicLink && origin) {
      const url = new URL(magicLink);
      url.searchParams.set('redirect_to', origin);
      magicLink = url.toString();
    }

    return new Response(
      JSON.stringify({ status: 'ok', magicLink }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}

function toNamespace(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default handler;
Deno.serve(handler);
