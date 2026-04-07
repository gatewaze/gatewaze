import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// SendGrid API configuration
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY')!;
const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

interface EmailAttachment {
  content: string; // Base64 encoded content
  filename: string;
  type?: string;
  disposition?: 'attachment' | 'inline';
}

interface EmailRequest {
  to: string | string[];
  cc?: string | string[];
  from: string;
  fromName?: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  personId?: number; // Optional person ID for linking
  attachments?: EmailAttachment[];
}

async function handler(req: Request) {
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

    // Parse request body
    const { to, cc, from, fromName, subject, text, html, replyTo, personId, attachments }: EmailRequest = await req.json();

    // Validate required fields
    if (!to || (Array.isArray(to) && to.length === 0)) {
      return new Response(
        JSON.stringify({ error: 'At least one recipient email is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    if (!from) {
      return new Response(
        JSON.stringify({ error: 'From email address is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    if (!subject) {
      return new Response(
        JSON.stringify({ error: 'Email subject is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    if (!text && !html) {
      return new Response(
        JSON.stringify({ error: 'Email must have either text or html content' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // Build personalizations array for SendGrid
    // Note: CC is added to each personalization if provided
    const ccRecipients = cc
      ? (Array.isArray(cc) ? cc : [cc]).map(email => ({ email }))
      : undefined;

    const personalizations = Array.isArray(to)
      ? to.map(email => ({
          to: [{ email }],
          ...(ccRecipients && { cc: ccRecipients })
        }))
      : [{
          to: [{ email: to }],
          ...(ccRecipients && { cc: ccRecipients })
        }];

    // Build SendGrid API request
    const sendGridPayload: any = {
      personalizations,
      from: fromName ? { email: from, name: fromName } : { email: from },
      subject,
    };

    // Add content
    const content = [];
    if (text) {
      content.push({ type: 'text/plain', value: text });
    }
    if (html) {
      content.push({ type: 'text/html', value: html });
    }
    sendGridPayload.content = content;

    // Add reply-to if provided
    if (replyTo) {
      sendGridPayload.reply_to = { email: replyTo };
    }

    // Add attachments if provided
    if (attachments && attachments.length > 0) {
      sendGridPayload.attachments = attachments.map((att: EmailAttachment) => ({
        content: att.content,
        filename: att.filename,
        type: att.type || 'application/octet-stream',
        disposition: att.disposition || 'attachment',
      }));
      console.log('✅ Attachments formatted for SendGrid:', sendGridPayload.attachments.map((a: any) => ({
        filename: a.filename,
        type: a.type,
        disposition: a.disposition,
        contentLength: a.content.length,
        contentPreview: a.content.substring(0, 50) + '...'
      })));
    } else {
      console.log('⚠️ No attachments provided in request');
    }

    console.log('Sending email via SendGrid:', {
      to: Array.isArray(to) ? to : [to],
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : 'none',
      from,
      subject,
      hasText: !!text,
      hasHtml: !!html,
      replyTo: replyTo || 'none',
      attachmentCount: attachments?.length || 0,
    });

    // Look up person IDs for recipients if not provided
    const recipients = Array.isArray(to) ? to : [to];
    const personIdMap = new Map<string, number>();

    if (!personId) {
      // Batch lookup person IDs by email
      const { data: people } = await supabaseClient
        .from('people')
        .select('id, email')
        .in('email', recipients);

      if (people) {
        people.forEach(p => {
          if (p.email) {
            personIdMap.set(p.email.toLowerCase(), p.id);
          }
        });
      }
      console.log(`Found ${personIdMap.size} person IDs for ${recipients.length} recipients`);
    }

    // Send request to SendGrid API
    const response = await fetch(SENDGRID_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sendGridPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ SendGrid API error:', response.status, errorText);

      // Try to parse SendGrid error for better debugging
      try {
        const errorJson = JSON.parse(errorText);
        console.error('SendGrid error details:', JSON.stringify(errorJson, null, 2));
      } catch (e) {
        // Error text is not JSON
      }

      return new Response(
        JSON.stringify({
          error: 'Failed to send email via SendGrid',
          details: errorText,
          status: response.status
        }),
        {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // Get message ID from response headers
    const messageId = response.headers.get('x-message-id');

    console.log('Email sent successfully via SendGrid. Message ID:', messageId);

    // Log email to database for each recipient
    for (const recipientEmail of recipients) {
      // Use provided personId, or look up from map, or null
      const resolvedPersonId = personId || personIdMap.get(recipientEmail.toLowerCase()) || null;

      const emailLog = {
        recipient_email: recipientEmail,
        recipient_customer_id: resolvedPersonId,
        from_address: from,
        reply_to: replyTo || null,
        subject,
        content_text: text || null,
        content_html: html || null,
        sendgrid_message_id: messageId,
        status: 'sent',
      };

      const { error: logError } = await supabaseClient
        .from('email_logs')
        .insert(emailLog);

      if (logError) {
        console.error('Failed to log email:', logError);
        // Don't fail the request if logging fails
      } else {
        console.log('Email logged successfully for:', recipientEmail, 'person_id:', resolvedPersonId);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        messageId,
        message: 'Email sent successfully'
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );

  } catch (error: any) {
    console.error('Error in send-email function:', error);

    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error.message
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
}

export default handler;
Deno.serve(handler);
