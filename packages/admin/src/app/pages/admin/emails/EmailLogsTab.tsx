import { useState, useEffect } from 'react';
import {
  EnvelopeIcon,
  EnvelopeOpenIcon,
  CursorArrowRippleIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  NoSymbolIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '@/lib/supabase';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { Card, Input, Button, Table, THead, TBody, Tr, Th, Td } from '@/components/ui';
import { useHasModule } from '@/hooks/useModuleFeature';

// SendGrid email log structure
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
  sent_by_admin_user_id?: string;
}

// Customer.io email event structure
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
  events?: {
    type: string;
    timestamp: string;
    linkUrl?: string;
  }[];
}

type SourceFilter = 'all' | 'sendgrid' | 'customerio';
type StatusFilter = 'all' | 'delivered' | 'opened' | 'clicked' | 'bounced';

export function EmailLogsTab() {
  const hasCIO = useHasModule('customerio');
  const [emails, setEmails] = useState<UnifiedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 50;

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
  }, [page, sourceFilter, statusFilter]);

  const fetchEmails = async () => {
    setLoading(true);
    try {
      // Fetch SendGrid emails
      let sendgridQuery = supabase
        .from('email_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      // Apply search filter if provided
      if (searchQuery) {
        sendgridQuery = sendgridQuery.or(`recipient_email.ilike.%${searchQuery}%,subject.ilike.%${searchQuery}%`);
      }

      // Fetch Customer.io email events (only when module is installed)
      let cioQueryPromise: Promise<{ data: any[] }> = Promise.resolve({ data: [] });
      if (hasCIO && sourceFilter !== 'sendgrid') {
        let cioQuery = supabase
          .from('email_events')
          .select('*')
          .order('event_timestamp', { ascending: false })
          .range((page - 1) * pageSize, page * pageSize - 1);

        if (searchQuery) {
          cioQuery = cioQuery.or(`email.ilike.%${searchQuery}%,subject.ilike.%${searchQuery}%`);
        }
        cioQueryPromise = cioQuery;
      }

      const [sendgridResult, cioResult] = await Promise.all([
        sourceFilter !== 'customerio' ? sendgridQuery : Promise.resolve({ data: [] }),
        cioQueryPromise,
      ]);

      // Process SendGrid emails
      const sendgridEmails: UnifiedEmail[] = ((sendgridResult as any).data || []).map((log: SendGridEmailLog) => ({
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

      // Process Customer.io events - group by email_id
      const cioEventsByEmailId = new Map<string, CIOEmailEvent[]>();
      ((cioResult as any).data || []).forEach((event: CIOEmailEvent) => {
        const key = event.email_id || `no-id-${event.created_at}`;
        if (!cioEventsByEmailId.has(key)) {
          cioEventsByEmailId.set(key, []);
        }
        cioEventsByEmailId.get(key)!.push(event);
      });

      const cioEmails: UnifiedEmail[] = Array.from(cioEventsByEmailId.entries()).map(([emailId, events]) => {
        events.sort((a, b) => new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime());

        const sentEvent = events.find(e => e.event_type === 'sent' || e.event_type === 'attempted');
        const deliveredEvent = events.find(e => e.event_type === 'delivered');
        const openedEvent = events.find(e => e.event_type === 'opened');
        const clickedEvents = events.filter(e => e.event_type === 'clicked');
        const bouncedEvent = events.find(e => e.event_type === 'bounced');
        const unsubscribedEvent = events.find(e => e.event_type === 'unsubscribed');
        const spammedEvent = events.find(e => e.event_type === 'spammed');

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
      let allEmails = [...sendgridEmails, ...cioEmails].sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
      );

      // Apply status filter
      if (statusFilter !== 'all') {
        allEmails = allEmails.filter(email => {
          switch (statusFilter) {
            case 'delivered': return !!email.deliveredAt;
            case 'opened': return !!email.openedAt;
            case 'clicked': return !!email.clickedAt;
            case 'bounced': return !!email.bouncedAt;
            default: return true;
          }
        });
      }

      setEmails(allEmails);
      setHasMore(allEmails.length === pageSize);

      // Calculate stats (only on first page without filters for accuracy)
      if (page === 1 && sourceFilter === 'all' && statusFilter === 'all' && !searchQuery) {
        const total = allEmails.length;
        const delivered = allEmails.filter(e => e.deliveredAt).length;
        const opened = allEmails.filter(e => e.openedAt).length;
        const clicked = allEmails.filter(e => e.clickedAt).length;
        const bounced = allEmails.filter(e => e.bouncedAt).length;
        const sendgridCount = sendgridEmails.length;
        const cioCount = cioEmails.length;
        setStats({ total, delivered, opened, clicked, bounced, sendgridCount, cioCount });
      }
    } catch (error) {
      console.error('Error fetching emails:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(1);
    fetchEmails();
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

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Total Sent</div>
          {hasCIO && (
            <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              {stats.sendgridCount} SG / {stats.cioCount} CIO
            </div>
          )}
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

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Search
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="Search by email or subject..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1"
              />
              <Button onClick={handleSearch} variant="outlined" className="gap-1">
                <MagnifyingGlassIcon className="size-4" />
                Search
              </Button>
            </div>
          </div>

          {/* Source Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Source
            </label>
            <select
              value={sourceFilter}
              onChange={(e) => { setSourceFilter(e.target.value as SourceFilter); setPage(1); }}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Sources</option>
              <option value="sendgrid">SendGrid</option>
              {hasCIO && <option value="customerio">Customer.io</option>}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Status</option>
              <option value="delivered">Delivered</option>
              <option value="opened">Opened</option>
              <option value="clicked">Clicked</option>
              <option value="bounced">Bounced</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Email List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner size="medium" />
        </div>
      ) : emails.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <EnvelopeIcon className="size-12 mx-auto mb-4 opacity-50" />
          <p>No emails found matching your filters.</p>
        </div>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <Tr>
                    <Th>Recipient</Th>
                    <Th>Subject</Th>
                    <Th>Source</Th>
                    <Th>Status</Th>
                    <Th>Sent</Th>
                  </Tr>
                </THead>
                <TBody>
                  {emails.map((email) => (
                    <Tr key={email.id}>
                      <Td>
                        <div className="text-sm font-medium truncate max-w-[200px]">
                          {email.email}
                        </div>
                        {email.fromAddress && (
                          <div className="text-xs text-[var(--gray-a11)] truncate max-w-[200px]">
                            From: {email.fromAddress}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <div className="text-sm truncate max-w-[300px]">
                          {email.subject}
                        </div>
                      </Td>
                      <Td>
                        {getSourceBadge(email.source)}
                      </Td>
                      <Td>
                        <div className="flex flex-col gap-1">
                          {getStatusBadge(email)}
                          {email.clickCount && email.clickCount > 1 && (
                            <span className="text-xs text-[var(--gray-a11)]">{email.clickCount} clicks</span>
                          )}
                        </div>
                      </Td>
                      <Td>
                        {formatDate(email.sentAt)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </Card>

          {/* Pagination */}
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Page {page}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outlined"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <Button
                variant="outlined"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={!hasMore}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
