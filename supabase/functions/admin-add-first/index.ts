import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { sendEmail, isEmailConfigured } from '../_shared/email.ts';
import { claimFailureResponse, shouldReleaseClaim, STALE_CLAIM_THRESHOLD_MS } from '../_shared/onboarding-gates.ts';

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

  // Claim bookkeeping for the outer catch: if the claim was taken but no
  // admin got created, the claim must be released or onboarding bricks.
  // The claim VALUE is this attempt's token, and the release is scoped to
  // it: a zombie request whose claim was swept and re-taken by a newer
  // attempt must not delete the newer attempt's live claim.
  let claimHeld = false;
  let adminCreated = false;
  const claimToken = `${new Date().toISOString()} ${crypto.randomUUID()}`;
  const releaseClaim = async () => {
    try {
      const { error } = await supabase
        .from('platform_settings')
        .delete()
        .eq('key', 'onboarding_admin_claim')
        .eq('value', claimToken);
      if (error) {
        console.error(
          'Failed to release the onboarding claim — clear the platform_settings row',
          `key='onboarding_admin_claim' manually:`,
          error.message,
        );
      }
    } catch (releaseErr) {
      console.error(
        'Onboarding claim release threw — clear the platform_settings row',
        `key='onboarding_admin_claim' manually:`,
        releaseErr,
      );
    }
  };

  try {
    const { name, email } = JSON.parse(body!);

    if (!name || !email) {
      return new Response(
        JSON.stringify({ error: 'Name and email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // This function mints a super_admin and runs unauthenticated, because it
    // has to work before any account exists. It is therefore only safe while
    // the instance is still un-onboarded. The temp setup admin created by
    // platform-setup is the one profile allowed to be present at this point;
    // any other admin profile means onboarding already finished, and this
    // endpoint must refuse. Without this check, anyone who can reach the
    // function on a deployed instance can create themselves an administrator.
    const { data: realAdmins, error: adminCheckError } = await supabase
      .from('admin_profiles')
      .select('id')
      .not('user_id', 'is', null)
      .neq('email', SETUP_EMAIL)
      .limit(1);

    if (adminCheckError) {
      return new Response(
        JSON.stringify({ error: 'Could not verify setup state' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (realAdmins && realAdmins.length > 0) {
      return new Response(
        JSON.stringify({ error: 'This instance has already been configured.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // The admin-exists check above is check-then-act: two simultaneous
    // requests on a fresh install could both pass it and both mint a
    // super_admin. platform_settings.key is the table's primary key, so this
    // plain INSERT (not upsert) is an atomic claim that exactly one caller
    // can win; everyone else gets a conflict and is refused. The claim row
    // is removed on the failure paths below so a legitimate retry works; on
    // success it stays, which is safe (readers look up known keys only) and
    // deliberate (deleting it would reopen the race).
    //
    // A runtime kill between the claim and the profile insert would strand
    // the claim and brick onboarding, so first sweep a stale claim: one
    // older than STALE_CLAIM_THRESHOLD_MS with (per the check above) still
    // no real admin means an abandoned attempt, not a concurrent one. The
    // threshold deliberately sits well beyond the runtime's 300s worker
    // timeout; see onboarding-gates.ts. A failed sweep must be visible:
    // if it silently fails, the next insert 409s with a message claiming
    // setup is underway when nothing is.
    const { error: sweepError } = await supabase
      .from('platform_settings')
      .delete()
      .eq('key', 'onboarding_admin_claim')
      .lt('created_at', new Date(Date.now() - STALE_CLAIM_THRESHOLD_MS).toISOString());
    if (sweepError) {
      console.error(
        'Stale onboarding-claim sweep failed (a later 409 may be spurious):',
        sweepError.message,
      );
    }

    // The value is this attempt's token — a timestamp plus a random
    // suffix, deliberately NOT the email: platform_settings is
    // anon-readable (anyone_select_platform_settings in 00006), and this
    // row outlives onboarding. The timestamp half documents when setup
    // ran; the random half makes the release owner-scoped.
    const { error: claimError } = await supabase
      .from('platform_settings')
      .insert({ key: 'onboarding_admin_claim', value: claimToken });

    if (claimError) {
      // 23505 = unique violation: someone else holds the claim. Anything
      // else is a real error, not evidence that setup happened — and the
      // client 500 hides the detail, so the log is the only trace.
      const { status, message } = claimFailureResponse(claimError.code);
      if (status === 500) {
        console.error('Onboarding claim insert failed:', claimError.code, claimError.message);
      }
      return new Response(
        JSON.stringify({ error: message }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    claimHeld = true;

    // Check if email is configured
    const emailReady = isEmailConfigured();

    // Create new auth user
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name, role: 'super_admin' },
    });

    if (createError) {
      await releaseClaim();
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
      // Clean up auth user if profile creation fails. A failed cleanup
      // leaves an orphan auth user holding the email, and every retry
      // with it then fails at createUser — so the failure must be loud.
      const { error: cleanupError } = await supabase.auth.admin.deleteUser(newUser.user.id);
      if (cleanupError) {
        console.error(
          'Failed to delete the orphaned auth user after a profile-insert failure;',
          'retries with this email will fail until it is removed:',
          cleanupError.message,
        );
      }
      await releaseClaim();
      return new Response(
        JSON.stringify({ error: `Failed to create admin profile: ${profileError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    adminCreated = true;

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
    // An unexpected throw after the claim but before the admin exists must
    // not strand the claim (the stale sweep is only a slow backstop).
    if (shouldReleaseClaim(claimHeld, adminCreated)) {
      await releaseClaim();
    }
    // After adminCreated, a throw came from a post-creation nicety (people
    // row, temp-admin cleanup, magic link). A bare 500 would invite a
    // retry that then 409s confusingly — say what actually happened.
    const message = adminCreated
      ? 'The admin account was created, but a later setup step failed. Sign in with the new account.'
      : err instanceof Error
        ? err.message
        : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}

export default handler;
Deno.serve(handler);
