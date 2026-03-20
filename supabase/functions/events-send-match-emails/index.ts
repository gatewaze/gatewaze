import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send'

// Fallback sender address map — only used if match_intro_email_from_address is not set
const FROM_KEY_MAP: Record<string, string> = {
  partners: 'partners@mlops.community',
  members: 'members@mlops.community',
  admin: 'admin@mlops.community',
  events: 'events@mlops.community',
  default: 'hello@mlops.community',
}

function resolveFromEmail(fromAddress: string | null, fromKey: string | null): string {
  // Prefer the resolved from address saved by the UI
  if (fromAddress) return fromAddress
  return FROM_KEY_MAP[fromKey ?? 'events'] ?? FROM_KEY_MAP['events']
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const sendgridKey = Deno.env.get('SENDGRID_API_KEY')
    if (!sendgridKey) throw new Error('SENDGRID_API_KEY not configured')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { event_id, match_ids, test_mode } = await req.json()
    // test_mode: { email_a: string; email_b: string } — sends one email to test addresses, does not mark as sent
    if (!event_id) {
      return new Response(JSON.stringify({ error: 'event_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch event info
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('event_title, event_start, event_link')
      .eq('event_id', event_id)
      .single()

    if (eventError || !event) throw eventError ?? new Error('Event not found')

    // Fetch email config from event_communication_settings
    const { data: commSettings } = await supabase
      .from('events_communication_settings')
      .select('match_intro_email_from_key, match_intro_email_from_address, match_intro_email_reply_to, match_intro_email_template_id, match_intro_email_subject, match_intro_email_content')
      .eq('event_id', event_id)
      .single()

    // Priority: per-event override > template > hardcoded default
    let customSubject: string | null = commSettings?.match_intro_email_subject ?? null
    let customHtml: string | null = commSettings?.match_intro_email_content ?? null

    // Fall back to template if no direct override set
    if ((!customSubject || !customHtml) && commSettings?.match_intro_email_template_id) {
      const { data: template } = await supabase
        .from('email_templates')
        .select('subject, content_html')
        .eq('id', commSettings.match_intro_email_template_id)
        .single()

      if (template) {
        customSubject = customSubject ?? template.subject
        customHtml = customHtml ?? template.content_html
      }
    }

    // Fetch matches — in test mode just fetch one to use as sample
    let matchQuery = supabase
      .from('events_attendee_matches')
      .select('id, registration_a_id, registration_b_id, match_reason, preceding_word_a, preceding_word_b')
      .eq('event_id', event_id)

    if (test_mode) {
      // In test mode: use specified match_id or just grab the first match
      if (match_ids && match_ids.length > 0) {
        matchQuery = matchQuery.in('id', match_ids).limit(1)
      } else {
        matchQuery = matchQuery.limit(1)
      }
    } else {
      matchQuery = matchQuery.is('intro_email_sent_at', null)
      if (match_ids && match_ids.length > 0) {
        matchQuery = matchQuery.in('id', match_ids)
      }
    }

    const { data: matches, error: matchError } = await matchQuery
    if (matchError) throw matchError

    if (!matches || matches.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: test_mode ? 'No matches found to use as test sample' : 'No matches pending email send',
        emails_sent: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Gather all registration IDs we need to look up
    const allRegIds = matches.flatMap((m: any) => [m.registration_a_id, m.registration_b_id])

    const { data: registrations, error: regError } = await supabase
      .from('events_registrations_with_people')
      .select('id, full_name, email, job_title, company')
      .in('id', allRegIds)

    if (regError) throw regError

    const regMap = new Map<string, any>()
    for (const r of registrations ?? []) {
      regMap.set(r.id, r)
    }

    const fromEmail = resolveFromEmail(commSettings?.match_intro_email_from_address ?? null, commSettings?.match_intro_email_from_key ?? null)
    const replyTo = commSettings?.match_intro_email_reply_to ?? null

    const eventWeekday = event.event_start
      ? new Date(event.event_start).toLocaleDateString('en-US', { weekday: 'long' })
      : 'the event day'

    let emailsSent = 0
    const errors: string[] = []

    for (const match of matches) {
      const personA = regMap.get(match.registration_a_id)
      const personB = regMap.get(match.registration_b_id)

      if (!personA || !personB) {
        errors.push(`Match ${match.id}: missing registrant data`)
        continue
      }

      const aFirstName = personA.full_name?.split(' ')[0] ?? personA.email
      const bFirstName = personB.full_name?.split(' ')[0] ?? personB.email
      const aJobTitle = personA.job_title ?? ''
      const aCompany = personA.company ?? ''
      const bJobTitle = personB.job_title ?? ''
      const bCompany = personB.company ?? ''
      const precedingWordA = match.preceding_word_a ?? 'a'
      const precedingWordB = match.preceding_word_b ?? 'a'

      const aDesc = [aJobTitle, aCompany ? `at ${aCompany}` : ''].filter(Boolean).join(' ')
      const bDesc = [bJobTitle, bCompany ? `at ${bCompany}` : ''].filter(Boolean).join(' ')

      const eventLinkHref = event.event_link ?? ''
      const eventLinkHtml = eventLinkHref
        ? `<a href="${eventLinkHref}" style="color: #6d28d9;">${event.event_title}</a>`
        : event.event_title

      // Template variables available for custom templates
      const templateVars: Record<string, string> = {
        event_title: event.event_title,
        event_weekday: eventWeekday,
        event_link: eventLinkHref,
        person_a_first_name: aFirstName,
        person_a_job_title: aJobTitle,
        person_a_company: aCompany,
        preceding_word_a: precedingWordA,
        person_b_first_name: bFirstName,
        person_b_job_title: bJobTitle,
        person_b_company: bCompany,
        preceding_word_b: precedingWordB,
        match_reason: match.match_reason ?? '',
      }

      const subject = customSubject
        ? customSubject.replace(/\{\{(\w+)\}\}/g, (_, k) => templateVars[k] ?? '')
        : `${aFirstName}, meet ${bFirstName} — your intro for ${event.event_title}`

      const html = customHtml
        ? customHtml.replace(/\{\{(\w+)\}\}/g, (_, k) => templateVars[k] ?? '')
        : `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a; line-height: 1.6;">
  <p>Hey ${aFirstName} and ${bFirstName},</p>
  <p>I want to introduce you both so you know at least one person on ${eventWeekday} at the ${eventLinkHtml}. I know going to an event can be intimidating sometimes so hopefully this helps.</p>
  <p>${aFirstName} is ${precedingWordA} ${aDesc} and ${bFirstName} is ${precedingWordB} ${bDesc}.</p>
  <p>I'll let you all take it from here. Keep me posted how it goes.</p>
  <p>- Demetrios</p>
</body>
</html>`

      const text = `Hey ${aFirstName} and ${bFirstName},

I want to introduce you both so you know at least one person on ${eventWeekday} at the ${event.event_title}${eventLinkHref ? ` (${eventLinkHref})` : ''}. I know going to an event can be intimidating sometimes so hopefully this helps.

${aFirstName} is ${precedingWordA} ${aDesc} and ${bFirstName} is ${precedingWordB} ${bDesc}.

I'll let you all take it from here. Keep me posted how it goes.

- Demetrios`

      // In test mode, override recipient emails
      const toA = test_mode ? { email: test_mode.email_a } : { email: personA.email, name: personA.full_name ?? undefined }
      const toB = test_mode ? { email: test_mode.email_b } : { email: personB.email, name: personB.full_name ?? undefined }

      // Send a single group email to both people
      const sendGridPayload = {
        personalizations: [
          {
            to: [toA, toB],
          },
        ],
        from: { email: fromEmail },
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
        ...(replyTo ? { reply_to: { email: replyTo } } : {}),
      }

      const sgResponse = await fetch(SENDGRID_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendGridPayload),
      })

      if (!sgResponse.ok) {
        const errText = await sgResponse.text()
        errors.push(`Match ${match.id}: SendGrid error ${sgResponse.status} — ${errText}`)
        continue
      }

      const messageId = sgResponse.headers.get('x-message-id')

      if (!test_mode) {
        // Mark match as sent
        await supabase
          .from('events_attendee_matches')
          .update({ intro_email_sent_at: new Date().toISOString() })
          .eq('id', match.id)

        // Log to email_logs for both recipients
        for (const person of [personA, personB]) {
          await supabase.from('email_logs').insert({
            recipient_email: person.email,
            from_address: fromEmail,
            reply_to: replyTo,
            subject,
            content_text: text,
            content_html: html,
            sendgrid_message_id: messageId,
            status: 'sent',
          })
        }
      }

      emailsSent++
    }

    return new Response(JSON.stringify({
      success: true,
      emails_sent: emailsSent,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('Error sending match emails:', error)
    return new Response(JSON.stringify({ error: error.message ?? 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
