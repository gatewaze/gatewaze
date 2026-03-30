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

// Single-instance configuration — uses the local Supabase project
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface SendGridEvent {
  email: string;
  timestamp: number;
  event: string;
  'smtp-id'?: string;
  'sg_message_id'?: string;
  url?: string; // for click events
  reason?: string; // for bounce/dropped events
  type?: string; // for bounce events
  from?: string; // sender email address (not always present)
  category?: string[]; // custom categories we can use for routing
}

/**
 * Get a Supabase client for the local instance
 */
function getSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

/**
 * Find an email log entry by SendGrid message ID
 */
async function findEmailLog(messageId: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('email_logs')
    .select('*')
    .eq('sendgrid_message_id', messageId)
    .limit(1);

  if (!error && data && data.length > 0) {
    return { emailLog: data[0], client };
  }

  return null;
}

async function handler(req: Request) {
  try {
    // Handle OPTIONS for CORS
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET',
          'Access-Control-Allow-Headers': 'content-type',
        }
      });
    }

    // Handle GET for webhook verification (SendGrid may ping this)
    if (req.method === 'GET') {
      return new Response(
        JSON.stringify({ status: 'ok', message: 'SendGrid webhook endpoint is active' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Parse SendGrid events (they send an array of events)
    const events: SendGridEvent[] = await req.json();

    console.log(`Received ${events.length} SendGrid events`);

    for (const event of events) {
      console.log('Processing event:', event.event, 'for', event.email);

      // Extract message ID (remove angle brackets if present)
      let messageId = event.sg_message_id || event['smtp-id'];
      if (messageId) {
        messageId = messageId.replace(/[<>]/g, '');
        // SendGrid message IDs in webhooks have format: baseId.additionalMetadata
        // We need to extract just the base ID to match what's stored in the database
        // Example: "VIyuEvzhRtmXWylt1Mlgjg.recvd-65696df74f-sr99c-1-691712DD-5A.0" -> "VIyuEvzhRtmXWylt1Mlgjg"
        const parts = messageId.split('.');
        messageId = parts[0];
      }

      if (!messageId) {
        console.warn('No message ID found for event, skipping:', event);
        continue;
      }

      const result = await findEmailLog(messageId);

      if (!result) {
        console.warn('No email log found for message ID:', messageId);
        continue;
      }

      const { emailLog, client: supabaseClient } = result;

      const updateData: any = {};

      // Process different event types
      switch (event.event) {
        case 'delivered':
          updateData.delivered_at = new Date(event.timestamp * 1000).toISOString();
          updateData.status = 'delivered';
          break;

        case 'open':
          if (!emailLog.opened_at) {
            updateData.opened_at = new Date(event.timestamp * 1000).toISOString();
          }
          break;

        case 'click':
          if (!emailLog.first_clicked_at) {
            updateData.first_clicked_at = new Date(event.timestamp * 1000).toISOString();
          }
          updateData.click_count = (emailLog.click_count || 0) + 1;
          break;

        case 'bounce':
          updateData.bounced_at = new Date(event.timestamp * 1000).toISOString();
          updateData.bounce_reason = event.reason || event.type || 'Unknown';
          updateData.status = 'bounced';
          break;

        case 'dropped':
          updateData.status = 'dropped';
          updateData.bounce_reason = event.reason || 'Dropped by SendGrid';
          break;

        case 'spamreport':
          updateData.spam_reported_at = new Date(event.timestamp * 1000).toISOString();
          break;

        case 'unsubscribe':
          updateData.unsubscribed_at = new Date(event.timestamp * 1000).toISOString();
          break;

        default:
          console.log('Unknown event type:', event.event);
      }

      // Update the email log if we have data to update
      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabaseClient
          .from('email_logs')
          .update(updateData)
          .eq('id', emailLog.id);

        if (updateError) {
          console.error('Error updating email log:', updateError);
        } else {
          console.log('Successfully updated email log for event:', event.event);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: events.length }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );

  } catch (error: any) {
    console.error('Error processing SendGrid webhook:', error);

    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error.message
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );
  }
}

export default handler;
if (import.meta.main) Deno.serve(handler);
