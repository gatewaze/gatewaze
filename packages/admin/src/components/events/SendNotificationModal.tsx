// @ts-nocheck
import { useState, useEffect } from 'react';
import { BellIcon, UserGroupIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { Button, Input, Textarea } from '@/components/ui-legacy';
import { Modal } from '@/components/ui-legacy/Modal';
import NotificationService from '@/utils/notificationService';
import { toast } from 'sonner';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

interface SendNotificationModalProps {
  eventId: string;
  eventTitle: string;
  onComplete?: () => void;
}

export const SendNotificationModal = ({ eventId, eventTitle, onComplete }: SendNotificationModalProps) => {
  const [showModal, setShowModal] = useState(false);
  const [sending, setSending] = useState(false);
  const [subscribersCount, setSubscribersCount] = useState<number>(0);
  const [loadingCount, setLoadingCount] = useState(false);

  const [notificationData, setNotificationData] = useState({
    title: '',
    body: '',
    url: '',
  });

  // Load subscriber count when modal opens
  useEffect(() => {
    if (showModal) {
      loadSubscribersCount();
    }
  }, [showModal, eventId]);

  const loadSubscribersCount = async () => {
    setLoadingCount(true);
    try {
      const response = await NotificationService.getEventSubscribersCount(eventId);
      if (response.success && response.data) {
        setSubscribersCount(response.data.count);
      } else {
        console.warn('Failed to load subscriber count:', response.error);
        setSubscribersCount(0);
      }
    } catch (error) {
      console.error('Error loading subscriber count:', error);
      setSubscribersCount(0);
    } finally {
      setLoadingCount(false);
    }
  };

  const handleClose = () => {
    setShowModal(false);
    setNotificationData({
      title: '',
      body: '',
      url: '',
    });
  };

  const handleSend = async () => {
    // Validation
    if (!notificationData.title.trim()) {
      toast.error('Please enter a notification title');
      return;
    }

    if (!notificationData.body.trim()) {
      toast.error('Please enter a notification message');
      return;
    }

    if (subscribersCount === 0) {
      toast.error('No subscribers found for this event');
      return;
    }

    setSending(true);

    try {
      const response = await NotificationService.sendToEventAttendees(eventId, {
        title: notificationData.title,
        body: notificationData.body,
        url: notificationData.url || `/event/${eventId}`,
        icon: '/img/favicon/techtickets/android-icon-192x192.png',
        badge: '/img/favicon/techtickets/android-icon-96x96.png',
        tag: `event-${eventId}`,
        data: {
          eventId,
          eventTitle,
          type: 'event_notification',
        },
      });

      if (response.success) {
        toast.success(
          response.message || `Notification sent successfully to ${subscribersCount} attendees`
        );
        handleClose();
        if (onComplete) {
          onComplete();
        }
      } else {
        toast.error(response.error || 'Failed to send notification');
      }
    } catch (error) {
      console.error('Error sending notification:', error);
      toast.error('An unexpected error occurred while sending notification');
    } finally {
      setSending(false);
    }
  };

  const handleUseTemplate = (template: 'starting_soon' | 'reminder' | 'update') => {
    const templates = {
      starting_soon: {
        title: `${eventTitle} is starting soon!`,
        body: 'Your event is about to begin. Get ready to check in!',
        url: `/event/${eventId}`,
      },
      reminder: {
        title: `Reminder: ${eventTitle}`,
        body: 'Don\'t forget about your upcoming event. See you there!',
        url: `/event/${eventId}`,
      },
      update: {
        title: `Update for ${eventTitle}`,
        body: 'Important update regarding your event. Check the details now.',
        url: `/event/${eventId}`,
      },
    };

    setNotificationData(templates[template]);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2"
      >
        <BellIcon className="h-4 w-4" />
        Send Notification
      </Button>

      <Modal isOpen={showModal} onClose={handleClose} size="lg" title="Send Push Notification">
        <div className="space-y-6">
          {/* Event Title */}
          <div className="flex items-center gap-3 pb-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/20">
              <BellIcon className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">{eventTitle}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Send notification to event attendees</p>
            </div>
          </div>

          {/* Subscriber Count */}
          <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
            <div className="flex items-center gap-3">
              <UserGroupIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <div>
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  Recipients
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  {loadingCount ? (
                    'Loading...'
                  ) : subscribersCount === 0 ? (
                    'No subscribers with push notifications enabled'
                  ) : (
                    `${subscribersCount} attendee${subscribersCount !== 1 ? 's' : ''} with push notifications enabled`
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Templates */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Quick Templates
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleUseTemplate('starting_soon')}
                disabled={sending}
              >
                Event Starting Soon
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleUseTemplate('reminder')}
                disabled={sending}
              >
                Event Reminder
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleUseTemplate('update')}
                disabled={sending}
              >
                Event Update
              </Button>
            </div>
          </div>

          {/* Notification Title */}
          <div>
            <label
              htmlFor="notification-title"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Notification Title <span className="text-red-500">*</span>
            </label>
            <Input
              id="notification-title"
              type="text"
              placeholder="e.g., Event starting soon!"
              value={notificationData.title}
              onChange={(e) =>
                setNotificationData({ ...notificationData, title: e.target.value })
              }
              disabled={sending}
              maxLength={100}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {notificationData.title.length}/100 characters
            </p>
          </div>

          {/* Notification Body */}
          <div>
            <label
              htmlFor="notification-body"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Message <span className="text-red-500">*</span>
            </label>
            <Textarea
              id="notification-body"
              rows={4}
              placeholder="Enter your notification message..."
              value={notificationData.body}
              onChange={(e) =>
                setNotificationData({ ...notificationData, body: e.target.value })
              }
              disabled={sending}
              maxLength={200}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {notificationData.body.length}/200 characters
            </p>
          </div>

          {/* Optional URL */}
          <div>
            <label
              htmlFor="notification-url"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Link URL (optional)
            </label>
            <Input
              id="notification-url"
              type="text"
              placeholder={`/event/${eventId}`}
              value={notificationData.url}
              onChange={(e) =>
                setNotificationData({ ...notificationData, url: e.target.value })
              }
              disabled={sending}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Where users will be taken when they tap the notification
            </p>
          </div>

          {/* Preview */}
          {notificationData.title && notificationData.body && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Preview
              </label>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/20">
                    <BellIcon className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {notificationData.title}
                    </p>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      {notificationData.body}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button variant="outline" onClick={handleClose} disabled={sending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSend}
              disabled={sending || subscribersCount === 0 || loadingCount}
              className="flex items-center gap-2"
            >
              {sending ? (
                <>
                  <LoadingSpinner size="xs" />
                  Sending...
                </>
              ) : (
                <>
                  <CheckCircleIcon className="h-4 w-4" />
                  Send Notification
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
