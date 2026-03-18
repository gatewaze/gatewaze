import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';

interface EmailRecipient {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface SendResult {
  to: string;
  success: boolean;
  messageId?: string;
  error?: string;
}

async function sendSingleEmail(recipient: EmailRecipient): Promise<SendResult> {
  const provider = Deno.env.get('EMAIL_PROVIDER') ?? 'sendgrid';
  const fromEmail = Deno.env.get('EMAIL_FROM') ?? 'noreply@gatewaze.com';

  if (provider === 'sendgrid') {
    const apiKey = Deno.env.get('SENDGRID_API_KEY');
    if (!apiKey) {
      return { to: recipient.to, success: false, error: 'SENDGRID_API_KEY not configured' };
    }

    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: [{ email: recipient.to }],
              subject: recipient.subject,
            },
          ],
          from: { email: fromEmail },
          content: [
            ...(recipient.text ? [{ type: 'text/plain', value: recipient.text }] : []),
            { type: 'text/html', value: recipient.html },
          ],
        }),
      });

      if (response.ok || response.status === 202) {
        const messageId = response.headers.get('X-Message-Id') ?? undefined;
        return { to: recipient.to, success: true, messageId };
      }

      const errorBody = await response.text();
      return { to: recipient.to, success: false, error: `SendGrid error (${response.status}): ${errorBody}` };
    } catch (err) {
      return { to: recipient.to, success: false, error: err instanceof Error ? err.message : 'Send failed' };
    }
  }

  return { to: recipient.to, success: false, error: `Unsupported provider: ${provider}` };
}

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
    const { recipients } = await req.json();

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return new Response(
        JSON.stringify({ error: 'recipients array is required and must not be empty' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Validate each recipient
    for (const r of recipients) {
      if (!r.to || !r.subject || !r.html) {
        return new Response(
          JSON.stringify({ error: 'Each recipient must have to, subject, and html fields' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    const supabase = createServiceClient();
    const results: SendResult[] = [];

    // Process emails sequentially to avoid rate limiting
    for (const recipient of recipients) {
      const result = await sendSingleEmail(recipient);
      results.push(result);

      // Log each email
      try {
        await supabase.from('email_logs').insert({
          to_email: recipient.to,
          subject: recipient.subject,
          provider: Deno.env.get('EMAIL_PROVIDER') ?? 'sendgrid',
          status: result.success ? 'sent' : 'failed',
          message_id: result.messageId ?? null,
          error_message: result.error ?? null,
          sent_at: new Date().toISOString(),
        });
      } catch {
        console.error(`Failed to log email to ${recipient.to}`);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({
        results,
        summary: {
          total: recipients.length,
          sent: successCount,
          failed: failureCount,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}
