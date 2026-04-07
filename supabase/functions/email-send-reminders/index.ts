import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const FROM_ADDRESSES: Record<string, string> = {
  events: Deno.env.get('SENDGRID_FROM_EVENTS') || '',
  partners: Deno.env.get('SENDGRID_FROM_PARTNERS') || '',
  members: Deno.env.get('SENDGRID_FROM_MEMBERS') || '',
  admin: Deno.env.get('SENDGRID_FROM_ADMIN') || '',
  default: Deno.env.get('SENDGRID_FROM_DEFAULT') || '',
}

async function handler(_req: Request) {
  try {
    console.log('send-reminder-emails: Checking for events needing reminders...')

    // Find events starting within the next 65 minutes that have reminder enabled but not yet sent
    const { data: settings, error: settingsError } = await supabase
      .from('events_communication_settings')
      .select(`
        id,
        event_id,
        reminder_email_from_key,
        reminder_email_subject,
        reminder_email_content,
        reminder_email_reply_to,
        reminder_email_cc,
        reminder_email_sent_at,
        events!inner(event_id, event_start)
      `)
      .eq('reminder_email_enabled', true)
      .is('reminder_email_sent_at', null)
      .not('reminder_email_subject', 'is', null)
      .not('reminder_email_content', 'is', null)

    if (settingsError) {
      throw new Error(`Failed to query settings: ${settingsError.message}`)
    }

    if (!settings || settings.length === 0) {
      console.log('send-reminder-emails: No events with reminders enabled and pending')
      return new Response(JSON.stringify({ message: 'No reminders to send', processed: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const now = new Date()
    const cutoff = new Date(now.getTime() + 65 * 60 * 1000) // 65 minutes from now
    let processed = 0

    for (const setting of settings) {
      const event = (setting as any).events
      if (!event?.event_start) continue

      const eventStart = new Date(event.event_start)

      // Only process events starting between now and 65 minutes from now
      if (eventStart <= now || eventStart > cutoff) continue

      const eventId = setting.event_id
      console.log(`send-reminder-emails: Event ${eventId} starts at ${eventStart.toISOString()}, processing reminder`)

      // Check if a reminder batch job already exists for this event
      const { data: existingJob } = await supabase
        .from('email_batch_jobs')
        .select('id')
        .eq('event_id', eventId)
        .eq('email_type', 'reminder')
        .in('status', ['pending', 'processing', 'completed'])
        .limit(1)
        .maybeSingle()

      if (existingJob) {
        console.log(`send-reminder-emails: Event ${eventId} already has a reminder job, marking sent`)
        // Mark as sent to prevent future checks
        await supabase
          .from('events_communication_settings')
          .update({ reminder_email_sent_at: now.toISOString() })
          .eq('id', setting.id)
        continue
      }

      // Resolve from address
      const fromKey = setting.reminder_email_from_key || 'events'
      const fromAddress = FROM_ADDRESSES[fromKey] || FROM_ADDRESSES.events || ''

      if (!fromAddress) {
        console.error(`send-reminder-emails: No from address for key ${fromKey}, skipping event ${eventId}`)
        continue
      }

      // Create batch job
      const { data: job, error: jobError } = await supabase
        .from('email_batch_jobs')
        .insert({
          event_id: eventId,
          email_type: 'reminder',
          subject_template: setting.reminder_email_subject,
          content_template: setting.reminder_email_content,
          from_address: fromAddress,
          reply_to: setting.reminder_email_reply_to || null,
          cc: setting.reminder_email_cc || null,
          config: {},
          created_by: null, // System-triggered
        })
        .select('id')
        .single()

      if (jobError || !job) {
        console.error(`send-reminder-emails: Failed to create job for event ${eventId}:`, jobError)
        continue
      }

      // Mark as sent
      await supabase
        .from('events_communication_settings')
        .update({ reminder_email_sent_at: now.toISOString() })
        .eq('id', setting.id)

      // Fire-and-forget invoke batch-send-email
      fetch(`${SUPABASE_URL}/functions/v1/batch-send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ jobId: job.id }),
      }).catch((err) => console.error(`send-reminder-emails: Failed to invoke batch-send-email for job ${job.id}:`, err))

      console.log(`send-reminder-emails: Created job ${job.id} for event ${eventId}`)
      processed++
    }

    console.log(`send-reminder-emails: Done. Processed ${processed} events.`)
    return new Response(JSON.stringify({ message: 'Reminder check complete', processed }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('send-reminder-emails error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export default handler;
Deno.serve(handler);
