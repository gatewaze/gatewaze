import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { sendEmail as sendViaProvider } from '../_shared/email.ts';

export default async function(req: Request) {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let to = '';
  let subject = '';

  try {
    const body = await req.json();
    to = body.to;
    subject = body.subject;
    const { html, text } = body;

    if (!to || !subject || !html) {
      return new Response(
        JSON.stringify({ error: 'to, subject, and html are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    await sendViaProvider({ to, subject, html, text });

    // Log success
    try {
      const supabase = createServiceClient();
      await supabase.from('email_logs').insert({
        to_email: to,
        subject,
        provider: Deno.env.get('EMAIL_PROVIDER') ?? 'unknown',
        status: 'sent',
        sent_at: new Date().toISOString(),
      });
    } catch {
      console.error('Failed to log email send');
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    // Log failure
    try {
      const supabase = createServiceClient();
      await supabase.from('email_logs').insert({
        to_email: to || 'unknown',
        subject: subject || 'unknown',
        provider: Deno.env.get('EMAIL_PROVIDER') ?? 'unknown',
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        sent_at: new Date().toISOString(),
      });
    } catch {
      // Don't fail if logging fails
    }

    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}
