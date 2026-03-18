// @ts-nocheck
/**
 * Slack Notifications Tab Component
 * Manages Slack notification configuration for events
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  HashtagIcon,
  LinkIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  UsersIcon,
  UserIcon,
  ArrowPathIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { Button, Card } from '@/components/ui-legacy';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import SlackService, {
  getBrandDefaultInfo,
  getSlackOAuthUrl,
  type EventSlackIntegration,
  type EventSlackNotification,
} from '@/utils/slackService';

interface SlackNotificationsTabProps {
  eventId: string;
  eventTitle: string;
}

// Slack icon component
function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

export function SlackNotificationsTab({ eventId, eventTitle }: SlackNotificationsTabProps) {
  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customIntegration, setCustomIntegration] = useState<EventSlackIntegration | null>(null);
  const [notifications, setNotifications] = useState<EventSlackNotification[]>([]);
  const [sendingTest, setSendingTest] = useState<string | null>(null);

  // Check URL for OAuth callback status
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slackConnected = params.get('slack_connected');
    const slackError = params.get('slack_error');

    if (slackConnected === 'true') {
      toast.success('Slack workspace connected successfully!');
      // Clean up URL
      params.delete('slack_connected');
      const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
      window.history.replaceState({}, '', newUrl);
    } else if (slackError) {
      toast.error(`Failed to connect Slack: ${slackError}`);
      params.delete('slack_error');
      const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  // Derived state
  const brandDefault = getBrandDefaultInfo();
  const hasAnyConnection = customIntegration || brandDefault?.isConfigured;
  const activeWorkspaceName = customIntegration?.team_name || brandDefault?.teamName || null;

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [integration, notificationSettings] = await Promise.all([
        SlackService.getEventSlackIntegration(eventId),
        SlackService.getEventSlackNotifications(eventId),
      ]);

      setCustomIntegration(integration);
      setNotifications(notificationSettings);
    } catch (error) {
      console.error('Error loading Slack data:', error);
      toast.error('Failed to load Slack settings');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Connect custom workspace
  const handleConnectCustomWorkspace = () => {
    try {
      const oauthUrl = getSlackOAuthUrl(eventId);
      window.location.href = oauthUrl;
    } catch (error) {
      toast.error('Slack OAuth not configured');
    }
  };

  // Disconnect custom workspace
  const handleDisconnectCustomWorkspace = async () => {
    if (!confirm('Are you sure you want to disconnect this custom Slack workspace?')) {
      return;
    }

    try {
      const success = await SlackService.deleteEventSlackIntegration(eventId);
      if (success) {
        setCustomIntegration(null);
        toast.success('Custom workspace disconnected');
      } else {
        toast.error('Failed to disconnect workspace');
      }
    } catch (error) {
      toast.error('Failed to disconnect workspace');
    }
  };

  // Get notification setting for a type
  const getNotification = (type: 'registration' | 'speaker_submission' | 'speaker_update'): EventSlackNotification | undefined => {
    return notifications.find((n) => n.notification_type === type);
  };

  // Update notification setting
  const updateNotification = async (
    type: 'registration' | 'speaker_submission' | 'speaker_update',
    updates: Partial<EventSlackNotification>
  ) => {
    setSaving(true);
    try {
      const result = await SlackService.upsertEventSlackNotification({
        event_id: eventId,
        notification_type: type,
        use_custom_workspace: !!customIntegration,
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

  // Send test or historic notification
  const handleSendTest = async (type: 'registration' | 'speaker_submission' | 'speaker_update', isHistoric: boolean) => {
    const notification = getNotification(type);
    if (!notification?.channel_id && !notification?.user_id) {
      toast.error('Please select a destination first');
      return;
    }

    // speaker_update doesn't support historic send
    if (type === 'speaker_update' && isHistoric) {
      toast.error('Historic send is not available for speaker updates');
      return;
    }

    setSendingTest(type);
    try {
      if (isHistoric) {
        const result = await SlackService.sendHistoricSlackNotifications(eventId, type as 'registration' | 'speaker_submission');
        if (result.total === 0) {
          toast.info(`No ${type === 'registration' ? 'registrations' : 'submissions'} found to send`);
        } else if (result.success) {
          toast.success(`Sent ${result.sent} of ${result.total} ${type === 'registration' ? 'registrations' : 'submissions'}`);
        } else {
          toast.error(`Sent ${result.sent}, failed ${result.failed}. ${result.error || ''}`);
        }
      } else {
        const result = await SlackService.sendTestSlackNotification(eventId, type);
        if (result.success) {
          toast.success('Test notification sent!');
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
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#4A154B]/10 dark:bg-[#4A154B]/20">
            <SlackIcon className="h-5 w-5 text-[#4A154B] dark:text-[#E01E5A]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Slack Notifications</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Send notifications to Slack when users register or speakers submit proposals
            </p>
          </div>
        </div>

        {/* Connection Status */}
        {!hasAnyConnection ? (
          // Not Connected
          <div className="mb-6 p-4 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 flex-shrink-0 mt-0.5">
                <ExclamationTriangleIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Slack Not Connected</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  {brandDefault
                    ? 'The brand default Slack workspace is not configured. Contact an administrator or connect a custom workspace.'
                    : 'Connect a Slack workspace to send automatic notifications for this event.'}
                </p>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={handleConnectCustomWorkspace}
                  className="flex items-center gap-2"
                >
                  <Cog6ToothIcon className="h-4 w-4" />
                  Connect Slack Workspace
                </Button>
              </div>
            </div>
          </div>
        ) : (
          // Connected
          <div className="mb-6 p-4 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 flex-shrink-0 mt-0.5">
                <CheckCircleIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-0.5">
                      Connected to {activeWorkspaceName}
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {customIntegration ? 'Custom workspace' : 'Brand default workspace'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {customIntegration ? (
                      <Button variant="outline" size="sm" onClick={handleDisconnectCustomWorkspace}>
                        <XMarkIcon className="h-4 w-4 mr-1" />
                        Disconnect
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={handleConnectCustomWorkspace}>
                        <Cog6ToothIcon className="h-4 w-4 mr-1" />
                        Use Custom
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Notification Types */}
        {hasAnyConnection && (
          <div className="space-y-4">
            <h4 className="text-base font-semibold text-gray-900 dark:text-white">Notification Triggers</h4>

            {/* Registration Notification */}
            <NotificationConfig
              type="registration"
              title="New Registration"
              description="Notify when someone registers for this event"
              icon={<UsersIcon className="h-4 w-4 text-green-600 dark:text-green-400" />}
              iconBg="bg-green-100 dark:bg-green-900/20"
              toggleColor="peer-checked:bg-green-600"
              notification={getNotification('registration')}
              eventId={eventId}
              saving={saving}
              sendingTest={sendingTest === 'registration'}
              onUpdate={(updates) => updateNotification('registration', updates)}
              onSendTest={(isHistoric) => handleSendTest('registration', isHistoric)}
            />

            {/* Speaker Submission Notification */}
            <NotificationConfig
              type="speaker_submission"
              title="Speaker Submission"
              description="Notify when a speaker submits a call for speakers proposal"
              icon={<UserIcon className="h-4 w-4 text-purple-600 dark:text-purple-400" />}
              iconBg="bg-purple-100 dark:bg-purple-900/20"
              toggleColor="peer-checked:bg-purple-600"
              notification={getNotification('speaker_submission')}
              eventId={eventId}
              saving={saving}
              sendingTest={sendingTest === 'speaker_submission'}
              onUpdate={(updates) => updateNotification('speaker_submission', updates)}
              onSendTest={(isHistoric) => handleSendTest('speaker_submission', isHistoric)}
            />

            {/* Speaker Update Notification */}
            <NotificationConfig
              type="speaker_update"
              title="Speaker Submission Updated"
              description="Notify when a speaker edits their submission (talk title, synopsis, bio)"
              icon={<PencilSquareIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
              iconBg="bg-blue-100 dark:bg-blue-900/20"
              toggleColor="peer-checked:bg-blue-600"
              notification={getNotification('speaker_update')}
              eventId={eventId}
              saving={saving}
              sendingTest={sendingTest === 'speaker_update'}
              onUpdate={(updates) => updateNotification('speaker_update', updates)}
              onSendTest={(isHistoric) => handleSendTest('speaker_update', isHistoric)}
              hideHistoric={true}
            />
          </div>
        )}

        {/* Help Text */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <h5 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">How Slack Notifications Work</h5>
          <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-1">•</span>
              <span>Each brand has a default Slack workspace configured by administrators</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-1">•</span>
              <span>You can override the default and connect a custom workspace for this event</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-1">•</span>
              <span>Notifications can be sent to public channels, private channels (that the bot is a member of), or as direct messages to specific users</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-1">•</span>
              <span>Messages include relevant details like attendee name, email, and registration time</span>
            </li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

// =============================================================================
// Slack Destination Picker Component
// =============================================================================

interface SlackDestinationPickerProps {
  eventId: string;
  selectedChannelId: string | null;
  selectedChannelName: string | null;
  selectedUserId: string | null;
  selectedUserName: string | null;
  disabled: boolean;
  onSelect: (destination: {
    channelId: string | null;
    channelName: string | null;
    userId: string | null;
    userEmail: string | null;
  }) => void;
}

interface SearchResult {
  type: 'public_channel' | 'private_channel' | 'user';
  id: string;
  name: string;
  displayName: string;
  subtitle?: string;
  email?: string;
}

function SlackDestinationPicker({
  eventId,
  selectedChannelId,
  selectedChannelName,
  selectedUserId,
  selectedUserName,
  disabled,
  onSelect,
}: SlackDestinationPickerProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get current display value from stored names
  const displayValue = useMemo(() => {
    if (selectedChannelId && selectedChannelName) {
      return selectedChannelName.startsWith('#') ? selectedChannelName : `# ${selectedChannelName}`;
    }
    if (selectedUserId && selectedUserName) {
      return `@ ${selectedUserName}`;
    }
    return '';
  }, [selectedChannelId, selectedChannelName, selectedUserId, selectedUserName]);

  // Determine search mode based on prefix
  const searchMode = useMemo(() => {
    if (query.startsWith('#')) return 'channels';
    if (query.startsWith('@')) return 'users';
    return 'all';
  }, [query]);

  // Perform search with debounce
  useEffect(() => {
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Don't search if no query or dropdown closed
    if (!isOpen) {
      return;
    }

    // For users, require at least 2 characters after the @ prefix
    const cleanQuery = query.startsWith('#') || query.startsWith('@') ? query.slice(1) : query;
    if (searchMode === 'users' && cleanQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    // Debounce the search
    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const destinations = await SlackService.searchSlackDestinations(eventId, query);

        const results: SearchResult[] = destinations.map((d) => ({
          type: d.type,
          id: d.id,
          name: d.name,
          displayName: d.display_name,
          subtitle: d.type === 'user' ? d.email : d.num_members ? `${d.num_members} members` : undefined,
          email: d.email,
        }));

        setSearchResults(results);
      } catch (error) {
        console.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, isOpen, eventId, searchMode]);

  // Handle selection
  const handleSelect = (result: SearchResult) => {
    if (result.type === 'user') {
      onSelect({
        channelId: null,
        channelName: null,
        userId: result.id,
        userEmail: result.email || null,
      });
    } else {
      onSelect({
        channelId: result.id,
        channelName: result.name,
        userId: null,
        userEmail: null,
      });
    }
    setQuery('');
    setIsOpen(false);
    setSearchResults([]);
  };

  // Handle clear
  const handleClear = () => {
    onSelect({
      channelId: null,
      channelName: null,
      userId: null,
      userEmail: null,
    });
    setQuery('');
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Get icon for type
  const getTypeIcon = (type: 'public_channel' | 'private_channel' | 'user') => {
    switch (type) {
      case 'public_channel':
        return <HashtagIcon className="h-4 w-4 text-gray-500 dark:text-gray-400" />;
      case 'private_channel':
        return <LockClosedIcon className="h-4 w-4 text-amber-500" />;
      case 'user':
        return <UserIcon className="h-4 w-4 text-blue-500" />;
    }
  };

  const hasSelection = selectedChannelId || selectedUserId;

  return (
    <div ref={dropdownRef} className="relative flex-1">
      {/* Input */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <MagnifyingGlassIcon className="h-4 w-4 text-gray-400" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? query : displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
            setQuery('');
          }}
          placeholder={hasSelection ? displayValue : 'Type # for channels, @ for users...'}
          disabled={disabled}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-8 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-400 dark:focus:border-primary-400"
        />
        {hasSelection && !isOpen && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
        {searching && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">
            <LoadingSpinner size="small" />
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {/* Hint */}
          {!query && (
            <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Type <span className="font-mono font-semibold text-primary-600 dark:text-primary-400">#</span> to search
                channels or <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">@</span> to search
                users (min 2 chars)
              </p>
            </div>
          )}

          {/* User search hint */}
          {searchMode === 'users' && query.length > 0 && query.length <= 2 && (
            <div className="px-3 py-3 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">Type at least 2 characters to search users...</p>
            </div>
          )}

          {/* Searching indicator */}
          {searching && (
            <div className="flex items-center justify-center gap-2 px-3 py-4">
              <LoadingSpinner size="small" />
              <span className="text-sm text-gray-500 dark:text-gray-400">Searching...</span>
            </div>
          )}

          {/* Results */}
          {!searching && searchResults.length > 0 && (
            <div className="py-1">
              {/* Group by type */}
              {searchMode === 'all' && (
                <>
                  {/* Channels section */}
                  {searchResults.some((r) => r.type !== 'user') && (
                    <div className="px-3 py-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                        Channels
                      </span>
                    </div>
                  )}
                  {searchResults
                    .filter((r) => r.type !== 'user')
                    .map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => handleSelect(result)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {getTypeIcon(result.type)}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{result.displayName}</p>
                          {result.subtitle && (
                            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{result.subtitle}</p>
                          )}
                        </div>
                      </button>
                    ))}

                  {/* Users section */}
                  {searchResults.some((r) => r.type === 'user') && (
                    <div className="mt-1 border-t border-gray-100 px-3 py-1.5 dark:border-gray-700">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                        Direct Messages
                      </span>
                    </div>
                  )}
                  {searchResults
                    .filter((r) => r.type === 'user')
                    .map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => handleSelect(result)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {getTypeIcon(result.type)}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{result.displayName}</p>
                          {result.subtitle && (
                            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{result.subtitle}</p>
                          )}
                        </div>
                      </button>
                    ))}
                </>
              )}

              {/* Single mode - just list results */}
              {searchMode !== 'all' &&
                searchResults.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => handleSelect(result)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    {getTypeIcon(result.type)}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{result.displayName}</p>
                      {result.subtitle && (
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">{result.subtitle}</p>
                      )}
                    </div>
                  </button>
                ))}
            </div>
          )}

          {/* No results */}
          {!searching && query && searchResults.length === 0 && searchMode !== 'users' && (
            <div className="px-3 py-4 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">No results found for "{query}"</p>
            </div>
          )}
          {!searching && query.length > 2 && searchResults.length === 0 && searchMode === 'users' && (
            <div className="px-3 py-4 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">No users found for "{query}"</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Notification Config Sub-component
// =============================================================================

interface NotificationConfigProps {
  type: 'registration' | 'speaker_submission' | 'speaker_update';
  title: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
  toggleColor: string;
  notification: EventSlackNotification | undefined;
  eventId: string;
  saving: boolean;
  sendingTest: boolean;
  onUpdate: (updates: Partial<EventSlackNotification>) => void;
  onSendTest: (isHistoric: boolean) => void;
  hideHistoric?: boolean;
}

function NotificationConfig({
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
  onSendTest,
  hideHistoric = false,
}: NotificationConfigProps) {
  const [sendHistoric, setSendHistoric] = useState(false);
  const isEnabled = notification?.enabled ?? false;

  const handleToggle = () => {
    onUpdate({ enabled: !isEnabled });
  };

  const handleDestinationSelect = (destination: {
    channelId: string | null;
    channelName: string | null;
    userId: string | null;
    userEmail: string | null;
  }) => {
    onUpdate({
      channel_id: destination.channelId,
      channel_name: destination.channelName,
      user_id: destination.userId,
      user_email: destination.userEmail,
    });
  };

  const hasSelection = notification?.channel_id || notification?.user_id;

  // For display, we need to derive a user name from email if available
  const selectedUserName = notification?.user_email?.split('@')[0] || null;

  const typeLabel = type === 'registration' ? 'registrations' : type === 'speaker_submission' ? 'submissions' : 'updates';

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconBg} flex-shrink-0`}>{icon}</div>
          <div>
            <h5 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h5>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={isEnabled} onChange={handleToggle} disabled={saving} className="sr-only peer" />
          <div
            className={`w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 ${toggleColor}`}
          ></div>
        </label>
      </div>

      {/* Destination Picker */}
      <div className="mt-3 pl-11 space-y-3">
        <SlackDestinationPicker
          eventId={eventId}
          selectedChannelId={notification?.channel_id || null}
          selectedChannelName={notification?.channel_name || null}
          selectedUserId={notification?.user_id || null}
          selectedUserName={selectedUserName}
          disabled={saving}
          onSelect={handleDestinationSelect}
        />

        {/* Test Controls - shows when a destination is selected */}
        {hasSelection && (
          <div className="flex items-center gap-4">
            <Button
              variant="outlined"
              className="flex items-center gap-2 text-sm"
              onClick={() => onSendTest(sendHistoric)}
              disabled={sendingTest || saving}
            >
              {sendingTest ? (
                <>
                  <LoadingSpinner size="xs" />
                  Sending...
                </>
              ) : (
                <>
                  <PaperAirplaneIcon className="h-4 w-4" />
                  {sendHistoric && !hideHistoric ? 'Send Historic' : 'Send Test'}
                </>
              )}
            </Button>

            {!hideHistoric && (
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SlackNotificationsTab;
