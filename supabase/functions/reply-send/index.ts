import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Outbound "reply to a reply" sender, shared by broadcasts + newsletters.
//
// Sends an email FROM the address the original broadcast / newsletter was sent
// from, TO the person who replied. Because it sends from that same address, the
// person's next reply lands back at email-inbound-parse and is forwarded to the
// send's forward_replies_to like any other reply — no extra forwarding wiring.
//
// Records the outbound message in {broadcast,newsletter}_reply_messages so the
// admin Replies tab can render the conversation thread. Requires an active
// admin session (verify_jwt is left ON — deploy WITHOUT --no-verify-jwt).

const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY')!;
const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Attachment {
  filename: string;
  content: string; // base64 (no data: prefix)
  type?: string;
}

interface RequestBody {
  kind: 'broadcast' | 'newsletter';
  replyId: string;
  bodyHtml: string;
  bodyText?: string;
  attachments?: Attachment[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Prefix "Re:" unless the original subject already has one.
function reSubject(s: string | null | undefined): string {
  const t = (s || '').trim();
  if (!t) return 'Re: (no subject)';
  return /^re:/i.test(t) ? t : `Re: ${t}`;
}

// Normalise a Message-ID to <angle-bracketed> form for threading headers.
function bracket(id: string | null | undefined): string | null {
  if (!id) return null;
  const t = id.trim().replace(/^<+|>+$/g, '');
  return t ? `<${t}>` : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Missing authorization' }, 401);

    const service: DB = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verify the caller is an active admin.
    const authClient: DB = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await authClient.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return json({ error: 'Invalid session' }, 401);
    const { data: admin } = await service
      .from('admin_profiles')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();
    if (!admin) return json({ error: 'Not authorized' }, 403);

    const { kind, replyId, bodyHtml, bodyText, attachments }: RequestBody = await req.json();
    if (!replyId || (kind !== 'broadcast' && kind !== 'newsletter')) {
      return json({ error: 'kind and replyId are required' }, 400);
    }
    if (!bodyHtml || !bodyHtml.replace(/<[^>]*>/g, '').trim()) {
      return json({ error: 'Reply body is required' }, 400);
    }

    // ---- Resolve recipient + send-from identity from the reply + its send ----
    let toEmail = '';
    let subject = '';
    let sendLogId: string | null = null;
    let inReplyTo: string | null = null;
    let fromAddress = '';
    let fromName: string | undefined;
    let replyTo = '';
    let parentId: string | null = null;

    if (kind === 'broadcast') {
      const { data: reply } = await service
        .from('broadcast_replies')
        .select('from_email, subject, send_log_id, in_reply_to, broadcast_id')
        .eq('id', replyId)
        .maybeSingle();
      if (!reply) return json({ error: 'Reply not found' }, 404);
      toEmail = reply.from_email;
      subject = reSubject(reply.subject);
      sendLogId = reply.send_log_id;
      inReplyTo = reply.in_reply_to;
      parentId = reply.broadcast_id;
      const { data: b } = await service
        .from('broadcasts')
        .select('from_address, from_name, name, reply_to')
        .eq('id', reply.broadcast_id)
        .maybeSingle();
      fromAddress = b?.from_address || '';
      fromName = b?.from_name || b?.name || undefined;
      replyTo = b?.reply_to || '';
    } else {
      const { data: reply } = await service
        .from('newsletter_replies')
        .select('from_email, subject, send_log_id, in_reply_to, collection_id')
        .eq('id', replyId)
        .maybeSingle();
      if (!reply) return json({ error: 'Reply not found' }, 404);
      toEmail = reply.from_email;
      subject = reSubject(reply.subject);
      sendLogId = reply.send_log_id;
      inReplyTo = reply.in_reply_to;
      parentId = reply.collection_id;
      const { data: c } = await service
        .from('newsletters_template_collections')
        .select('from_email, from_name, name, reply_to')
        .eq('id', reply.collection_id)
        .maybeSingle();
      fromAddress = c?.from_email || '';
      fromName = c?.from_name || c?.name || undefined;
      replyTo = c?.reply_to || '';
    }

    // Prefer the address the original was ACTUALLY sent from (what the person is
    // replying to) — guarantees their next reply routes back to inbound-parse.
    if (sendLogId) {
      const { data: log } = await service
        .from('email_send_log')
        .select('from_address, reply_to')
        .eq('id', sendLogId)
        .maybeSingle();
      if (log?.from_address) fromAddress = log.from_address;
      if (log?.reply_to) replyTo = log.reply_to;
    }

    if (!fromAddress) return json({ error: 'Could not resolve a send-from address for this reply' }, 400);
    if (!toEmail) return json({ error: 'Reply has no sender address' }, 400);
    if (!replyTo) replyTo = fromAddress;

    // ---- Build + send the SendGrid message ----
    const threadId = bracket(inReplyTo);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      personalizations: [{ to: [{ email: toEmail }] }],
      from: fromName ? { email: fromAddress, name: fromName } : { email: fromAddress },
      reply_to: { email: replyTo },
      subject,
      content: [
        ...(bodyText && bodyText.trim() ? [{ type: 'text/plain', value: bodyText }] : []),
        { type: 'text/html', value: bodyHtml },
      ],
    };
    if (threadId) payload.headers = { 'In-Reply-To': threadId, References: threadId };

    const cleanAttachments = (attachments || []).filter((a) => a?.content && a?.filename);
    if (cleanAttachments.length) {
      payload.attachments = cleanAttachments.map((a) => ({
        content: a.content,
        filename: a.filename,
        type: a.type || 'application/octet-stream',
        disposition: 'attachment',
      }));
    }

    const res = await fetch(SENDGRID_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error('[reply-send] SendGrid error', res.status, detail);
      return json({ error: 'Failed to send reply', detail }, 502);
    }
    const messageId = res.headers.get('x-message-id');

    // Log to email_send_log WITHOUT a broadcast/newsletter send id — this is a
    // 1:1 reply, not a campaign send, so it must not inflate send stats. (Reply
    // forwarding for the person's next reply still works via the original send's
    // log row.)
    await service.from('email_send_log').insert({
      recipient_email: toEmail,
      from_address: fromAddress,
      reply_to: replyTo,
      subject,
      content_html: bodyHtml,
      provider_message_id: messageId,
      provider: 'sendgrid',
      status: 'sent',
      sent_at: new Date().toISOString(),
    });

    // Record the outbound message for the thread view.
    const attachmentMeta = cleanAttachments.map((a) => ({
      filename: a.filename,
      type: a.type || 'application/octet-stream',
      // base64 → bytes (approx; ignores padding).
      size: Math.floor((a.content.length * 3) / 4),
    }));
    const table = kind === 'broadcast' ? 'broadcast_reply_messages' : 'newsletter_reply_messages';
    const parentKey = kind === 'broadcast' ? 'broadcast_id' : 'collection_id';
    const { error: recErr } = await service.from(table).insert({
      reply_id: replyId,
      [parentKey]: parentId,
      from_address: fromAddress,
      to_address: toEmail,
      subject,
      body_html: bodyHtml,
      body_text: bodyText || null,
      attachments: attachmentMeta,
      provider_message_id: messageId,
      sent_by: user.id,
    });
    if (recErr) console.error('[reply-send] message record insert failed:', recErr.message);

    // Mark the inbound reply as handled.
    const replyTable = kind === 'broadcast' ? 'broadcast_replies' : 'newsletter_replies';
    await service.from(replyTable).update({ is_read: true }).eq('id', replyId);

    return json({ success: true, messageId });
  } catch (e) {
    console.error('[reply-send] error', e);
    return json({ error: (e as Error).message }, 500);
  }
});
