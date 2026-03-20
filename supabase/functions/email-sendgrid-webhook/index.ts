import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * SendGrid Webhook Handler - Multi-Brand Support
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
 * This single webhook handles events from multiple brands by routing based on
 * the sender email domain.
 *
 * Documentation: https://docs.sendgrid.com/for-developers/tracking-events/event
 */

// Brand configuration - maps email domains to Supabase projects
const BRAND_CONFIG = {
  'mlops.community': {
    supabaseUrl: 'https://db.mlops.community',
    supabaseKey: Deno.env.get('MLOPS_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  },
  'tech.tickets': {
    supabaseUrl: 'https://data.tech.tickets',
    supabaseKey: Deno.env.get('TECHTICKETS_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  },
};

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
 * Determine which brand database to use based on sender email domain
 */
function getBrandConfig(fromEmail?: string) {
  if (!fromEmail) {
    console.warn('No from email found, defaulting to first brand');
    return Object.values(BRAND_CONFIG)[0];
  }

  const domain = fromEmail.split('@')[1];
  const config = BRAND_CONFIG[domain as keyof typeof BRAND_CONFIG];

  if (!config) {
    console.warn(`Unknown domain: ${domain}, defaulting to first brand`);
    return Object.values(BRAND_CONFIG)[0];
  }

  return config;
}

/**
 * Get the from email address from the email log in the database
 * We need to query both databases to find which one has this email
 */
async function findEmailLog(messageId: string) {
  for (const [brand, config] of Object.entries(BRAND_CONFIG)) {
    const client = createClient(config.supabaseUrl, config.supabaseKey!);

    const { data, error } = await client
      .from('email_logs')
      .select('*')
      .eq('sendgrid_message_id', messageId)
      .limit(1);

    if (!error && data && data.length > 0) {
      return { emailLog: data[0], client, brand };
    }
  }

  return null;
}

export default async function(req: Request) {
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

      // Find the email log across all brand databases
      const result = await findEmailLog(messageId);

      if (!result) {
        console.warn('No email log found for message ID across any brand:', messageId);
        continue;
      }

      const { emailLog, client: supabaseClient, brand } = result;
      console.log(`Found email in ${brand} database`);

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
