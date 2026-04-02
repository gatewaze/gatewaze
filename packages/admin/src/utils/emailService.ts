import { supabase } from '@/lib/supabase';

export interface EmailAttachment {
  content: string; // Base64 encoded content
  filename: string;
  type?: string;
  disposition?: 'attachment' | 'inline';
}

export interface EmailRequest {
  to: string | string[];
  cc?: string | string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  customerId?: number;
  attachments?: EmailAttachment[];
}

export interface EmailServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Email Service
 * Handles sending emails via SendGrid through Supabase Edge Functions
 */
class EmailService {
  /**
   * Parse email string in format "Name - email@example.com" into name and email components
   */
  static parseEmailAddress(emailString: string): { name: string; email: string } {
    const parts = emailString.split(' - ');
    if (parts.length === 2) {
      return {
        name: parts[0].trim(),
        email: parts[1].trim(),
      };
    }
    // Fallback if format is different
    return {
      name: '',
      email: emailString.trim(),
    };
  }

  /**
   * Get default from addresses from environment variables
   */
  static getFromAddresses() {
    return {
      default: import.meta.env.VITE_SENDGRID_FROM_DEFAULT || '',
      partners: import.meta.env.VITE_SENDGRID_FROM_PARTNERS || '',
      admin: import.meta.env.VITE_SENDGRID_FROM_ADMIN || '',
      members: import.meta.env.VITE_SENDGRID_FROM_MEMBERS || '',
      events: import.meta.env.VITE_SENDGRID_FROM_EVENTS || '',
    };
  }

  /**
   * Get parsed from addresses with separated name and email
   */
  static getParsedFromAddresses() {
    const addresses = this.getFromAddresses();
    return {
      default: this.parseEmailAddress(addresses.default),
      partners: this.parseEmailAddress(addresses.partners),
      admin: this.parseEmailAddress(addresses.admin),
      members: this.parseEmailAddress(addresses.members),
      events: this.parseEmailAddress(addresses.events),
    };
  }

  /**
   * Send email to one or more recipients
   */
  static async sendEmail(
    request: EmailRequest
  ): Promise<EmailServiceResponse<{ messageId: string }>> {
    try {
      // Validate required fields
      if (!request.to || (Array.isArray(request.to) && request.to.length === 0)) {
        return {
          success: false,
          error: 'At least one recipient email is required',
        };
      }

      if (!request.from) {
        return {
          success: false,
          error: 'From email address is required',
        };
      }

      if (!request.subject) {
        return {
          success: false,
          error: 'Email subject is required',
        };
      }

      if (!request.text && !request.html) {
        return {
          success: false,
          error: 'Email must have either text or html content',
        };
      }

      // Parse the from address to extract name and email
      // (in case it's in "Name - email@example.com" format)
      const parsedFrom = this.parseEmailAddress(request.from);

      // Parse the replyTo address if provided
      let replyToEmail = request.replyTo;
      if (replyToEmail) {
        const parsedReplyTo = this.parseEmailAddress(replyToEmail);
        replyToEmail = parsedReplyTo.email || replyToEmail;
      }

      // Call Supabase Edge Function to send email via SendGrid
      const { data, error } = await supabase.functions.invoke('email-send', {
        body: {
          to: request.to,
          cc: request.cc,
          from: parsedFrom.email || request.from,
          fromName: parsedFrom.name || undefined,
          subject: request.subject,
          text: request.text,
          html: request.html,
          replyTo: replyToEmail,
          customerId: request.customerId,
          attachments: request.attachments,
        },
      });

      if (error) {
        console.error('Failed to send email:', error);
        return {
          success: false,
          error: error.message || 'Failed to send email',
        };
      }

      const recipients = Array.isArray(request.to) ? request.to.length : 1;
      return {
        success: true,
        data: data,
        message: `Email sent successfully to ${recipients} recipient${recipients > 1 ? 's' : ''}`,
      };
    } catch (error: any) {
      console.error('Email service error:', error);
      return {
        success: false,
        error: error.message || 'An unexpected error occurred',
      };
    }
  }

  /**
   * Send email to multiple members
   */
  static async sendToMembers(
    memberEmails: string[],
    from: string,
    subject: string,
    content: { text?: string; html?: string },
    replyTo?: string
  ): Promise<EmailServiceResponse> {
    return this.sendEmail({
      to: memberEmails,
      from,
      subject,
      text: content.text,
      html: content.html,
      replyTo,
    });
  }
}

export default EmailService;
