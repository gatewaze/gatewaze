import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';

interface SendGridEvent {
  email: string;
  event: string;
  sg_message_id?: string;
  timestamp?: number;
  reason?: string;
  bounce_classification?: string;
  url?: string;
  useragent?: string;
  ip?: string;
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
    const events: SendGridEvent[] = await req.json();

    if (!Array.isArray(events)) {
      return new Response(
        JSON.stringify({ error: 'Expected an array of events' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createServiceClient();
    const results: { processed: number; errors: number } = { processed: 0, errors: 0 };

    for (const event of events) {
      // Map SendGrid event types to our status values
      const statusMap: Record<string, string> = {
        processed: 'processed',
        delivered: 'delivered',
        bounce: 'bounced',
        deferred: 'deferred',
        dropped: 'dropped',
        open: 'opened',
        click: 'clicked',
        spamreport: 'spam',
        unsubscribe: 'unsubscribed',
      };

      const status = statusMap[event.event] ?? event.event;

      // Clean the SendGrid message ID (remove the filter ID suffix)
      const messageId = event.sg_message_id
        ? event.sg_message_id.split('.')[0]
        : null;

      if (!messageId && !event.email) {
        results.errors++;
        continue;
      }

      try {
        // Try to find and update the email log by message_id first
        if (messageId) {
          const { error: updateError } = await supabase
            .from('email_logs')
            .update({
              status,
              delivery_status: event.event,
              bounce_reason: event.reason ?? null,
              bounce_classification: event.bounce_classification ?? null,
              opened_at: event.event === 'open' ? new Date((event.timestamp ?? 0) * 1000).toISOString() : undefined,
              clicked_at: event.event === 'click' ? new Date((event.timestamp ?? 0) * 1000).toISOString() : undefined,
              clicked_url: event.url ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq('message_id', messageId);

          if (updateError) {
            // If no matching message_id found, insert a webhook event log
            await supabase.from('email_webhook_events').insert({
              provider: 'sendgrid',
              event_type: event.event,
              email: event.email,
              message_id: messageId,
              payload: event,
              received_at: new Date().toISOString(),
            });
          }
        } else {
          // No message ID, log as webhook event
          await supabase.from('email_webhook_events').insert({
            provider: 'sendgrid',
            event_type: event.event,
            email: event.email,
            message_id: null,
            payload: event,
            received_at: new Date().toISOString(),
          });
        }

        results.processed++;
      } catch {
        results.errors++;
        console.error(`Failed to process webhook event for ${event.email}`);
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Webhook events processed',
        processed: results.processed,
        errors: results.errors,
        total: events.length,
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
