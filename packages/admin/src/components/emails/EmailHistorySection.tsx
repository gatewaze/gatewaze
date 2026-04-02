import { useState, useEffect } from 'react';
import {
  EnvelopeIcon,
  EnvelopeOpenIcon,
  CursorArrowRippleIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  NoSymbolIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '@/lib/supabase';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { useHasModule } from '@/hooks/useModuleFeature';

// SendGrid email log structure (single record per email)
interface SendGridEmailLog {
  id: string;
  recipient_email: string;
  from_address: string;
  subject: string;
  status: string;
  created_at: string;
  delivered_at?: string;
  opened_at?: string;
  first_clicked_at?: string;
  click_count?: number;
  bounced_at?: string;
  bounce_reason?: string;
  unsubscribed_at?: string;
  spam_reported_at?: string;
}

// Customer.io email event structure (one record per event)
interface CIOEmailEvent {
  id: string;
  email: string;
  event_type: string;
  email_id?: string;
  campaign_id?: string;
  broadcast_id?: string;
  subject?: string;
  recipient?: string;
  link_url?: string;
  bounce_type?: string;
  failure_reason?: string;
  event_timestamp: string;
  created_at: string;
}

// Unified email display structure
interface UnifiedEmail {
  id: string;
  source: 'sendgrid' | 'customerio';
  email: string;
  subject: string;
  fromAddress?: string;
  sentAt: string;
  deliveredAt?: string;
  openedAt?: string;
  clickedAt?: string;
  clickCount?: number;
  bouncedAt?: string;
  bounceReason?: string;
  unsubscribedAt?: string;
  spamReportedAt?: string;
  // For CIO: track individual events
  events?: {
    type: string;
    timestamp: string;
    linkUrl?: string;
  }[];
}

interface EmailHistorySectionProps {
  customerEmail: string;
  customerId?: number;
}

export function EmailHistorySection({ customerEmail, customerId }: EmailHistorySectionProps) {
  const hasCIO = useHasModule('customerio');
  const [emails, setEmails] = useState<UnifiedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSource, setActiveSource] = useState<'all' | 'sendgrid' | 'customerio'>('all');
  const [stats, setStats] = useState({
    total: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    sendgridCount: 0,
    cioCount: 0,
  });

  useEffect(() => {
    fetchEmails();
  }, [customerEmail, customerId]);

  const fetchEmails = async () => {
    setLoading(true);
    try {
      // Fetch SendGrid emails
      let sendgridQuery = supabase
        .from('email_logs')
        .select('*')
        .order('created_at', { ascending: false });

      if (customerId) {
        sendgridQuery = sendgridQuery.eq('recipient_customer_id', customerId);
      } else {
        sendgridQuery = sendgridQuery.ilike('recipient_email', customerEmail);
      }

      // Fetch Customer.io email events (only when module is installed)
      const cioQueryPromise = hasCIO
        ? supabase
            .from('email_events')
            .select('*')
            .ilike('email', customerEmail)
            .order('event_timestamp', { ascending: false })
        : Promise.resolve({ data: [] as CIOEmailEvent[] });

      const [sendgridResult, cioResult] = await Promise.all([
        sendgridQuery,
        cioQueryPromise,
      ]);

      // Process SendGrid emails
      const sendgridEmails: UnifiedEmail[] = (sendgridResult.data || []).map((log: SendGridEmailLog) => ({
        id: `sg-${log.id}`,
        source: 'sendgrid' as const,
        email: log.recipient_email,
        subject: log.subject,
        fromAddress: log.from_address,
        sentAt: log.created_at,
        deliveredAt: log.delivered_at,
        openedAt: log.opened_at,
        clickedAt: log.first_clicked_at,
        clickCount: log.click_count,
        bouncedAt: log.bounced_at,
        bounceReason: log.bounce_reason,
        unsubscribedAt: log.unsubscribed_at,
        spamReportedAt: log.spam_reported_at,
      }));

      // Process Customer.io events - group by email_id to create unified email records
      const cioEventsByEmailId = new Map<string, CIOEmailEvent[]>();
      (cioResult.data || []).forEach((event: CIOEmailEvent) => {
        const key = event.email_id || `no-id-${event.created_at}`;
        if (!cioEventsByEmailId.has(key)) {
          cioEventsByEmailId.set(key, []);
        }
        cioEventsByEmailId.get(key)!.push(event);
      });

      const cioEmails: UnifiedEmail[] = Array.from(cioEventsByEmailId.entries()).map(([emailId, events]) => {
        // Sort events by timestamp
        events.sort((a, b) => new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime());

        // Find specific event types
        const sentEvent = events.find(e => e.event_type === 'sent' || e.event_type === 'attempted');
        const deliveredEvent = events.find(e => e.event_type === 'delivered');
        const openedEvent = events.find(e => e.event_type === 'opened');
        const clickedEvents = events.filter(e => e.event_type === 'clicked');
        const bouncedEvent = events.find(e => e.event_type === 'bounced');
        const unsubscribedEvent = events.find(e => e.event_type === 'unsubscribed');
        const spammedEvent = events.find(e => e.event_type === 'spammed');

        // Use the first event for basic info
        const firstEvent = events[0];

        return {
          id: `cio-${emailId}`,
          source: 'customerio' as const,
          email: firstEvent.email,
          subject: firstEvent.subject || '(No subject)',
          sentAt: sentEvent?.event_timestamp || firstEvent.event_timestamp,
          deliveredAt: deliveredEvent?.event_timestamp,
          openedAt: openedEvent?.event_timestamp,
          clickedAt: clickedEvents[0]?.event_timestamp,
          clickCount: clickedEvents.length || undefined,
          bouncedAt: bouncedEvent?.event_timestamp,
          bounceReason: bouncedEvent?.failure_reason || bouncedEvent?.bounce_type,
          unsubscribedAt: unsubscribedEvent?.event_timestamp,
          spamReportedAt: spammedEvent?.event_timestamp,
          events: events.map(e => ({
            type: e.event_type,
            timestamp: e.event_timestamp,
            linkUrl: e.link_url,
          })),
        };
      });

      // Combine and sort by sent date
      const allEmails = [...sendgridEmails, ...cioEmails].sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
      );

      setEmails(allEmails);

      // Calculate stats
      const total = allEmails.length;
      const delivered = allEmails.filter(e => e.deliveredAt).length;
      const opened = allEmails.filter(e => e.openedAt).length;
      const clicked = allEmails.filter(e => e.clickedAt).length;
      const bounced = allEmails.filter(e => e.bouncedAt).length;
      const sendgridCount = sendgridEmails.length;
      const cioCount = cioEmails.length;

      setStats({ total, delivered, opened, clicked, bounced, sendgridCount, cioCount });
    } catch (error) {
      console.error('Error fetching emails:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadge = (email: UnifiedEmail) => {
    if (email.bouncedAt) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
          <ExclamationCircleIcon className="size-3" />
          Bounced
        </span>
      );
    }
    if (email.spamReportedAt) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
          <NoSymbolIcon className="size-3" />
          Spam
        </span>
      );
    }
    if (email.clickedAt) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
          <CursorArrowRippleIcon className="size-3" />
          Clicked
        </span>
      );
    }
    if (email.openedAt) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
          <EnvelopeOpenIcon className="size-3" />
          Opened
        </span>
      );
    }
    if (email.deliveredAt) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
          <CheckCircleIcon className="size-3" />
          Delivered
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200">
        <EnvelopeIcon className="size-3" />
        Sent
      </span>
    );
  };

  const getSourceBadge = (source: 'sendgrid' | 'customerio') => {
    if (source === 'sendgrid') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          SendGrid
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        Customer.io
      </span>
    );
  };

  const filteredEmails = activeSource === 'all'
    ? emails
    : emails.filter(e => e.source === activeSource);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="medium" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Total Sent</div>
          <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            {stats.sendgridCount} SG / {stats.cioCount} CIO
          </div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
          <div className="text-2xl font-bold text-green-900 dark:text-green-200">{stats.delivered}</div>
          <div className="text-sm text-green-600 dark:text-green-400">Delivered</div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
          <div className="text-2xl font-bold text-blue-900 dark:text-blue-200">{stats.opened}</div>
          <div className="text-sm text-blue-600 dark:text-blue-400">Opened</div>
        </div>
        <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
          <div className="text-2xl font-bold text-purple-900 dark:text-purple-200">{stats.clicked}</div>
          <div className="text-sm text-purple-600 dark:text-purple-400">Clicked</div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
          <div className="text-2xl font-bold text-red-900 dark:text-red-200">{stats.bounced}</div>
          <div className="text-sm text-red-600 dark:text-red-400">Bounced</div>
        </div>
      </div>

      {/* Source Filter */}
      {(stats.sendgridCount > 0 && stats.cioCount > 0) && (
        <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700 pb-4">
          <button
            onClick={() => setActiveSource('all')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              activeSource === 'all'
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            All ({stats.total})
          </button>
          <button
            onClick={() => setActiveSource('sendgrid')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              activeSource === 'sendgrid'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            SendGrid ({stats.sendgridCount})
          </button>
          {hasCIO && (
            <button
              onClick={() => setActiveSource('customerio')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                activeSource === 'customerio'
                  ? 'bg-emerald-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              Customer.io ({stats.cioCount})
            </button>
          )}
        </div>
      )}

      {/* Email List */}
      {filteredEmails.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <EnvelopeIcon className="size-12 mx-auto mb-4 opacity-50" />
          <p>No emails sent to this member yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEmails.map((email) => (
            <div
              key={email.id}
              className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {getStatusBadge(email)}
                    {getSourceBadge(email.source)}
                    {email.unsubscribedAt && (
                      <span className="text-xs text-orange-600 dark:text-orange-400">Unsubscribed</span>
                    )}
                  </div>
                  <h4 className="font-medium text-gray-900 dark:text-white truncate">{email.subject}</h4>
                  {email.fromAddress && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      From: {email.fromAddress}
                    </p>
                  )}
                  <div className="text-xs text-gray-500 dark:text-gray-500 mt-2 space-y-1">
                    <div>Sent: {formatDate(email.sentAt)}</div>
                    {email.deliveredAt && <div>Delivered: {formatDate(email.deliveredAt)}</div>}
                    {email.openedAt && <div>Opened: {formatDate(email.openedAt)}</div>}
                    {email.clickedAt && (
                      <div>
                        Clicked: {formatDate(email.clickedAt)}
                        {email.clickCount && email.clickCount > 1 && ` (${email.clickCount} times)`}
                      </div>
                    )}
                    {email.bouncedAt && (
                      <div className="text-red-600 dark:text-red-400">
                        Bounced: {formatDate(email.bouncedAt)}
                        {email.bounceReason && ` - ${email.bounceReason}`}
                      </div>
                    )}
                  </div>
                  {/* Show CIO event timeline for expanded detail */}
                  {email.source === 'customerio' && email.events && email.events.length > 1 && (
                    <details className="mt-3">
                      <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                        View {email.events.length} events
                      </summary>
                      <div className="mt-2 pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-1">
                        {email.events.map((event, idx) => (
                          <div key={idx} className="text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-medium capitalize">{event.type}</span>
                            {' - '}
                            {formatDate(event.timestamp)}
                            {event.linkUrl && (
                              <span className="ml-1 text-blue-500 truncate block max-w-xs" title={event.linkUrl}>
                                {event.linkUrl}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
