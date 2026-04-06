import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isEmailConfigured, sendEmail } from '../_shared/email.ts';

/**
 * SendGrid Inbound Parse Webhook Handler
 *
 * Receives inbound emails via SendGrid's Inbound Parse and:
 * 1. Matches the recipient address to a newsletter collection's from_email
 * 2. Stores the reply in newsletter_replies
 * 3. Optionally forwards the reply to the configured forward_replies_to address
 *
 * SendGrid sends inbound parse data as multipart/form-data.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
};

async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // SendGrid sends inbound parse as multipart/form-data
    const formData = await req.formData();

    const toRaw = formData.get('to') as string || '';
    const fromRaw = formData.get('from') as string || '';
    const subject = formData.get('subject') as string || '';
    const text = formData.get('text') as string || '';
    const html = formData.get('html') as string || '';
    const envelope = formData.get('envelope') as string || '{}';
    const headers = formData.get('headers') as string || '';
    const replyTo = formData.get('reply-to') as string || formData.get('Reply-To') as string || '';

    // =========================================================================
    // Route: Luma registration/cancellation emails
    // Detected by: sender contains "lu.ma" or "luma.com", or body contains
    // Luma event URLs (evt-XXX), or subject matches registration patterns.
    // =========================================================================
    const isLumaEmail = fromRaw.includes('lu.ma') || fromRaw.includes('luma.com')
      || /evt-[A-Za-z0-9]+/.test(text)
      || /has registered for|cancelled their registration|declined their invitation/i.test(text);

    if (isLumaEmail) {
      console.log(`Luma email detected from ${fromRaw}: ${subject}`);
      try {
        // Forward to the Luma registration processing function
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        const lumaResponse = await fetch(
          `${supabaseUrl}/functions/v1/integrations-luma-process-registration`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Bearer ${serviceKey}`,
            },
            body: new URLSearchParams({
              from: fromRaw,
              to: toRaw,
              subject,
              text,
              html,
              envelope,
              headers,
              'reply-to': replyTo,
            }),
          }
        );

        const lumaResult = await lumaResponse.text();
        console.log(`Luma processing result (${lumaResponse.status}):`, lumaResult);

        return new Response(
          JSON.stringify({ success: true, handler: 'luma', status: lumaResponse.status }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      } catch (lumaErr) {
        console.error('Luma processing error:', lumaErr);
        // Don't fail — continue to newsletter processing as fallback
      }
    }

    // Parse sender
    const fromMatch = fromRaw.match(/(?:(.+?)\s*<)?([^<>\s]+@[^<>\s]+)>?/);
    const fromEmail = fromMatch?.[2]?.toLowerCase() || fromRaw.toLowerCase();
    const fromName = fromMatch?.[1]?.trim().replace(/^"|"$/g, '') || null;

    // Parse recipient(s) — extract email addresses from the to field
    const toEmails: string[] = [];
    const toMatches = toRaw.matchAll(/([^<>\s,]+@[^<>\s,]+)/g);
    for (const m of toMatches) {
      toEmails.push(m[1].toLowerCase());
    }

    // Also check envelope for the actual recipient
    try {
      const env = JSON.parse(envelope);
      if (env.to && Array.isArray(env.to)) {
        for (const addr of env.to) {
          const a = addr.toLowerCase();
          if (!toEmails.includes(a)) toEmails.push(a);
        }
      }
    } catch { /* ignore envelope parse errors */ }

    console.log(`Inbound email from ${fromEmail} to ${toEmails.join(', ')}: ${subject}`);

    if (toEmails.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No recipient found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Extract In-Reply-To header to match to original newsletter send
    let inReplyTo: string | null = null;
    const inReplyToMatch = headers.match(/In-Reply-To:\s*<?([^>\s]+)>?/i);
    if (inReplyToMatch) {
      inReplyTo = inReplyToMatch[1];
    }

    // Find the newsletter collection(s) that match the recipient address
    const { data: collections } = await supabase
      .from('newsletters_template_collections')
      .select('id, name, from_email, forward_replies_to')
      .in('from_email', toEmails);

    if (!collections || collections.length === 0) {
      console.warn('No newsletter collection found for addresses:', toEmails);
      return new Response(
        JSON.stringify({ success: true, message: 'No matching newsletter, ignored' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let stored = 0;
    let forwarded = 0;

    for (const collection of collections) {
      // Try to find the original send log entry from In-Reply-To header
      let sendLogId: string | null = null;
      let editionId: string | null = null;

      if (inReplyTo) {
        // Extract the base message ID (before the first dot)
        const baseId = inReplyTo.split('.')[0].replace(/[<>]/g, '');
        const { data: logEntry } = await supabase
          .from('email_send_log')
          .select('id, newsletter_send_id')
          .eq('provider_message_id', baseId)
          .eq('recipient_email', fromEmail)
          .limit(1)
          .maybeSingle();

        if (logEntry) {
          sendLogId = logEntry.id;
          // Look up the edition from the send
          if (logEntry.newsletter_send_id) {
            const { data: send } = await supabase
              .from('newsletter_sends')
              .select('edition_id')
              .eq('id', logEntry.newsletter_send_id)
              .maybeSingle();
            editionId = send?.edition_id || null;
          }
        }
      }

      // Store the reply
      const { error: insertError } = await supabase
        .from('newsletter_replies')
        .insert({
          collection_id: collection.id,
          from_email: fromEmail,
          from_name: fromName,
          subject,
          body_text: text || null,
          body_html: html || null,
          in_reply_to: inReplyTo,
          send_log_id: sendLogId,
          edition_id: editionId,
          forwarded_to: collection.forward_replies_to || null,
        });

      if (insertError) {
        console.error(`Error storing reply for ${collection.name}:`, insertError);
        continue;
      }
      stored++;

      // Forward the reply if configured
      if (collection.forward_replies_to && isEmailConfigured()) {
        try {
          // Send from the newsletter address with the replier's name,
          // and set reply-to to the original sender so replies go back to them
          const senderDisplay = fromName || fromEmail.split('@')[0];

          await sendEmail({
            to: collection.forward_replies_to,
            subject,
            html: html || `<pre style="white-space: pre-wrap; font-family: sans-serif;">${text}</pre>`,
            text: text || '',
            fromEmail: collection.from_email,
            fromName: `${senderDisplay} (via ${collection.name})`,
            replyTo: fromEmail,
          });

          // Update the reply record with forwarded status
          await supabase
            .from('newsletter_replies')
            .update({ forwarded_at: new Date().toISOString() })
            .eq('collection_id', collection.id)
            .eq('from_email', fromEmail)
            .eq('subject', subject)
            .order('created_at', { ascending: false })
            .limit(1);

          forwarded++;
          console.log(`Forwarded reply to ${collection.forward_replies_to}`);
        } catch (fwdErr) {
          console.error('Error forwarding reply:', fwdErr);
        }
      }
    }

    console.log(`Processed inbound email: ${stored} stored, ${forwarded} forwarded`);

    return new Response(
      JSON.stringify({ success: true, stored, forwarded }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('Inbound parse error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}

export default handler;
if (import.meta.main) Deno.serve(handler);
