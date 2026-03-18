import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';

export default async function(req: Request) {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    // Calculate the 24-hour window from now
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find events starting in the next 24 hours
    const { data: upcomingEvents, error: eventsError } = await supabase
      .from('events')
      .select('event_id, event_title, event_start, start_time, event_location, venue')
      .gte('event_start', now.toISOString())
      .lte('event_start', in24Hours.toISOString())
      .eq('status', 'published');

    if (eventsError) {
      return new Response(
        JSON.stringify({ error: eventsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!upcomingEvents || upcomingEvents.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No upcoming events in the next 24 hours', sent: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let totalSent = 0;
    let totalFailed = 0;
    const errors: string[] = [];

    for (const event of upcomingEvents) {
      // Find confirmed registrations for this event
      const { data: registrations, error: regError } = await supabase
        .from('event_registrations')
        .select('registration_id, email, first_name, last_name')
        .eq('event_id', event.event_id)
        .eq('status', 'confirmed')
        .eq('reminder_sent', false);

      if (regError) {
        errors.push(`Failed to fetch registrations for event ${event.event_id}: ${regError.message}`);
        continue;
      }

      if (!registrations || registrations.length === 0) {
        continue;
      }

      for (const reg of registrations) {
        const eventDate = event.event_start
          ? new Date(event.event_start).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : 'TBD';

        const html = `
          <h2>Reminder: ${event.event_title} is coming up!</h2>
          <p>Hi ${reg.first_name},</p>
          <p>This is a friendly reminder that <strong>${event.event_title}</strong> is starting soon.</p>
          <ul>
            <li><strong>Date:</strong> ${eventDate}</li>
            ${event.start_time ? `<li><strong>Time:</strong> ${event.start_time}</li>` : ''}
            ${event.event_location ? `<li><strong>Location:</strong> ${event.event_location}</li>` : ''}
            ${event.venue ? `<li><strong>Venue:</strong> ${event.venue}</li>` : ''}
          </ul>
          <p>We look forward to seeing you there!</p>
        `;

        // Send reminder email via the send-email function's logic
        const provider = Deno.env.get('EMAIL_PROVIDER') ?? 'sendgrid';
        const apiKey = Deno.env.get('SENDGRID_API_KEY');
        const fromEmail = Deno.env.get('EMAIL_FROM') ?? 'noreply@gatewaze.com';
        let success = false;

        if (provider === 'sendgrid' && apiKey) {
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
                    to: [{ email: reg.email }],
                    subject: `Reminder: ${event.event_title} is tomorrow!`,
                  },
                ],
                from: { email: fromEmail },
                content: [{ type: 'text/html', value: html }],
              }),
            });

            success = response.ok || response.status === 202;
          } catch (err) {
            errors.push(`Failed to send to ${reg.email}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }

        if (success) {
          totalSent++;
          // Mark reminder as sent
          await supabase
            .from('event_registrations')
            .update({ reminder_sent: true })
            .eq('registration_id', reg.registration_id);
        } else {
          totalFailed++;
        }

        // Log the email
        try {
          await supabase.from('email_logs').insert({
            to_email: reg.email,
            subject: `Reminder: ${event.event_title} is tomorrow!`,
            provider,
            status: success ? 'sent' : 'failed',
            sent_at: new Date().toISOString(),
          });
        } catch {
          console.error(`Failed to log reminder email for ${reg.email}`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Reminder emails processed',
        sent: totalSent,
        failed: totalFailed,
        errors: errors.length > 0 ? errors : undefined,
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
