// @ts-nocheck
/**
 * Speaker Email Service
 * Handles sending automated emails for speaker status changes
 */

import { supabase } from '@/lib/supabase';
import EmailService from './emailService';
import EmailTemplateService from './emailTemplateService';
import { replaceVariables, buildContext, type TemplateContext } from './templateVariables';
import type { EventSpeakerWithDetails } from './speakerService';

// Get the base URL for the app (for confirmation links)
const getAppBaseUrl = (): string => {
  // In production, this would be the deployed URL
  // For now, use the Supabase project URL for the edge function
  return import.meta.env.VITE_SUPABASE_URL || 'https://api.gatewaze.com';
};

// Get the portal base URL (for speaker edit links)
const getPortalBaseUrl = (): string => {
  return import.meta.env.VITE_PORTAL_URL || 'https://portal.gatewaze.com';
};

interface EventDetails {
  event_title: string;
  event_id: string;
  event_city?: string;
  event_country_code?: string;
  event_start?: string;
  event_end?: string;
  event_location?: string;
  event_link?: string;
}

interface CommunicationSettings {
  speaker_submitted_email_enabled: boolean;
  speaker_submitted_email_template_id: string | null;
  speaker_submitted_email_from_key: string;
  speaker_submitted_email_reply_to: string | null;
  speaker_submitted_email_cc: string | null;
  speaker_submitted_email_subject: string | null;
  speaker_submitted_email_content: string | null;
  speaker_approved_email_enabled: boolean;
  speaker_approved_email_template_id: string | null;
  speaker_approved_email_from_key: string;
  speaker_approved_email_reply_to: string | null;
  speaker_approved_email_cc: string | null;
  speaker_approved_email_subject: string | null;
  speaker_approved_email_content: string | null;
  speaker_rejected_email_enabled: boolean;
  speaker_rejected_email_template_id: string | null;
  speaker_rejected_email_from_key: string;
  speaker_rejected_email_reply_to: string | null;
  speaker_rejected_email_cc: string | null;
  speaker_rejected_email_subject: string | null;
  speaker_rejected_email_content: string | null;
  speaker_reserve_email_enabled: boolean;
  speaker_reserve_email_template_id: string | null;
  speaker_reserve_email_from_key: string;
  speaker_reserve_email_reply_to: string | null;
  speaker_reserve_email_cc: string | null;
  speaker_reserve_email_subject: string | null;
  speaker_reserve_email_content: string | null;
  speaker_confirmed_email_enabled: boolean;
  speaker_confirmed_email_template_id: string | null;
  speaker_confirmed_email_from_key: string;
  speaker_confirmed_email_reply_to: string | null;
  speaker_confirmed_email_cc: string | null;
  speaker_confirmed_email_subject: string | null;
  speaker_confirmed_email_content: string | null;
}

export type SpeakerEmailType = 'submitted' | 'approved' | 'rejected' | 'reserve' | 'confirmed';

export class SpeakerEmailService {
  /**
   * Get communication settings for an event
   */
  static async getCommunicationSettings(eventId: string): Promise<CommunicationSettings | null> {
    const { data, error } = await supabase
      .from('event_communication_settings')
      .select('*')
      .eq('event_id', eventId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching communication settings:', error);
      return null;
    }

    return data;
  }

  /**
   * Get event details for template variables
   */
  static async getEventDetails(eventId: string): Promise<EventDetails | null> {
    const { data, error } = await supabase
      .from('events')
      .select('event_title, event_id, event_city, event_country_code, event_start, event_end, event_location, event_link')
      .eq('event_id', eventId)
      .single();

    if (error) {
      console.error('Error fetching event details:', error);
      return null;
    }

    return data;
  }

  /**
   * Build the confirmation link URL for a speaker
   */
  static buildConfirmationLink(confirmationToken: string): string {
    const baseUrl = getAppBaseUrl();
    return `${baseUrl}/functions/v1/speaker-confirm?token=${confirmationToken}`;
  }

  /**
   * Build template context for speaker emails
   *
   * Supports parameterized confirmation links:
   * - {{speaker.confirmation_link}} - link to confirm for current event
   * - {{speaker.confirmation_link:EVENT_ID}} - link to confirm for a different event
   *   (useful for offering rejected speakers a slot at another event)
   * - {{speaker.edit_link}} - link to speaker portal to manage talk details
   */
  static buildSpeakerContext(
    speaker: EventSpeakerWithDetails & { confirmation_token?: string; edit_token?: string },
    eventDetails: EventDetails
  ): TemplateContext {
    const baseUrl = getAppBaseUrl();
    const portalBaseUrl = getPortalBaseUrl();

    // Build confirmation link if token is available
    const confirmationLink = speaker.confirmation_token
      ? this.buildConfirmationLink(speaker.confirmation_token)
      : undefined;

    // Build edit link using the talk's edit_token (allows speaker to view/edit their submission)
    // Points to the success/dashboard page where confirmed speakers can see their checklist
    // Uses relative path so the portal URL can be configured separately
    const editLink = speaker.edit_token
      ? `/events/${eventDetails.event_id}/talks/success/${speaker.edit_token}`
      : undefined;

    return buildContext({
      customer: {
        first_name: speaker.first_name || '',
        last_name: speaker.last_name || '',
        full_name: speaker.full_name || '',
        email: speaker.email || '',
      },
      speaker: {
        first_name: speaker.first_name || '',
        last_name: speaker.last_name || '',
        full_name: speaker.full_name || '',
        email: speaker.email || '',
        talk_title: speaker.talk_title || '',
        talk_synopsis: speaker.talk_synopsis || '',
        company: speaker.company || '',
        job_title: speaker.job_title || '',
        confirmation_link: confirmationLink,
        edit_link: editLink,
        // Pass token and base URL for parameterized confirmation links
        _confirmation_token: speaker.confirmation_token,
        _confirmation_base_url: baseUrl,
      },
      event: {
        event_title: eventDetails.event_title,
        event_id: eventDetails.event_id,
        event_city: eventDetails.event_city,
        event_country_code: eventDetails.event_country_code,
        event_start: eventDetails.event_start,
        event_end: eventDetails.event_end,
      },
    });
  }

  /**
   * Send speaker email based on type (submitted, approved, rejected, reserve, confirmed)
   */
  static async sendSpeakerEmail(
    speaker: EventSpeakerWithDetails & { confirmation_token?: string; edit_token?: string },
    eventId: string,
    emailType: SpeakerEmailType
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get communication settings
      const settings = await this.getCommunicationSettings(eventId);
      if (!settings) {
        return { success: false, error: 'No communication settings found' };
      }

      // Check if this email type is enabled
      const enabledKey = `speaker_${emailType}_email_enabled` as keyof CommunicationSettings;
      const templateIdKey = `speaker_${emailType}_email_template_id` as keyof CommunicationSettings;
      const fromKeyKey = `speaker_${emailType}_email_from_key` as keyof CommunicationSettings;
      const replyToKey = `speaker_${emailType}_email_reply_to` as keyof CommunicationSettings;
      const ccKey = `speaker_${emailType}_email_cc` as keyof CommunicationSettings;

      if (!settings[enabledKey]) {
        console.log(`Speaker ${emailType} email is disabled for event ${eventId}`);
        return { success: true }; // Not an error, just disabled
      }

      const templateId = settings[templateIdKey] as string | null;
      const subjectKey = `speaker_${emailType}_email_subject` as keyof CommunicationSettings;
      const contentKey = `speaker_${emailType}_email_content` as keyof CommunicationSettings;
      const inlineSubject = settings[subjectKey] as string | null;
      const inlineContent = settings[contentKey] as string | null;

      // Get event details
      const eventDetails = await this.getEventDetails(eventId);
      if (!eventDetails) {
        return { success: false, error: 'Event details not found' };
      }

      // Build template context
      const context = this.buildSpeakerContext(speaker, eventDetails);

      let processedSubject: string;
      let processedHtml: string;

      if (templateId) {
        // Use template if configured
        const template = await EmailTemplateService.getById(templateId);
        if (!template) {
          return { success: false, error: 'Email template not found' };
        }
        processedSubject = replaceVariables(template.subject, context);
        processedHtml = replaceVariables(template.content_html, context);
      } else if (inlineSubject && inlineContent) {
        // Use inline content (Start from Scratch)
        processedSubject = replaceVariables(inlineSubject, context);
        processedHtml = replaceVariables(inlineContent, context);
      } else {
        console.warn(`No template or inline content configured for speaker ${emailType} email`);
        return { success: false, error: 'No email template or content configured' };
      }

      // Get from address
      const fromKey = (settings[fromKeyKey] as string) || 'events';
      const fromAddresses = EmailService.getFromAddresses();
      const fromAddress = fromAddresses[fromKey as keyof typeof fromAddresses] || fromAddresses.events;

      if (!fromAddress) {
        return { success: false, error: 'No from address configured' };
      }

      if (!speaker.email) {
        return { success: false, error: 'Speaker has no email address' };
      }

      // Send the email
      const result = await EmailService.sendEmail({
        to: [speaker.email],
        cc: (settings[ccKey] as string | null) || undefined,
        from: fromAddress,
        subject: processedSubject,
        html: processedHtml,
        replyTo: (settings[replyToKey] as string | null) || undefined,
      });

      if (result.success) {
        // Increment template usage if using a template
        if (templateId) {
          await EmailTemplateService.incrementUsage(templateId).catch(console.error);
        }
        console.log(`Speaker ${emailType} email sent to ${speaker.email}`);
      }

      return result;
    } catch (error: any) {
      console.error(`Error sending speaker ${emailType} email:`, error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Send speaker submitted email
   */
  static async sendSubmittedEmail(
    speaker: EventSpeakerWithDetails,
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.sendSpeakerEmail(speaker, eventId, 'submitted');
  }

  /**
   * Send speaker approved email
   * @param speaker - Speaker details, including optional confirmation_token for the confirmation link
   */
  static async sendApprovedEmail(
    speaker: EventSpeakerWithDetails & { confirmation_token?: string },
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.sendSpeakerEmail(speaker, eventId, 'approved');
  }

  /**
   * Send speaker rejected email
   */
  static async sendRejectedEmail(
    speaker: EventSpeakerWithDetails,
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.sendSpeakerEmail(speaker, eventId, 'rejected');
  }

  /**
   * Send speaker reserve email (when added to reserve/waitlist)
   */
  static async sendReserveEmail(
    speaker: EventSpeakerWithDetails,
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.sendSpeakerEmail(speaker, eventId, 'reserve');
  }

  /**
   * Send speaker confirmed email (when talk is confirmed)
   * Includes edit_link for the speaker portal where they can upload presentation, etc.
   */
  static async sendConfirmedEmail(
    speaker: EventSpeakerWithDetails & { edit_token?: string },
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.sendSpeakerEmail(speaker, eventId, 'confirmed');
  }
}

export default SpeakerEmailService;
