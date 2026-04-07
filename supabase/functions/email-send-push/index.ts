import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Import web-push for Deno
import webpush from 'npm:web-push@3.6.6';

// VAPID keys from environment (each Supabase project has its own brand's keys)
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')!;

// Set VAPID details
webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const handler = async (req: Request): Promise<Response> => {
  try {
    // CORS headers
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        }
      });
    }

    // Create Supabase client with service role
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { email, customer_id: person_id_param, notification } = await req.json();

    // Support both legacy 'customer_id' and new 'person_id' param names
    const person_id = person_id_param;

    if (!email && !person_id) {
      return new Response(
        JSON.stringify({ error: 'Email or person_id required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!notification || !notification.title || !notification.body) {
      return new Response(
        JSON.stringify({ error: 'Notification object with title and body required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get active push subscriptions for this user
    let query = supabaseClient
      .from('push_subscriptions')
      .select('*')
      .eq('is_active', true);

    if (email) {
      query = query.eq('email', email);
    } else if (person_id) {
      query = query.eq('person_id', person_id);
    }

    const { data: subscriptions, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch subscriptions', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('No active subscriptions found for:', email || person_id);
      return new Response(
        JSON.stringify({
          message: 'No active push subscriptions found',
          email: email,
          person_id: person_id
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${subscriptions.length} active subscriptions for ${email || person_id}`);

    // Prepare notification payload
    const notificationPayload = {
      title: notification.title,
      body: notification.body || notification.message || '',
      icon: notification.icon || '/img/favicon/android-icon-192x192.png',
      badge: notification.badge || '/img/favicon/android-icon-96x96.png',
      url: notification.url || '/',
      tag: notification.tag || 'default',
      requireInteraction: notification.requireInteraction || false,
      data: notification.data || {},
    };

    // Send push notification to all active subscriptions
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          await webpush.sendNotification(
            pushSubscription,
            JSON.stringify(notificationPayload)
          );

          console.log('Push sent successfully to:', sub.endpoint.substring(0, 50) + '...');

          return {
            success: true,
            endpoint: sub.endpoint.substring(0, 50) + '...',
            platform: sub.platform
          };
        } catch (error: any) {
          console.error('Push send error:', {
            endpoint: sub.endpoint.substring(0, 50) + '...',
            error: error.message,
            statusCode: error.statusCode,
          });

          // If subscription is invalid (410 Gone), mark as inactive
          if (error.statusCode === 410) {
            console.log('Marking subscription as inactive (410 Gone)');
            await supabaseClient
              .from('push_subscriptions')
              .update({
                is_active: false,
                unsubscribed_at: new Date().toISOString()
              })
              .eq('endpoint', sub.endpoint);
          }

          return {
            success: false,
            endpoint: sub.endpoint.substring(0, 50) + '...',
            error: error.message,
            statusCode: error.statusCode
          };
        }
      })
    );

    const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;

    console.log(`Push notification results: ${successful} successful, ${failed} failed out of ${subscriptions.length} total`);

    return new Response(
      JSON.stringify({
        message: 'Push notifications processed',
        successful,
        failed,
        total: subscriptions.length,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        results: results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: 'Promise rejected' }),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error.message,
        stack: error.stack
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
}

export default handler;
Deno.serve(handler);
