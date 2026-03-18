import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';

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
    const { event_id, email, first_name, last_name } = await req.json();

    if (!event_id || !email || !first_name || !last_name) {
      return new Response(
        JSON.stringify({ error: 'event_id, email, first_name, and last_name are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createServiceClient();

    // Verify the event exists and is published
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('event_id, event_title, event_start, start_time, event_location, venue, status')
      .eq('event_id', event_id)
      .single();

    if (eventError || !event) {
      return new Response(
        JSON.stringify({ error: 'Event not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (event.status !== 'published') {
      return new Response(
        JSON.stringify({ error: 'Event is not open for registration' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Check for duplicate registration
    const { data: existingReg } = await supabase
      .from('event_registrations')
      .select('registration_id')
      .eq('event_id', event_id)
      .eq('email', email)
      .maybeSingle();

    if (existingReg) {
      return new Response(
        JSON.stringify({ error: 'Already registered for this event', registration_id: existingReg.registration_id }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Find or create customer
    let customerId: string | null = null;
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('customer_id')
      .eq('email', email)
      .maybeSingle();

    if (existingCustomer) {
      customerId = existingCustomer.customer_id;
    } else {
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          email,
          first_name,
          last_name,
          created_at: new Date().toISOString(),
        })
        .select('customer_id')
        .single();

      if (customerError) {
        return new Response(
          JSON.stringify({ error: `Failed to create customer: ${customerError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      customerId = newCustomer.customer_id;
    }

    // Create event registration
    const { data: registration, error: regError } = await supabase
      .from('event_registrations')
      .insert({
        event_id,
        customer_id: customerId,
        email,
        first_name,
        last_name,
        status: 'confirmed',
        reminder_sent: false,
        registered_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (regError) {
      return new Response(
        JSON.stringify({ error: `Registration failed: ${regError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Send confirmation email
    const eventDate = event.event_start
      ? new Date(event.event_start).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : 'TBD';

    const confirmationHtml = `
      <h2>Registration Confirmed!</h2>
      <p>Hi ${first_name},</p>
      <p>You're registered for <strong>${event.event_title}</strong>.</p>
      <ul>
        <li><strong>Date:</strong> ${eventDate}</li>
        ${event.start_time ? `<li><strong>Time:</strong> ${event.start_time}</li>` : ''}
        ${event.event_location ? `<li><strong>Location:</strong> ${event.event_location}</li>` : ''}
        ${event.venue ? `<li><strong>Venue:</strong> ${event.venue}</li>` : ''}
      </ul>
      <p>Your registration ID is: <strong>${registration.registration_id}</strong></p>
      <p>We look forward to seeing you there!</p>
    `;

    // Send via SendGrid
    const apiKey = Deno.env.get('SENDGRID_API_KEY');
    const fromEmail = Deno.env.get('EMAIL_FROM') ?? 'noreply@gatewaze.com';

    if (apiKey) {
      try {
        await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [
              {
                to: [{ email }],
                subject: `Registration Confirmed: ${event.event_title}`,
              },
            ],
            from: { email: fromEmail },
            content: [{ type: 'text/html', value: confirmationHtml }],
          }),
        });
      } catch (emailErr) {
        console.error('Failed to send confirmation email:', emailErr);
      }

      // Log the confirmation email
      try {
        await supabase.from('email_logs').insert({
          to_email: email,
          subject: `Registration Confirmed: ${event.event_title}`,
          provider: 'sendgrid',
          status: 'sent',
          sent_at: new Date().toISOString(),
        });
      } catch {
        console.error('Failed to log confirmation email');
      }
    }

    return new Response(
      JSON.stringify({ registration }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}
