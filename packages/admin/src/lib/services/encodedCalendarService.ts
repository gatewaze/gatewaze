// @ts-nocheck
/**
 * Calendar Service using email_encoded XOR encryption
 * This service leverages the existing email_encoded field for secure calendar tokens
 */

import { createClient } from '@supabase/supabase-js';
import * as ics from 'ics';
import crypto from 'crypto';
import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

interface CalendarTokenData {
  emailEncoded: string;
  eventId: string;
  timestamp?: number;
  signature?: string;
}

export class EncodedCalendarService {
  private supabase: any;
  private passphrase: string = 'HideMe'; // Matches Customer.io encoding
  private hmacSecret: string;

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    // Additional secret for HMAC signing (different from XOR passphrase)
    this.hmacSecret = process.env.CALENDAR_HMAC_SECRET || 'calendar-secret-2024';
  }

  /**
   * Decode email_encoded value (XOR + Base64)
   */
  decodeEmail(encodedEmail: string): string {
    if (!encodedEmail) return '';

    try {
      // Step 1: Base64 decoding (handling URL-safe Base64)
      let base64String = encodedEmail
        .replace(/-/g, '+')
        .replace(/_/g, '/');

      // Ensure proper padding
      const paddingNeeded = base64String.length % 4;
      if (paddingNeeded > 0) {
        base64String += '='.repeat(4 - paddingNeeded);
      }

      // Convert Base64 to bytes
      const decodedBytes = Buffer.from(base64String, 'base64');

      // Step 2: XOR decryption
      let decodedString = '';
      for (let i = 0; i < decodedBytes.length; i++) {
        const passCharCode = this.passphrase.charCodeAt(i % this.passphrase.length);
        const decodedChar = String.fromCharCode(decodedBytes[i] ^ passCharCode);
        decodedString += decodedChar;
      }

      return decodedString.toLowerCase();
    } catch (error) {
      console.error('Email decoding failed:', error);
      return '';
    }
  }

  /**
   * Encode email using XOR + Base64 (matches Customer.io format)
   */
  encodeEmail(email: string): string {
    if (!email) return '';

    try {
      const emailLower = email.toLowerCase();
      const bytes: number[] = [];

      // XOR encryption
      for (let i = 0; i < emailLower.length; i++) {
        const emailCharCode = emailLower.charCodeAt(i);
        const passCharCode = this.passphrase.charCodeAt(i % this.passphrase.length);
        bytes.push(emailCharCode ^ passCharCode);
      }

      // Base64 encoding (URL-safe)
      const base64 = Buffer.from(bytes)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, ''); // Remove padding for URL safety

      return base64;
    } catch (error) {
      console.error('Email encoding failed:', error);
      return '';
    }
  }

  /**
   * Generate calendar token combining email_encoded + event_id + timestamp + HMAC
   * This provides multiple layers of security
   */
  generateCalendarToken(emailEncoded: string, eventId: string): string {
    // Add timestamp for expiration checking
    const timestamp = Math.floor(Date.now() / 1000);

    // Create payload
    const payload = `${emailEncoded}:${eventId}:${timestamp}`;

    // Generate HMAC signature for tamper protection
    const hmac = crypto.createHmac('sha256', this.hmacSecret);
    hmac.update(payload);
    const signature = hmac.digest('hex').substring(0, 16); // Use first 16 chars for shorter URLs

    // Combine all parts
    const token = `${emailEncoded}.${eventId}.${timestamp}.${signature}`;

    // Make URL-safe
    return Buffer.from(token).toString('base64url');
  }

  /**
   * Verify and parse calendar token
   */
  parseCalendarToken(token: string): CalendarTokenData | null {
    try {
      // Decode from base64url
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split('.');

      if (parts.length !== 4) {
        console.error('Invalid token format');
        return null;
      }

      const [emailEncoded, eventId, timestampStr, signature] = parts;
      const timestamp = parseInt(timestampStr, 10);

      // Check token age (expire after 30 days)
      const maxAge = 30 * 24 * 60 * 60; // 30 days in seconds
      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime - timestamp > maxAge) {
        console.error('Token expired');
        return null;
      }

      // Verify HMAC signature
      const payload = `${emailEncoded}:${eventId}:${timestamp}`;
      const hmac = crypto.createHmac('sha256', this.hmacSecret);
      hmac.update(payload);
      const expectedSignature = hmac.digest('hex').substring(0, 16);

      if (signature !== expectedSignature) {
        console.error('Invalid token signature');
        return null;
      }

      return {
        emailEncoded,
        eventId,
        timestamp,
        signature
      };
    } catch (error) {
      console.error('Token parsing failed:', error);
      return null;
    }
  }

  /**
   * Generate calendar URLs for Customer.io
   * These can be stored as customer attributes and used in email templates
   */
  generateCustomerIoCalendarUrls(emailEncoded: string, eventId: string): Record<string, string> {
    const token = this.generateCalendarToken(emailEncoded, eventId);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.gatewaze.com';

    return {
      // Main calendar links
      google: `${baseUrl}/api/calendar/google/${token}`,
      outlook: `${baseUrl}/api/calendar/outlook/${token}`,
      apple: `${baseUrl}/api/calendar/apple/${token}`,
      ics: `${baseUrl}/api/calendar/download/${token}`,

      // Additional options
      preview: `${baseUrl}/api/calendar/preview/${token}`,
      auto: `${baseUrl}/api/calendar/auto/${token}`, // Auto-detect best option

      // One-click add (for future OAuth implementation)
      oneclick: `${baseUrl}/api/calendar/oneclick/${token}`
    };
  }

  /**
   * Verify registration exists for email and event
   */
  async verifyRegistration(email: string, eventId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('event_registrations')
      .select('id')
      .eq('event_id', eventId)
      .eq('member_profiles.email', email)
      .single();

    return !error && !!data;
  }

  /**
   * Get event and registration data using token
   */
  async getEventDataFromToken(token: string): Promise<any> {
    // Parse token
    const tokenData = this.parseCalendarToken(token);
    if (!tokenData) {
      throw new Error('Invalid or expired token');
    }

    // Decode email
    const email = this.decodeEmail(tokenData.emailEncoded);
    if (!email) {
      throw new Error('Invalid email encoding');
    }

    // Get registration with event details
    const { data, error } = await this.supabase
      .from('event_registrations')
      .select(`
        *,
        events!inner (
          event_id,
          event_title,
          event_description,
          event_start,
          event_end,
          event_location,
          event_link,
          eventTimezone,
          organizer_name,
          organizer_email
        ),
        member_profiles!inner (
          first_name,
          last_name,
          email,
          company
        )
      `)
      .eq('event_id', tokenData.eventId)
      .eq('member_profiles.email', email)
      .single();

    if (error || !data) {
      throw new Error('Registration not found');
    }

    return data;
  }

  /**
   * Track calendar interaction
   */
  async trackInteraction(
    token: string,
    interactionType: string,
    metadata?: any
  ): Promise<void> {
    const tokenData = this.parseCalendarToken(token);
    if (!tokenData) return;

    const email = this.decodeEmail(tokenData.emailEncoded);

    // Log interaction
    await this.supabase
      .from('calendar_interactions')
      .insert({
        email,
        event_id: tokenData.eventId,
        interaction_type: interactionType,
        token_used: token.substring(0, 10) + '...', // Store partial token for debugging
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString()
        }
      });

    // Update Customer.io if configured
    if (process.env.CUSTOMERIO_API_KEY) {
      await this.updateCustomerIoTracking(email, tokenData.eventId, interactionType);
    }
  }

  /**
   * Update Customer.io with tracking data
   */
  private async updateCustomerIoTracking(
    email: string,
    eventId: string,
    interactionType: string
  ): Promise<void> {
    const CIO_SITE_ID = process.env.CUSTOMERIO_SITE_ID;
    const CIO_API_KEY = process.env.CUSTOMERIO_API_KEY;

    if (!CIO_SITE_ID || !CIO_API_KEY) return;

    const timestamp = Math.floor(Date.now() / 1000);

    // Update customer attributes
    const attributes: any = {};
    attributes[`event_${eventId}_calendar_clicked`] = true;
    attributes[`event_${eventId}_calendar_last_click`] = timestamp;
    attributes[`event_${eventId}_calendar_type`] = interactionType;

    await fetch(`https://track.customer.io/api/v1/customers/${email}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${CIO_SITE_ID}:${CIO_API_KEY}`).toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(attributes)
    });

    // Send event to Customer.io
    await fetch(`https://track.customer.io/api/v1/customers/${email}/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${CIO_SITE_ID}:${CIO_API_KEY}`).toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'calendar_link_clicked',
        data: {
          event_id: eventId,
          calendar_type: interactionType,
          timestamp
        }
      })
    });
  }

  /**
   * Generate Google Calendar URL
   */
  generateGoogleCalendarUrl(event: any): string {
    const startDate = this.formatGoogleDate(new Date(event.event_start));
    const endDate = this.formatGoogleDate(new Date(event.event_end));

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.event_title,
      dates: `${startDate}/${endDate}`,
      details: event.event_description || '',
      location: event.event_location || '',
      trp: 'false',
      sprop: 'website:gatewaze.com'
    });

    if (event.eventTimezone) {
      params.append('ctz', event.eventTimezone);
    }

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  /**
   * Generate Outlook Calendar URL
   */
  generateOutlookCalendarUrl(event: any): string {
    const params = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: event.event_title,
      body: event.event_description || '',
      startdt: new Date(event.event_start).toISOString(),
      enddt: new Date(event.event_end).toISOString(),
      location: event.event_location || '',
      allday: 'false'
    });

    return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
  }

  /**
   * Generate ICS file content
   */
  generateICSFile(event: any, registration: any): string {
    const { createEvent } = ics;

    const eventData: ics.EventAttributes = {
      uid: `${event.event_id}@gatewaze.com`,
      title: event.event_title,
      description: this.buildEventDescription(event, registration),
      start: this.dateToICSArray(new Date(event.event_start)),
      end: this.dateToICSArray(new Date(event.event_end)),
      location: event.event_location || 'TBA',
      organizer: event.organizer_email ? {
        name: event.organizer_name || 'Gatewaze Events',
        email: event.organizer_email
      } : undefined,
      attendees: registration.member_profiles ? [{
        name: `${registration.member_profiles.first_name} ${registration.member_profiles.last_name}`,
        email: registration.member_profiles.email,
        rsvp: true,
        partstat: 'ACCEPTED'
      }] : undefined,
      status: 'CONFIRMED',
      busyStatus: 'BUSY',
      transp: 'OPAQUE',
      productId: 'Gatewaze/Events',
      method: 'REQUEST',
      alarms: [{
        action: 'display',
        description: 'Event Reminder',
        trigger: { before: true, minutes: 15 }
      }]
    };

    const { error, value } = createEvent(eventData);
    if (error) throw error;
    return value!;
  }

  /**
   * Build event description for ICS file
   */
  private buildEventDescription(event: any, registration: any): string {
    const parts = [];

    if (event.event_description) {
      parts.push(event.event_description);
    }

    parts.push('');
    parts.push('━━━━━━━━━━━━━━━━━━━━');
    parts.push('REGISTRATION DETAILS');
    parts.push('━━━━━━━━━━━━━━━━━━━━');

    if (registration.registration_type) {
      parts.push(`Type: ${registration.registration_type.toUpperCase()}`);
    }

    if (registration.badge_name) {
      parts.push(`Badge: ${registration.badge_name}`);
    }

    if (registration.member_profiles?.company) {
      parts.push(`Company: ${registration.member_profiles.company}`);
    }

    if (event.event_link) {
      parts.push('');
      parts.push(`Event URL: ${event.event_link}`);
    }

    parts.push('');
    parts.push('Powered by Gatewaze Events');

    return parts.join('\n');
  }

  /**
   * Convert date to ICS array format
   */
  private dateToICSArray(date: Date): ics.DateArray {
    return [
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes()
    ] as ics.DateArray;
  }

  /**
   * Format date for Google Calendar
   */
  private formatGoogleDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
}

export default EncodedCalendarService;