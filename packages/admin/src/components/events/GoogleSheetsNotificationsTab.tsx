// @ts-nocheck
/**
 * Google Sheets Notifications Tab Component
 * Manages Google Sheets notification configuration for events
 * Uses OAuth per-event authorization
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  TableCellsIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  UsersIcon,
  UserIcon,
  PaperAirplaneIcon,
  ArrowTopRightOnSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Button, Card } from '@/components/ui-legacy';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import GoogleSheetsService, {
  type EventGoogleSheetsNotification,
  type GoogleSheetsNotificationType,
} from '@/utils/googleSheetsService';

interface GoogleSheetsNotificationsTabProps {
  eventId: string;
  eventTitle: string;
}

// Google icon component
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

// Google Sheets icon component
function GoogleSheetsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.385 3.52h-7.692v4.038h9.231V5.058c0-.835-.689-1.538-1.539-1.538zm-9.231 0H4.615c-.85 0-1.538.703-1.538 1.538v2.5h7.077V3.52zm-7.077 4.038v9.884h7.077v-9.884H3.077zm7.077 0v9.884h9.231v-9.884h-9.231zm9.231 11.423h-7.692v1.5c0 .834.689 1.538 1.539 1.538h6.153c.85 0 1.538-.704 1.538-1.538v-1.5h-1.538zm-9.231 0H3.077v1.5c0 .834.688 1.538 1.538 1.538h5.539v-3.038z" />
    </svg>
  );
}

export function GoogleSheetsNotificationsTab({
  eventId,
  eventTitle,
}: GoogleSheetsNotificationsTabProps) {
  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notifications, setNotifications] = useState<EventGoogleSheetsNotification[]>([]);
  const [sendingTest, setSendingTest] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Check for OAuth callback results
  useEffect(() => {
    const connected = searchParams.get('google_sheets_connected');
    const error = searchParams.get('google_sheets_error');
    const notificationType = searchParams.get('notification_type');

    if (connected === 'true') {
      toast.success(`Google account connected for ${notificationType === 'registration' ? 'registrations' : 'speaker submissions'}!`);
      // Clear URL params
      searchParams.delete('google_sheets_connected');
      searchParams.delete('notification_type');
      setSearchParams(searchParams, { replace: true });
      // Reload data
      loadData();
    } else if (error) {
      toast.error(`Failed to connect: ${error}`);
      searchParams.delete('google_sheets_error');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const notificationSettings = await GoogleSheetsService.getEventGoogleSheetsNotifications(eventId);
      setNotifications(notificationSettings);
    } catch (error) {
      console.error('Error loading Google Sheets data:', error);
      toast.error('Failed to load Google Sheets settings');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Get notification setting for a type
  const getNotification = (
    type: GoogleSheetsNotificationType
  ): EventGoogleSheetsNotification | undefined => {
    return notifications.find((n) => n.notification_type === type);
  };

  // Update notification setting
  const updateNotification = async (
    type: GoogleSheetsNotificationType,
    updates: Partial<EventGoogleSheetsNotification>
  ) => {
    setSaving(true);
    try {
      const result = await GoogleSheetsService.upsertEventGoogleSheetsNotification({
        event_id: eventId,
        notification_type: type,
        ...updates,
      });

      if (result) {
        setNotifications((prev) => {
          const existing = prev.findIndex((n) => n.notification_type === type);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = result;
            return updated;
          }
          return [...prev, result];
        });
        toast.success('Settings saved');
      } else {
        toast.error('Failed to save settings');
      }
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Handle disconnect
  const handleDisconnect = async (type: GoogleSheetsNotificationType) => {
    setSaving(true);
    try {
      const result = await GoogleSheetsService.disconnectGoogleAccount(eventId, type);
      if (result.success) {
        toast.success('Google account disconnected');
        loadData();
      } else {
        toast.error(result.error || 'Failed to disconnect');
      }
    } catch (error) {
      toast.error('Failed to disconnect');
    } finally {
      setSaving(false);
    }
  };

  // Send test or historic notification
  const handleSendTest = async (type: GoogleSheetsNotificationType, isHistoric: boolean) => {
    const notification = getNotification(type);
    if (!notification?.spreadsheet_id) {
      toast.error('Please configure a spreadsheet first');
      return;
    }
    if (!GoogleSheetsService.hasValidOAuthCredentials(notification)) {
      toast.error('Please connect a Google account first');
      return;
    }

    setSendingTest(type);
    try {
      if (isHistoric) {
        const result = await GoogleSheetsService.sendHistoricGoogleSheetsNotifications(
          eventId,
          type
        );
        if (!result.success) {
          toast.error(`Failed to add data. ${result.error || ''}`);
        } else if (result.total === 0) {
          toast.info(
            `No ${type === 'registration' ? 'registrations' : 'submissions'} found to send`
          );
        } else {
          toast.success(
            `Added ${result.sent} of ${result.total} ${type === 'registration' ? 'registrations' : 'submissions'} to sheet`
          );
        }
      } else {
        const result = await GoogleSheetsService.sendTestGoogleSheetsNotification(eventId, type);
        if (result.success) {
          toast.success('Test row added to sheet!');
        } else {
          toast.error(result.error || 'Failed to send test');
        }
      }
    } catch (error) {
      toast.error('Failed to send notification');
    } finally {
      setSendingTest(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="p-6 flex items-center justify-center min-h-[200px]">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/20">
            <GoogleSheetsIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Google Sheets Integration
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Automatically add registration and speaker submission data to Google Sheets
            </p>
          </div>
        </div>

        {/* Notification Types */}
        <div className="space-y-4">
          <h4 className="text-base font-semibold text-gray-900 dark:text-white">
            Data Destinations
          </h4>

          {/* Registration Notification */}
          <SheetsNotificationConfig
            type="registration"
            title="Registrations"
            description="Add new registrations to a Google Sheet"
            icon={<UsersIcon className="h-4 w-4 text-green-600 dark:text-green-400" />}
            iconBg="bg-green-100 dark:bg-green-900/20"
            toggleColor="peer-checked:bg-green-600"
            notification={getNotification('registration')}
            eventId={eventId}
            saving={saving}
            sendingTest={sendingTest === 'registration'}
            onUpdate={(updates) => updateNotification('registration', updates)}
            onDisconnect={() => handleDisconnect('registration')}
            onSendTest={(isHistoric) => handleSendTest('registration', isHistoric)}
            columns={GoogleSheetsService.getRegistrationColumns()}
          />

          {/* Speaker Submission Notification */}
          <SheetsNotificationConfig
            type="speaker_submission"
            title="Speaker Submissions"
            description="Add speaker submissions to a Google Sheet (updates sync automatically)"
            icon={<UserIcon className="h-4 w-4 text-purple-600 dark:text-purple-400" />}
            iconBg="bg-purple-100 dark:bg-purple-900/20"
            toggleColor="peer-checked:bg-purple-600"
            notification={getNotification('speaker_submission')}
            eventId={eventId}
            saving={saving}
            sendingTest={sendingTest === 'speaker_submission'}
            onUpdate={(updates) => updateNotification('speaker_submission', updates)}
            onDisconnect={() => handleDisconnect('speaker_submission')}
            onSendTest={(isHistoric) => handleSendTest('speaker_submission', isHistoric)}
            columns={GoogleSheetsService.getSpeakerSubmissionColumns()}
          />
        </div>

        {/* Help Text */}
        <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
          <h5 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
            How Google Sheets Integration Works
          </h5>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-gray-400 mt-1">1.</span>
              <span>
                Connect your Google account by clicking "Connect Google Account"
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400 mt-1">2.</span>
              <span>
                Create a Google Sheet and add the header row with the columns listed below
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400 mt-1">3.</span>
              <span>Paste the spreadsheet URL and enable the notification</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400 mt-1">4.</span>
              <span>
                New data will be automatically appended. For speakers, updates sync to existing rows
              </span>
            </li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

// =============================================================================
// Sheets Notification Config Sub-component
// =============================================================================

interface SheetsNotificationConfigProps {
  type: GoogleSheetsNotificationType;
  title: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
  toggleColor: string;
  notification: EventGoogleSheetsNotification | undefined;
  eventId: string;
  saving: boolean;
  sendingTest: boolean;
  onUpdate: (updates: Partial<EventGoogleSheetsNotification>) => void;
  onDisconnect: () => void;
  onSendTest: (isHistoric: boolean) => void;
  columns: { header: string; description: string }[];
}

function SheetsNotificationConfig({
  type,
  title,
  description,
  icon,
  iconBg,
  toggleColor,
  notification,
  eventId,
  saving,
  sendingTest,
  onUpdate,
  onDisconnect,
  onSendTest,
  columns,
}: SheetsNotificationConfigProps) {
  const [spreadsheetUrl, setSpreadsheetUrl] = useState('');
  const [sheetName, setSheetName] = useState('Sheet1');
  const [sendHistoric, setSendHistoric] = useState(false);
  const [showColumns, setShowColumns] = useState(false);

  const isEnabled = notification?.enabled ?? false;
  const isConnected = GoogleSheetsService.hasValidOAuthCredentials(notification);
  const connectedEmail = notification?.google_user_email;

  // Initialize from notification
  useEffect(() => {
    if (notification?.spreadsheet_id) {
      setSpreadsheetUrl(
        GoogleSheetsService.buildSpreadsheetUrl(notification.spreadsheet_id)
      );
    }
    if (notification?.sheet_name) {
      setSheetName(notification.sheet_name);
    }
  }, [notification]);

  const handleToggle = () => {
    if (!isConnected) {
      toast.error('Please connect a Google account first');
      return;
    }
    if (!notification?.spreadsheet_id) {
      toast.error('Please configure a spreadsheet first');
      return;
    }
    onUpdate({ enabled: !isEnabled });
  };

  const handleConnect = () => {
    const returnUrl = window.location.pathname + window.location.search;
    const oauthUrl = GoogleSheetsService.getGoogleOAuthUrl(eventId, type, returnUrl);
    window.location.href = oauthUrl;
  };

  const handleUrlChange = (url: string) => {
    setSpreadsheetUrl(url);
    const spreadsheetId = GoogleSheetsService.extractSpreadsheetId(url);
    if (spreadsheetId) {
      onUpdate({
        spreadsheet_id: spreadsheetId,
        spreadsheet_name: 'Google Sheet',
      });
    }
  };

  const handleSheetNameChange = (name: string) => {
    setSheetName(name);
    onUpdate({ sheet_name: name.trim() });
  };

  const hasSpreadsheet = notification?.spreadsheet_id;
  const typeLabel = type === 'registration' ? 'registrations' : 'submissions';

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconBg} flex-shrink-0`}
          >
            {icon}
          </div>
          <div>
            <h5 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h5>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={handleToggle}
            disabled={saving || !isConnected || !hasSpreadsheet}
            className="sr-only peer"
          />
          <div
            className={`w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 ${toggleColor} peer-disabled:opacity-50`}
          ></div>
        </label>
      </div>

      {/* Configuration */}
      <div className="mt-4 pl-11 space-y-4">
        {/* Google Account Connection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Google Account
          </label>
          {isConnected ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <CheckCircleIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="text-sm text-green-700 dark:text-green-300">
                  Connected as {connectedEmail}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onDisconnect}
                disabled={saving}
                className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
              >
                <XMarkIcon className="h-4 w-4" />
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <ExclamationTriangleIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm text-amber-700 dark:text-amber-300">
                  No Google account connected
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleConnect}
                disabled={saving}
                className="flex items-center gap-2"
              >
                <GoogleIcon className="h-4 w-4" />
                Connect Google Account
              </Button>
            </div>
          )}
        </div>

        {/* Spreadsheet URL Input */}
        {isConnected && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Spreadsheet URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={spreadsheetUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  disabled={saving}
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-400"
                />
                {hasSpreadsheet && (
                  <a
                    href={GoogleSheetsService.buildSpreadsheetUrl(notification!.spreadsheet_id!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <ArrowTopRightOnSquareIcon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  </a>
                )}
              </div>
              {hasSpreadsheet && (
                <p className="mt-1 text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <CheckCircleIcon className="h-3 w-3" />
                  Spreadsheet ID: {notification!.spreadsheet_id}
                </p>
              )}
            </div>

            {/* Sheet Name Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Sheet/Tab Name
              </label>
              <input
                type="text"
                value={sheetName}
                onChange={(e) => handleSheetNameChange(e.target.value)}
                placeholder="Sheet1"
                disabled={saving}
                className="w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-400"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                The name of the sheet/tab within the spreadsheet (default: Sheet1)
              </p>
            </div>

            {/* Column Preview */}
            <div>
              <button
                type="button"
                onClick={() => setShowColumns(!showColumns)}
                className="text-sm text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
              >
                <TableCellsIcon className="h-4 w-4" />
                {showColumns ? 'Hide' : 'Show'} expected columns ({columns.length})
              </button>

              {showColumns && (
                <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Column
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Header
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Description
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                      {columns.map((col, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 whitespace-nowrap text-xs font-mono text-gray-600 dark:text-gray-400">
                            {String.fromCharCode(65 + idx)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                            {col.header}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                            {col.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Test Controls */}
            {hasSpreadsheet && (
              <div className="flex items-center gap-4 pt-2 border-t border-gray-200 dark:border-gray-700">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSendTest(sendHistoric)}
                  disabled={sendingTest || saving}
                  className="flex items-center gap-2"
                >
                  {sendingTest ? (
                    <>
                      <LoadingSpinner size="xs" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <PaperAirplaneIcon className="h-4 w-4" />
                      {sendHistoric ? 'Send Historic' : 'Send Test'}
                    </>
                  )}
                </Button>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendHistoric}
                    onChange={(e) => setSendHistoric(e.target.checked)}
                    disabled={sendingTest || saving}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Send all existing {typeLabel}
                  </span>
                </label>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default GoogleSheetsNotificationsTab;
