/**
 * Slack Service
 * Handles Slack API interactions for notifications
 */

import { supabase } from '@/lib/supabase';

// =============================================================================
// Types
// =============================================================================

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  num_members?: number;
  type: 'public_channel' | 'private_channel';
}

export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  email?: string;
  is_bot: boolean;
  profile_image?: string;
}

export interface SlackDestination {
  id: string;
  name: string;
  display_name: string;
  type: 'public_channel' | 'private_channel' | 'user';
  is_private?: boolean;
  num_members?: number;
  email?: string;
  profile_image?: string;
}

export interface SlackChannelsAndUsersResponse {
  channels: SlackChannel[];
  users: SlackUser[];
  total_channels: number;
  total_users: number;
}

export interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
  unfurl_links?: boolean;
  unfurl_media?: boolean;
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: string;
    url?: string;
    action_id?: string;
  }>;
  accessory?: {
    type: string;
    image_url?: string;
    alt_text?: string;
  };
}

export interface EventSlackIntegration {
  id: string;
  event_id: string;
  access_token: string;
  bot_user_id: string;
  team_id: string;
  team_name: string;
  scope: string;
  installed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventSlackNotification {
  id: string;
  event_id: string;
  notification_type: 'registration' | 'speaker_submission' | 'speaker_update';
  enabled: boolean;
  use_custom_workspace: boolean;
  channel_id: string | null;
  channel_name: string | null;
  user_id: string | null;
  user_email: string | null;
  custom_message_template: string | null;
  created_at: string;
  updated_at: string;
}

export interface SlackNotificationLog {
  id: string;
  event_id: string;
  notification_type: string;
  channel_or_user: string;
  message_ts: string | null;
  trigger_entity_type: string;
  trigger_entity_id: string;
  status: 'sent' | 'failed';
  error_message: string | null;
  created_at: string;
}

export interface BrandDefaultInfo {
  teamName: string;
  isConfigured: boolean;
}

// =============================================================================
// Environment Variable Helpers
// =============================================================================

/**
 * Check if brand default Slack workspace is configured
 */
export function hasBrandDefault(): boolean {
  const teamName = import.meta.env.VITE_SLACK_DEFAULT_TEAM_NAME;
  return Boolean(teamName && teamName.trim() !== '');
}

/**
 * Get brand default workspace info (for display)
 */
export function getBrandDefaultInfo(): BrandDefaultInfo | null {
  const teamName = import.meta.env.VITE_SLACK_DEFAULT_TEAM_NAME;
  if (!teamName || teamName.trim() === '') {
    return null;
  }
  return {
    teamName: teamName,
    isConfigured: true,
  };
}

/**
 * Get Slack OAuth authorization URL for connecting a custom workspace
 */
export function getSlackOAuthUrl(eventId: string): string {
  const clientId = import.meta.env.VITE_SLACK_CLIENT_ID;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  if (!clientId || !supabaseUrl) {
    throw new Error('Slack OAuth not configured. Missing VITE_SLACK_CLIENT_ID or VITE_SUPABASE_URL.');
  }

  const redirectUri = `${supabaseUrl}/functions/v1/slack-oauth-callback`;
  const scopes = [
    'chat:write',
    'channels:read',
    'groups:read',
    'users:read',
    'users:read.email',
  ].join(',');

  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state: eventId, // Pass event ID to associate with after OAuth
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

// =============================================================================
// Database Operations
// =============================================================================

/**
 * Get custom Slack integration for an event (if any)
 */
export async function getEventSlackIntegration(eventId: string): Promise<EventSlackIntegration | null> {
  const { data, error } = await supabase
    .from('events_slack_integrations')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching event Slack integration:', error);
    return null;
  }

  return data;
}

/**
 * Delete custom Slack integration for an event
 */
export async function deleteEventSlackIntegration(eventId: string): Promise<boolean> {
  const { error } = await supabase
    .from('events_slack_integrations')
    .delete()
    .eq('event_id', eventId);

  if (error) {
    console.error('Error deleting event Slack integration:', error);
    return false;
  }

  return true;
}

/**
 * Get Slack notification settings for an event
 */
export async function getEventSlackNotifications(eventId: string): Promise<EventSlackNotification[]> {
  const { data, error } = await supabase
    .from('events_slack_notifications')
    .select('*')
    .eq('event_id', eventId);

  if (error) {
    console.error('Error fetching Slack notifications:', error);
    return [];
  }

  return data || [];
}

/**
 * Get a specific notification setting
 */
export async function getEventSlackNotification(
  eventId: string,
  notificationType: 'registration' | 'speaker_submission'
): Promise<EventSlackNotification | null> {
  const { data, error } = await supabase
    .from('events_slack_notifications')
    .select('*')
    .eq('event_id', eventId)
    .eq('notification_type', notificationType)
    .maybeSingle();

  if (error) {
    console.error('Error fetching Slack notification:', error);
    return null;
  }

  return data;
}

/**
 * Upsert a Slack notification setting
 */
export async function upsertEventSlackNotification(
  notification: Partial<EventSlackNotification> & { event_id: string; notification_type: string }
): Promise<EventSlackNotification | null> {
  const { data, error } = await supabase
    .from('events_slack_notifications')
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
    console.error('Error upserting Slack notification:', error);
    return null;
  }

  return data;
}

/**
 * Get notification logs for an event
 */
export async function getSlackNotificationLogs(
  eventId: string,
  limit: number = 50
): Promise<SlackNotificationLog[]> {
  const { data, error } = await supabase
    .from('integrations_slack_notification_logs')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching Slack notification logs:', error);
    return [];
  }

  return data || [];
}

// =============================================================================
// Slack API Operations (via Edge Functions)
// =============================================================================

/**
 * List channels and users from the connected Slack workspace
 */
export async function listSlackChannelsAndUsers(eventId: string): Promise<SlackChannelsAndUsersResponse> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  const response = await fetch(`${supabaseUrl}/functions/v1/slack-list-channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
    },
    body: JSON.stringify({ eventId, includeUsers: true }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to list Slack channels and users');
  }

  const data = await response.json();
  return {
    channels: data.channels || [],
    users: data.users || [],
    total_channels: data.total_channels || 0,
    total_users: data.total_users || 0,
  };
}

/**
 * List channels from the connected Slack workspace (legacy, for backwards compatibility)
 */
export async function listSlackChannels(eventId: string): Promise<SlackChannel[]> {
  const result = await listSlackChannelsAndUsers(eventId);
  return result.channels;
}

/**
 * List users from the connected Slack workspace
 */
export async function listSlackUsers(eventId: string): Promise<SlackUser[]> {
  const result = await listSlackChannelsAndUsers(eventId);
  return result.users;
}

/**
 * Get all Slack destinations (channels + users) as a unified list
 */
export async function listSlackDestinations(eventId: string): Promise<SlackDestination[]> {
  const { channels, users } = await listSlackChannelsAndUsers(eventId);

  const destinations: SlackDestination[] = [];

  // Add channels
  for (const channel of channels) {
    destinations.push({
      id: channel.id,
      name: channel.name,
      display_name: channel.is_private ? `${channel.name}` : `#${channel.name}`,
      type: channel.type,
      is_private: channel.is_private,
      num_members: channel.num_members,
    });
  }

  // Add users
  for (const user of users) {
    destinations.push({
      id: user.id,
      name: user.name,
      display_name: user.real_name,
      type: 'user',
      email: user.email,
      profile_image: user.profile_image,
    });
  }

  return destinations;
}

/**
 * Search Slack destinations with a query string
 * - Prefix with # to search channels only
 * - Prefix with @ to search users only
 * - No prefix searches both (but users require at least 2 chars)
 */
export async function searchSlackDestinations(
  eventId: string,
  query: string
): Promise<SlackDestination[]> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  // Determine search type based on prefix
  let searchQuery = query.trim();
  let searchType: 'channel' | 'user' | 'all' = 'all';

  if (searchQuery.startsWith('#')) {
    searchType = 'channel';
    searchQuery = searchQuery.slice(1);
  } else if (searchQuery.startsWith('@')) {
    searchType = 'user';
    searchQuery = searchQuery.slice(1);
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/slack-list-channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
    },
    body: JSON.stringify({
      eventId,
      includeUsers: true,
      searchQuery,
      searchType,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to search Slack destinations');
  }

  const data = await response.json();
  const destinations: SlackDestination[] = [];

  // Add channels
  for (const channel of data.channels || []) {
    destinations.push({
      id: channel.id,
      name: channel.name,
      display_name: channel.is_private ? `🔒 ${channel.name}` : `# ${channel.name}`,
      type: channel.type,
      is_private: channel.is_private,
      num_members: channel.num_members,
    });
  }

  // Add users
  for (const user of data.users || []) {
    destinations.push({
      id: user.id,
      name: user.name,
      display_name: user.real_name,
      type: 'user',
      email: user.email,
      profile_image: user.profile_image,
    });
  }

  return destinations;
}

/**
 * Send a test notification to verify the Slack configuration
 */
export async function sendTestSlackNotification(
  eventId: string,
  notificationType: 'registration' | 'speaker_submission' | 'speaker_update'
): Promise<{ success: boolean; error?: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  // For speaker_update, use the speaker-update-notify function
  if (notificationType === 'speaker_update') {
    const response = await fetch(`${supabaseUrl}/functions/v1/speaker-update-notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({
        eventId,
        notificationType: 'speaker_update',
        data: {
          speakerId: 'test-speaker-id',
          speakerName: 'Test Speaker',
          email: 'test@example.com',
          talkTitle: 'Test Talk Title',
          talkSynopsis: 'This is a test talk synopsis to verify the speaker update notification.',
          speakerBio: 'Test speaker bio.',
          jobTitle: 'Test Engineer',
          company: 'Test Company',
          linkedinUrl: 'https://linkedin.com/in/test',
          avatarUrl: '',
          status: 'pending',
          changes: {
            talk_title: { old: 'Previous Title', new: 'Test Talk Title' },
          },
          updatedAt: new Date().toISOString(),
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to send test notification' };
    }

    return { success: true };
  }

  // For other types, use the standard slack-notify function
  const response = await fetch(`${supabaseUrl}/functions/v1/slack-notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
    },
    body: JSON.stringify({
      eventId,
      notificationType,
      isTest: true,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    return { success: false, error: error.message || 'Failed to send test notification' };
  }

  return { success: true };
}

/**
 * Send historic notifications for all existing registrations/speaker submissions
 */
export async function sendHistoricSlackNotifications(
  eventId: string,
  notificationType: 'registration' | 'speaker_submission'
): Promise<{ success: boolean; sent: number; failed: number; total: number; error?: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  const response = await fetch(`${supabaseUrl}/functions/v1/slack-notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
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
      sent: 0,
      failed: 0,
      total: 0,
      error: result.error || 'Failed to send historic notifications',
    };
  }

  return {
    success: result.success,
    sent: result.sent || 0,
    failed: result.failed || 0,
    total: result.total || 0,
    error: result.errors?.join(', '),
  };
}

// =============================================================================
// Message Templates
// =============================================================================

export interface RegistrationData {
  firstName: string;
  lastName: string;
  email: string;
  registeredAt: string;
  eventName: string;
  eventId: string;
}

export interface SpeakerSubmissionData {
  speakerName: string;
  talkTitle: string;
  submittedAt: string;
  eventName: string;
  eventId: string;
}

/**
 * Build registration notification message
 */
export function buildRegistrationMessage(data: RegistrationData, adminBaseUrl: string): SlackMessage {
  const adminUrl = `${adminBaseUrl}/events/${data.eventId}/registrations`;

  return {
    text: `New registration for ${data.eventName}: ${data.firstName} ${data.lastName}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `New Registration for ${data.eventName}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Attendee:* ${data.firstName} ${data.lastName}\n*Email:* ${data.email}\n*Registered:* ${new Date(data.registeredAt).toLocaleString()}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: 'View in Admin',
            url: adminUrl,
            action_id: 'view_registration',
          },
        ],
      },
    ],
  };
}

/**
 * Build speaker submission notification message
 */
export function buildSpeakerSubmissionMessage(data: SpeakerSubmissionData, adminBaseUrl: string): SlackMessage {
  const adminUrl = `${adminBaseUrl}/events/${data.eventId}/speakers`;

  return {
    text: `New speaker submission for ${data.eventName}: ${data.speakerName}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `New Speaker Submission for ${data.eventName}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Speaker:* ${data.speakerName}\n*Talk Title:* ${data.talkTitle}\n*Submitted:* ${new Date(data.submittedAt).toLocaleString()}\n*Status:* Pending Review`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: 'Review Submission',
            url: adminUrl,
            action_id: 'review_submission',
          },
        ],
      },
    ],
  };
}

// =============================================================================
// Export Default Service Object
// =============================================================================

const SlackService = {
  // Environment helpers
  hasBrandDefault,
  getBrandDefaultInfo,
  getSlackOAuthUrl,

  // Database operations
  getEventSlackIntegration,
  deleteEventSlackIntegration,
  getEventSlackNotifications,
  getEventSlackNotification,
  upsertEventSlackNotification,
  getSlackNotificationLogs,

  // Slack API operations
  listSlackChannels,
  listSlackUsers,
  listSlackChannelsAndUsers,
  listSlackDestinations,
  searchSlackDestinations,
  sendTestSlackNotification,
  sendHistoricSlackNotifications,

  // Message templates
  buildRegistrationMessage,
  buildSpeakerSubmissionMessage,
};

export default SlackService;
