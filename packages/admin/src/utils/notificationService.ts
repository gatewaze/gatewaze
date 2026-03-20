import { supabase } from '@/lib/supabase';

export interface PushNotification {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, any>;
}

export interface NotificationRecipient {
  email?: string;
  customer_id?: string;
}

export interface SendNotificationRequest {
  notification: PushNotification;
  recipients?: NotificationRecipient[];
  eventId?: string;
  segmentId?: string;
  sendToAll?: boolean;
}

export interface NotificationServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Notification Service
 * Handles sending push notifications via Supabase Edge Functions
 */
class NotificationService {
  /**
   * Send push notification to specific recipients
   */
  static async sendNotification(
    request: SendNotificationRequest
  ): Promise<NotificationServiceResponse<{ successful: number; failed: number; total: number }>> {
    try {
      // Call Supabase Edge Function to send push notification
      const { data, error } = await supabase.functions.invoke('email-send-push', {
        body: {
          notification: request.notification,
          recipients: request.recipients,
          eventId: request.eventId,
          sendToAll: request.sendToAll,
        },
      });

      if (error) {
        console.error('Failed to send notification:', error);
        return {
          success: false,
          error: error.message || 'Failed to send notification',
        };
      }

      return {
        success: true,
        data: data,
        message: `Notification sent to ${data.successful || 0} recipients`,
      };
    } catch (error: any) {
      console.error('Notification service error:', error);
      return {
        success: false,
        error: error.message || 'An unexpected error occurred',
      };
    }
  }

  /**
   * Send notification to all attendees of an event
   */
  static async sendToEventAttendees(
    eventId: string,
    notification: PushNotification
  ): Promise<NotificationServiceResponse> {
    try {
      // Get all registered attendees for this event from events_registrations_with_people view
      const { data: registrations, error } = await supabase
        .from('events_registrations_with_people')
        .select('email')
        .eq('event_id', eventId)
        .eq('status', 'confirmed')
        .not('email', 'is', null);

      if (error) {
        console.error('Failed to fetch event attendees:', error);
        return {
          success: false,
          error: 'Failed to fetch event attendees',
        };
      }

      if (!registrations || registrations.length === 0) {
        return {
          success: false,
          error: 'No attendees found for this event',
        };
      }

      // Get unique emails
      const uniqueEmails = [...new Set(registrations.map((r) => r.email))];

      // Create recipients list
      const recipients = uniqueEmails.map((email) => ({ email }));

      // Send notification
      return await this.sendNotification({
        notification: {
          ...notification,
          data: {
            ...notification.data,
            eventId,
          },
        },
        recipients,
        eventId,
      });
    } catch (error: any) {
      console.error('Failed to send to event attendees:', error);
      return {
        success: false,
        error: error.message || 'Failed to send to event attendees',
      };
    }
  }

  /**
   * Send notification to all users with active push subscriptions
   */
  static async sendToAllUsers(notification: PushNotification): Promise<NotificationServiceResponse> {
    try {
      return await this.sendNotification({
        notification,
        sendToAll: true,
      });
    } catch (error: any) {
      console.error('Failed to send to all users:', error);
      return {
        success: false,
        error: error.message || 'Failed to send to all users',
      };
    }
  }

  /**
   * Get count of active push subscriptions
   */
  static async getActiveSubscriptionsCount(): Promise<NotificationServiceResponse<{ count: number }>> {
    try {
      const { count, error } = await supabase
        .from('push_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      if (error) {
        console.error('Failed to get subscriptions count:', error);
        return {
          success: false,
          error: 'Failed to get subscriptions count',
        };
      }

      return {
        success: true,
        data: { count: count || 0 },
      };
    } catch (error: any) {
      console.error('Failed to get subscriptions count:', error);
      return {
        success: false,
        error: error.message || 'Failed to get subscriptions count',
      };
    }
  }

  /**
   * Get count of subscribers for a specific event
   */
  static async getEventSubscribersCount(eventId: string): Promise<NotificationServiceResponse<{ count: number }>> {
    try {
      // Get unique attendee emails from events_registrations_with_people view
      const { data: registrations, error: regError } = await supabase
        .from('events_registrations_with_people')
        .select('email')
        .eq('event_id', eventId)
        .eq('status', 'confirmed')
        .not('email', 'is', null);

      if (regError) {
        console.error('Failed to fetch event registrations:', regError);
        return {
          success: false,
          error: 'Failed to fetch event registrations',
        };
      }

      if (!registrations || registrations.length === 0) {
        return {
          success: true,
          data: { count: 0 },
        };
      }

      const uniqueEmails = [...new Set(registrations.map((r) => r.email))];

      // Check how many of these emails have active push subscriptions
      const { count, error: countError } = await supabase
        .from('push_subscriptions')
        .select('*', { count: 'exact', head: true })
        .in('email', uniqueEmails)
        .eq('is_active', true);

      if (countError) {
        console.error('Failed to count subscriptions:', countError);
        return {
          success: false,
          error: 'Failed to count subscriptions',
        };
      }

      return {
        success: true,
        data: { count: count || 0 },
      };
    } catch (error: any) {
      console.error('Failed to get event subscribers count:', error);
      return {
        success: false,
        error: error.message || 'Failed to get event subscribers count',
      };
    }
  }

  /**
   * Log notification send event to database
   */
  static async logNotification(
    eventId: string | null,
    notification: PushNotification,
    recipientCount: number,
    sentBy: string
  ): Promise<void> {
    try {
      await supabase.from('email_notification_logs').insert({
        event_id: eventId,
        notification_title: notification.title,
        notification_body: notification.body,
        notification_url: notification.url,
        recipient_count: recipientCount,
        sent_by: sentBy,
        sent_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to log notification:', error);
      // Don't throw - logging failure shouldn't break the send
    }
  }
}

export default NotificationService;
