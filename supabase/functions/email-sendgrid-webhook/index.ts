import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * SendGrid Webhook Handler
 *
 * Handles SendGrid Event Webhook notifications for tracking email events:
 * - delivered
 * - open
 * - click
 * - bounce
 * - dropped
 * - spamreport
 * - unsubscribe
 *
 * Documentation: https://docs.sendgrid.com/for-developers/tracking-events/event
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface SendGridEvent {
  email: string;
  timestamp: number;
  event: string;
  'smtp-id'?: string;
  'sg_message_id'?: string;
  url?: string;
  reason?: string;
  type?: string;
  from?: string;
  category?: string[];
}

function getSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

/**
 * Find an email log entry by SendGrid message ID.
 * Queries email_send_log — the canonical table owned by the bulk-emailing module.
 */
async function findEmailLog(messageId: string) {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('email_send_log')
    .select('*')
    .eq('provider_message_id', messageId)
    .limit(1);

  if (!error && data && data.length > 0) {
    return { emailLog: data[0], client };
  }

  return null;
}

async function handler(req: Request) {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET',
          'Access-Control-Allow-Headers': 'content-type',
        }
      });
    }

    if (req.method === 'GET') {
      return new Response(
        JSON.stringify({ status: 'ok', message: 'SendGrid webhook endpoint is active' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const events: SendGridEvent[] = await req.json();
    console.log(`Received ${events.length} SendGrid events`);

    let processed = 0;

    for (const event of events) {
      console.log('Processing event:', event.event, 'for', event.email);

      // Extract base message ID
      let messageId = event.sg_message_id || event['smtp-id'];
      if (messageId) {
        messageId = messageId.replace(/[<>]/g, '');
        // SendGrid webhook IDs have format: baseId.additionalMetadata
        // Extract just the base ID to match what's stored
        const parts = messageId.split('.');
        messageId = parts[0];
      }

      if (!messageId) {
        console.warn('No message ID found for event, skipping');
        continue;
      }

      const result = await findEmailLog(messageId);
      if (!result) {
        console.warn('No email log found for message ID:', messageId);
        continue;
      }

      const { emailLog, client: supabaseClient } = result;
      const eventTime = new Date(event.timestamp * 1000).toISOString();

      const updateData: Record<string, unknown> = {};

      switch (event.event) {
        case 'delivered':
          if (!emailLog.delivered_at) updateData.delivered_at = eventTime;
          updateData.status = 'delivered';
          break;
        case 'open':
          if (!emailLog.first_opened_at) updateData.first_opened_at = eventTime;
          break;
        case 'click':
          if (!emailLog.first_clicked_at) updateData.first_clicked_at = eventTime;
          break;
        case 'bounce':
          if (!emailLog.bounced_at) updateData.bounced_at = eventTime;
          updateData.failure_error = event.reason || event.type || 'Bounced';
          updateData.status = 'bounced';
          break;
        case 'dropped':
          if (!emailLog.dropped_at) updateData.dropped_at = eventTime;
          updateData.failure_error = event.reason || 'Dropped by SendGrid';
          updateData.status = 'permanently_failed';
          break;
        case 'spamreport':
          if (!emailLog.spam_reported_at) updateData.spam_reported_at = eventTime;
          break;
        case 'unsubscribe':
          if (!emailLog.unsubscribed_at) updateData.unsubscribed_at = eventTime;
          break;
      }

      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabaseClient
          .from('email_send_log')
          .update(updateData)
          .eq('id', emailLog.id);

        if (updateError) {
          console.error('Error updating email_send_log:', updateError);
        } else {
          processed++;
        }
      }
    }

    console.log(`Processed ${processed}/${events.length} events`);

    return new Response(
      JSON.stringify({ success: true, processed, total: events.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error processing SendGrid webhook:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export default handler;
Deno.serve(handler);
