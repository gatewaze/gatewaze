// Dynamic import — only loaded when SMTP provider is actually used.
// Top-level import of denomailer can fail in some Supabase Edge Runtime environments.
let SMTPClient: any = null;

interface EmailConfig {
  provider: 'sendgrid' | 'smtp';
  sendgridApiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  fromEmail: string;
  fromName: string;
}

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
}

/**
 * Read email configuration from environment variables.
 * Set EMAIL_PROVIDER=none to explicitly disable email sending.
 */
export function getEmailConfig(): EmailConfig | null {
  const provider = Deno.env.get('EMAIL_PROVIDER');

  if (!provider || provider === 'none') return null;

  return {
    provider: provider as 'sendgrid' | 'smtp',
    sendgridApiKey: Deno.env.get('SENDGRID_API_KEY'),
    smtpHost: Deno.env.get('SMTP_HOST'),
    smtpPort: Deno.env.get('SMTP_PORT') ? parseInt(Deno.env.get('SMTP_PORT')!, 10) : undefined,
    smtpUser: Deno.env.get('SMTP_USER'),
    smtpPass: Deno.env.get('SMTP_PASS'),
    fromEmail: Deno.env.get('EMAIL_FROM') || 'noreply@localhost',
    fromName: Deno.env.get('EMAIL_FROM_NAME') || 'Gatewaze',
  };
}

/**
 * Check if email sending is configured.
 * Returns false when CI_MODE is enabled so magic links are returned
 * directly instead of being emailed.
 */
export function isEmailConfigured(): boolean {
  if (Deno.env.get('CI_MODE')?.toLowerCase() === 'true') return false;
  const config = getEmailConfig();
  if (!config) return false;
  if (config.provider === 'sendgrid') return !!config.sendgridApiKey;
  if (config.provider === 'smtp') return !!config.smtpHost;
  return false;
}

/**
 * Send an email using the configured provider.
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const config = getEmailConfig();
  if (!config) {
    throw new Error('Email is not configured');
  }

  if (config.provider === 'sendgrid') {
    await sendViaSendGrid(config, params);
  } else if (config.provider === 'smtp') {
    await sendViaSmtp(config, params);
  } else {
    throw new Error(`Unknown email provider: ${config.provider}`);
  }
}

async function sendViaSendGrid(
  config: EmailConfig,
  params: SendEmailParams,
): Promise<void> {
  if (!config.sendgridApiKey) {
    throw new Error('SendGrid API key is not configured');
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.sendgridApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: params.to }] }],
      from: { email: params.fromEmail || config.fromEmail, name: params.fromName || config.fromName },
      ...(params.replyTo ? { reply_to: { email: params.replyTo } } : {}),
      subject: params.subject,
      content: [
        ...(params.text ? [{ type: 'text/plain', value: params.text }] : []),
        { type: 'text/html', value: params.html },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid error (${res.status}): ${body}`);
  }
}

async function sendViaSmtp(
  config: EmailConfig,
  params: SendEmailParams,
): Promise<void> {
  if (!config.smtpHost) {
    throw new Error('SMTP host is not configured');
  }

  // Postmark fast-path: skip SMTP entirely and use the HTTP API. Many
  // hosts (Hetzner included) block outbound 25/465 by default, and the
  // denomailer client we use for the generic SMTP path doesn't support
  // STARTTLS upgrade on 587 — so SMTP-via-Postmark fails on those VPSes
  // even when port 587 is reachable. The Postmark HTTP API is plain
  // HTTPS and uses the same server token as username/password, so the
  // existing SMTP_USER value works as-is.
  if (config.smtpHost.includes('postmarkapp.com')) {
    const senderName = params.fromName || config.fromName;
    const senderEmail = params.fromEmail || config.fromEmail;
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': config.smtpUser || '',
      },
      body: JSON.stringify({
        From: senderName ? `${senderName} <${senderEmail}>` : senderEmail,
        To: params.to,
        Subject: params.subject,
        HtmlBody: params.html,
        ...(params.text ? { TextBody: params.text } : {}),
        ...(params.replyTo ? { ReplyTo: params.replyTo } : {}),
        MessageStream: 'outbound',
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Postmark error (${res.status}): ${body}`);
    }
    return;
  }

  // Generic SMTP path — uses denomailer with implicit TLS (works on port
  // 465). For STARTTLS on 587 you'd need a different client; out of scope
  // here because we expect Postmark for any prod deploy.
  if (!SMTPClient) {
    const mod = await import('https://deno.land/x/denomailer@1.6.0/mod.ts');
    SMTPClient = mod.SMTPClient;
  }

  const client = new SMTPClient({
    connection: {
      hostname: config.smtpHost,
      port: config.smtpPort || 587,
      tls: true,
      auth: config.smtpUser
        ? { username: config.smtpUser, password: config.smtpPass || '' }
        : undefined,
    },
  });

  try {
    const senderName = params.fromName || config.fromName;
    const senderEmail = params.fromEmail || config.fromEmail;
    await client.send({
      from: `${senderName} <${senderEmail}>`,
      to: params.to,
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
      subject: params.subject,
      content: params.text || '',
      html: params.html,
    });
  } finally {
    await client.close();
  }
}
