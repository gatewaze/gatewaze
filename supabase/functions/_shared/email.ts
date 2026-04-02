import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

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
      from: { email: config.fromEmail, name: config.fromName },
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
    await client.send({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: params.to,
      subject: params.subject,
      content: params.text || '',
      html: params.html,
    });
  } finally {
    await client.close();
  }
}
