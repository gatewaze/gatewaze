/**
 * Google Sheets Service
 * Handles Google Sheets API interactions for notifications
 * Uses OAuth per-event authorization (not service accounts)
 */

import { supabase } from '@/lib/supabase';

// =============================================================================
// Types
// =============================================================================

export type GoogleSheetsNotificationType = 'registration' | 'speaker_submission';

export interface EventGoogleSheetsNotification {
  id: string;
  event_id: string;
  notification_type: GoogleSheetsNotificationType;
  enabled: boolean;
  spreadsheet_id: string | null;
  spreadsheet_name: string | null;
  sheet_name: string | null;
  column_mapping: Record<string, string> | null;
  // OAuth fields
  google_access_token: string | null;
  google_refresh_token: string | null;
  google_token_expires_at: string | null;
  google_user_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleSheetsNotificationLog {
  id: string;
  event_id: string;
  notification_type: string;
  spreadsheet_id: string;
  sheet_name: string;
  trigger_entity_type: string;
  trigger_entity_id: string;
  status: 'sent' | 'failed' | 'updated';
  error_message: string | null;
  row_data: string[];
  row_number: number | null;
  created_at: string;
}

export interface SpreadsheetInfo {
  id: string;
  name: string;
  sheets: { name: string; sheetId: number }[];
}

// =============================================================================
// OAuth Helpers
// =============================================================================

/**
 * Get the OAuth authorization URL for connecting a Google account
 */
export function getGoogleOAuthUrl(
  eventId: string,
  notificationType: GoogleSheetsNotificationType,
  returnUrl: string
): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const params = new URLSearchParams({
    event_id: eventId,
    notification_type: notificationType,
    return_url: returnUrl,
  });
  return `${supabaseUrl}/functions/v1/google-sheets-oauth/authorize?${params}`;
}

/**
 * Check if a notification config has valid OAuth credentials
 */
export function hasValidOAuthCredentials(
  notification: EventGoogleSheetsNotification | undefined | null
): boolean {
  if (!notification) return false;
  return Boolean(notification.google_refresh_token);
}

/**
 * Disconnect Google account for a notification type
 */
export async function disconnectGoogleAccount(
  eventId: string,
  notificationType: GoogleSheetsNotificationType
): Promise<{ success: boolean; error?: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/google-sheets-oauth/disconnect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({ eventId, notificationType }),
    });

    const result = await response.json();

    if (!response.ok) {
      return { success: false, error: result.error || 'Failed to disconnect' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error disconnecting Google account:', error);
    return { success: false, error: 'Network error disconnecting account' };
  }
}

// =============================================================================
// URL Parsing Helpers
// =============================================================================

/**
 * Extract spreadsheet ID from a Google Sheets URL
 * Example URL: https://docs.google.com/spreadsheets/d/1_bS1JREOsi7YesGJ_8BtJMfZMoTmVyeRu6RkmcUOnjo/edit?gid=723996080#gid=723996080
 */
export function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/**
 * Extract sheet GID from a Google Sheets URL (optional - used to identify specific tab)
 */
export function extractSheetGid(url: string): string | null {
  const match = url.match(/gid=(\d+)/);
  return match ? match[1] : null;
}

/**
 * Build a Google Sheets URL from spreadsheet ID
 */
export function buildSpreadsheetUrl(spreadsheetId: string, sheetGid?: string): string {
  let url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  if (sheetGid) {
    url += `#gid=${sheetGid}`;
  }
  return url;
}

// =============================================================================
// Database Operations
// =============================================================================

/**
 * Get Google Sheets notification settings for an event
 */
export async function getEventGoogleSheetsNotifications(
  eventId: string
): Promise<EventGoogleSheetsNotification[]> {
  const { data, error } = await supabase
    .from('events_google_sheets_notifications')
    .select('*')
    .eq('event_id', eventId);

  if (error) {
    console.error('Error fetching Google Sheets notifications:', error);
    return [];
  }

  return data || [];
}

/**
 * Get a specific notification setting
 */
export async function getEventGoogleSheetsNotification(
  eventId: string,
  notificationType: GoogleSheetsNotificationType
): Promise<EventGoogleSheetsNotification | null> {
  const { data, error } = await supabase
    .from('events_google_sheets_notifications')
    .select('*')
    .eq('event_id', eventId)
    .eq('notification_type', notificationType)
    .maybeSingle();

  if (error) {
    console.error('Error fetching Google Sheets notification:', error);
    return null;
  }

  return data;
}

/**
 * Upsert a Google Sheets notification setting
 */
export async function upsertEventGoogleSheetsNotification(
  notification: Partial<EventGoogleSheetsNotification> & {
    event_id: string;
    notification_type: GoogleSheetsNotificationType;
  }
): Promise<EventGoogleSheetsNotification | null> {
  const { data, error } = await supabase
    .from('events_google_sheets_notifications')
    .upsert(
      {
        ...notification,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'event_id,notification_type',
      }
    )
    .select()
    .single();

  if (error) {
    console.error('Error upserting Google Sheets notification:', error);
    return null;
  }

  return data;
}

/**
 * Get notification logs for an event
 */
export async function getGoogleSheetsNotificationLogs(
  eventId: string,
  limit: number = 50
): Promise<GoogleSheetsNotificationLog[]> {
  const { data, error } = await supabase
    .from('integrations_google_sheets_notification_logs')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching Google Sheets notification logs:', error);
    return [];
  }

  return data || [];
}

// =============================================================================
// Edge Function Operations
// =============================================================================

/**
 * Send a test notification to verify the Google Sheets configuration
 */
export async function sendTestGoogleSheetsNotification(
  eventId: string,
  notificationType: GoogleSheetsNotificationType
): Promise<{ success: boolean; error?: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/google-sheets-notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({
        eventId,
        notificationType,
        isTest: true,
        data:
          notificationType === 'registration'
            ? {
                firstName: 'Test',
                lastName: 'User',
                email: 'test@example.com',
                registeredAt: new Date().toISOString(),
                registrationId: 'test-registration-id',
                ticketType: 'General Admission',
                amountPaid: 0,
                currency: 'USD',
              }
            : {
                speakerId: 'test-speaker-id',
                speakerName: 'Test Speaker',
                email: 'speaker@example.com',
                talkTitle: 'Test Talk Title',
                talkSynopsis: 'This is a test talk synopsis.',
                speakerBio: 'This is a test speaker bio.',
                jobTitle: 'Test Engineer',
                company: 'Test Company',
                linkedinUrl: 'https://linkedin.com/in/test',
                avatarUrl: '',
                status: 'pending',
                submittedAt: new Date().toISOString(),
              },
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      return { success: false, error: result.error || 'Failed to send test notification' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error sending test notification:', error);
    return { success: false, error: 'Network error sending test notification' };
  }
}

/**
 * Send historic notifications for all existing registrations/speaker submissions
 */
export async function sendHistoricGoogleSheetsNotifications(
  eventId: string,
  notificationType: GoogleSheetsNotificationType
): Promise<{
  success: boolean;
  sent: number;
  failed: number;
  total: number;
  error?: string;
}> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/google-sheets-notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({
        eventId,
        notificationType,
        isHistoric: true,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        sent: result.sent || 0,
        failed: result.failed || 0,
        total: result.total || 0,
        error: result.errors?.join(', ') || result.error || 'Failed to send historic notifications',
      };
    }

    return {
      success: result.success,
      sent: result.sent || 0,
      failed: result.failed || 0,
      total: result.total || 0,
      error: result.errors?.join(', '),
    };
  } catch (error) {
    console.error('Error sending historic notifications:', error);
    return {
      success: false,
      sent: 0,
      failed: 0,
      total: 0,
      error: 'Network error sending historic notifications',
    };
  }
}

// =============================================================================
// Column Information
// =============================================================================

/**
 * Get column headers for registration notifications
 */
export function getRegistrationColumns(): { header: string; description: string }[] {
  return [
    { header: 'Timestamp', description: 'When they registered' },
    { header: 'First Name', description: 'Attendee first name' },
    { header: 'Last Name', description: 'Attendee last name' },
    { header: 'Email', description: 'Attendee email' },
    { header: 'Ticket Type', description: 'Type of ticket' },
    { header: 'Amount Paid', description: 'Payment amount' },
    { header: 'Currency', description: 'Payment currency' },
    { header: 'Registration ID', description: 'Unique ID (for lookups)' },
  ];
}

/**
 * Get column headers for speaker submission notifications
 */
export function getSpeakerSubmissionColumns(): { header: string; description: string }[] {
  return [
    { header: 'Timestamp', description: 'When submitted (or last updated)' },
    { header: 'Speaker Name', description: 'Full name' },
    { header: 'Email', description: 'Speaker email' },
    { header: 'Job Title', description: 'From their profile' },
    { header: 'Company', description: 'From their profile' },
    { header: 'LinkedIn', description: 'LinkedIn profile URL' },
    { header: 'Avatar', description: 'Avatar image URL' },
    { header: 'Talk Title', description: 'Title of the talk' },
    { header: 'Talk Synopsis', description: 'Full description' },
    { header: 'Speaker Bio', description: 'Their bio' },
    { header: 'Status', description: 'pending/approved/rejected/confirmed' },
    { header: 'Talk ID', description: 'Unique ID (for updates)' },
  ];
}

// =============================================================================
// Export Default Service Object
// =============================================================================

const GoogleSheetsService = {
  // OAuth helpers
  getGoogleOAuthUrl,
  hasValidOAuthCredentials,
  disconnectGoogleAccount,

  // URL parsing
  extractSpreadsheetId,
  extractSheetGid,
  buildSpreadsheetUrl,

  // Database operations
  getEventGoogleSheetsNotifications,
  getEventGoogleSheetsNotification,
  upsertEventGoogleSheetsNotification,
  getGoogleSheetsNotificationLogs,

  // Edge function operations
  sendTestGoogleSheetsNotification,
  sendHistoricGoogleSheetsNotifications,

  // Column information
  getRegistrationColumns,
  getSpeakerSubmissionColumns,
};

export default GoogleSheetsService;
