// @ts-nocheck
import { useEffect, useState, useCallback } from 'react';
import {
  Loader2,
  Search,
  RefreshCw,
  Signal,
  Check,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ConversionEvent {
  id: string;
  tracking_session_id: string | null;
  registration_id: string | null;
  event_id: string | null;
  platform: string;
  event_name: string;
  dedup_event_id: string | null;
  request_payload: Record<string, unknown> | null;
  request_url: string | null;
  response_payload: Record<string, unknown> | null;
  http_status: number | null;
  status: string | null;
  error_message: string | null;
  sent_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  // Enriched from session join
  session_click_ids?: Record<string, string> | null;
}

interface TrackingSession {
  id: string;
  session_id: string;
  click_ids: Record<string, string> | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  status: string | null;
  matched_registration_id: string | null;
  matched_via: string | null;
  conversions_sent: Record<string, unknown> | null;
  created_at: string | null;
}

interface Props {
  eventId: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PLATFORM_COLORS: Record<string, string> = {
  meta: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  google: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  reddit: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  linkedin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  bing: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
  tiktok: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
};

const PLATFORM_CLICK_ID_KEYS: Record<string, string> = {
  meta: 'fbclid',
  google: 'gclid',
  reddit: 'rdt_cid',
  linkedin: 'li_fat_id',
  bing: 'msclkid',
  tiktok: 'ttclid',
};

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  sent: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const SESSION_STATUS_COLORS: Record<string, string> = {
  converted: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  expired: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function truncateId(id: string | null): string {
  if (!id) return '\u2014';
  return id.length > 12 ? `${id.slice(0, 12)}\u2026` : id;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '\u2014';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function hasMatchingClickId(conv: ConversionEvent): boolean {
  const clickIds = conv.session_click_ids;
  if (!clickIds || Object.keys(clickIds).length === 0) return false;
  const expectedKey = PLATFORM_CLICK_ID_KEYS[conv.platform];
  if (!expectedKey) return Object.keys(clickIds).length > 0;
  return !!clickIds[expectedKey];
}

/* ------------------------------------------------------------------ */
/*  Stat Card                                                          */
/* ------------------------------------------------------------------ */

function StatCard({ label, value, className }: { label: string; value: number | string; className?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className={`text-2xl font-semibold mt-1 ${className ?? ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function EventTrackingTab({ eventId }: Props) {
  const [conversions, setConversions] = useState<ConversionEvent[]>([]);
  const [sessions, setSessions] = useState<TrackingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [convSearch, setConvSearch] = useState('');
  const [sessSearch, setSessSearch] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* --- Data fetching ------------------------------------------------ */

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();

      const [convRes, sessRes] = await Promise.all([
        supabase
          .from('conversion_events_log')
          .select('*')
          .eq('event_id', eventId)
          .order('created_at', { ascending: false }),
        supabase
          .from('ad_tracking_sessions')
          .select('*')
          .eq('event_id', eventId)
          .order('created_at', { ascending: false }),
      ]);

      if (convRes.error) throw convRes.error;
      if (sessRes.error) throw sessRes.error;

      const sessionsData = (sessRes.data ?? []) as TrackingSession[];
      const sessionMap = new Map<string, TrackingSession>();
      for (const s of sessionsData) sessionMap.set(s.id, s);

      const enriched = (convRes.data ?? []).map((c: ConversionEvent) => {
        const session = c.tracking_session_id ? sessionMap.get(c.tracking_session_id) : null;
        return { ...c, session_click_ids: session?.click_ids ?? null };
      });

      setConversions(enriched);
      setSessions(sessionsData);
    } catch (err) {
      console.error('Error fetching tracking data:', err);
      toast.error('Failed to load tracking data');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* --- Derived stats ------------------------------------------------ */

  const convSuccess = conversions.filter((c) => c.status === 'success' || c.status === 'sent').length;
  const convFailed = conversions.filter((c) => c.status === 'failed' || c.status === 'error').length;
  const platformCounts = conversions.reduce<Record<string, number>>((acc, c) => {
    acc[c.platform] = (acc[c.platform] || 0) + 1;
    return acc;
  }, {});

  const sessConverted = sessions.filter((s) => s.status === 'converted').length;
  const sessPending = sessions.filter((s) => s.status === 'pending').length;
  const sessExpired = sessions.filter((s) => s.status === 'expired').length;

  /* --- Filtering ---------------------------------------------------- */

  const filteredConversions = conversions.filter((c) => {
    if (!convSearch) return true;
    const q = convSearch.toLowerCase();
    return c.platform.toLowerCase().includes(q) || c.event_name.toLowerCase().includes(q);
  });

  const filteredSessions = sessions.filter((s) => {
    if (!sessSearch) return true;
    const q = sessSearch.toLowerCase();
    return (
      s.session_id.toLowerCase().includes(q) ||
      (s.utm_source ?? '').toLowerCase().includes(q)
    );
  });

  /* --- Loading state ------------------------------------------------ */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  /* --- Render ------------------------------------------------------- */

  return (
    <Tabs defaultValue="conversions" className="space-y-4">
      <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="conversions">Conversions</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
        </TabsList>
      </div>

      {/* ============================================================= */}
      {/*  CONVERSIONS TAB                                               */}
      {/* ============================================================= */}
      <TabsContent value="conversions" className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total" value={conversions.length} />
          <StatCard label="Success" value={convSuccess} className="text-green-600 dark:text-green-400" />
          <StatCard label="Failed" value={convFailed} className="text-red-600 dark:text-red-400" />
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Platforms</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {Object.entries(platformCounts).map(([platform, count]) => (
                  <Badge key={platform} className={PLATFORM_COLORS[platform] ?? 'bg-gray-100 text-gray-800'}>
                    {platform} ({count})
                  </Badge>
                ))}
                {Object.keys(platformCounts).length === 0 && (
                  <span className="text-sm text-muted-foreground">{'\u2014'}</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search + Refresh */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by platform or event name..."
              className="pl-8"
              value={convSearch}
              onChange={(e) => setConvSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon" onClick={fetchData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Table */}
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Platform</TableHead>
                <TableHead>Event Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Attribution</TableHead>
                <TableHead>Sent At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredConversions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No conversion events found
                  </TableCell>
                </TableRow>
              ) : (
                filteredConversions.map((conv) => {
                  const isExpanded = expandedRows.has(conv.id);
                  const hasAttr = hasMatchingClickId(conv);
                  const statusClass = STATUS_COLORS[conv.status ?? ''] ?? 'bg-gray-100 text-gray-800';

                  return (
                    <Collapsible key={conv.id} open={isExpanded} onOpenChange={() => toggleRow(conv.id)} asChild>
                      <>
                        <CollapsibleTrigger asChild>
                          <TableRow className="cursor-pointer hover:bg-muted/50">
                            <TableCell>
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge className={PLATFORM_COLORS[conv.platform] ?? 'bg-gray-100 text-gray-800'}>
                                {conv.platform}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{conv.event_name}</TableCell>
                            <TableCell>
                              <Badge className={statusClass}>{conv.status ?? 'pending'}</Badge>
                            </TableCell>
                            <TableCell>
                              <span
                                className={`font-mono text-sm ${
                                  conv.http_status && conv.http_status >= 200 && conv.http_status < 300
                                    ? 'text-green-600 dark:text-green-400'
                                    : conv.http_status
                                      ? 'text-red-600 dark:text-red-400'
                                      : 'text-muted-foreground'
                                }`}
                              >
                                {conv.http_status ?? '\u2014'}
                              </span>
                            </TableCell>
                            <TableCell>
                              {hasAttr ? (
                                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                                  <Check className="h-4 w-4" />
                                  <span className="text-xs">Has click ID</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                                  <AlertTriangle className="h-4 w-4" />
                                  <span className="text-xs">No attribution</span>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatTimestamp(conv.sent_at ?? conv.created_at)}
                            </TableCell>
                          </TableRow>
                        </CollapsibleTrigger>
                        <CollapsibleContent asChild>
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={7} className="p-4">
                              <div className="space-y-3">
                                {conv.error_message && (
                                  <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                                    {conv.error_message}
                                  </div>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                                      Request Payload
                                    </p>
                                    <pre className="text-xs font-mono rounded border bg-background p-3 overflow-x-auto max-h-48">
                                      {conv.request_payload ? JSON.stringify(conv.request_payload, null, 2) : '\u2014'}
                                    </pre>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                                      Response Payload
                                    </p>
                                    <pre className="text-xs font-mono rounded border bg-background p-3 overflow-x-auto max-h-48">
                                      {conv.response_payload ? JSON.stringify(conv.response_payload, null, 2) : '\u2014'}
                                    </pre>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                                  <span>Registration: <code>{truncateId(conv.registration_id)}</code></span>
                                  <span>Session: <code>{truncateId(conv.tracking_session_id)}</code></span>
                                  <span>Dedup ID: <code>{conv.dedup_event_id ?? '\u2014'}</code></span>
                                  {conv.request_url && (
                                    <a
                                      href={conv.request_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                                    >
                                      Request URL <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        </CollapsibleContent>
                      </>
                    </Collapsible>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </TabsContent>

      {/* ============================================================= */}
      {/*  SESSIONS TAB                                                  */}
      {/* ============================================================= */}
      <TabsContent value="sessions" className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Sessions" value={sessions.length} />
          <StatCard label="Converted" value={sessConverted} className="text-green-600 dark:text-green-400" />
          <StatCard label="Pending" value={sessPending} className="text-yellow-600 dark:text-yellow-400" />
          <StatCard label="Expired" value={sessExpired} className="text-muted-foreground" />
        </div>

        {/* Search + Refresh */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by session ID or UTM source..."
              className="pl-8"
              value={sessSearch}
              onChange={(e) => setSessSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon" onClick={fetchData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Table */}
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Session ID</TableHead>
                <TableHead>Click IDs</TableHead>
                <TableHead>UTM Source</TableHead>
                <TableHead>UTM Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Matched Registration</TableHead>
                <TableHead>Created At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No tracking sessions found
                  </TableCell>
                </TableRow>
              ) : (
                filteredSessions.map((sess) => {
                  const isExpanded = expandedRows.has(sess.id);
                  const statusClass =
                    SESSION_STATUS_COLORS[sess.status ?? ''] ?? 'bg-gray-100 text-gray-800';
                  const clickIdEntries = sess.click_ids ? Object.entries(sess.click_ids) : [];

                  return (
                    <Collapsible key={sess.id} open={isExpanded} onOpenChange={() => toggleRow(sess.id)} asChild>
                      <>
                        <CollapsibleTrigger asChild>
                          <TableRow className="cursor-pointer hover:bg-muted/50">
                            <TableCell>
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-sm">{truncateId(sess.session_id)}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {clickIdEntries.length === 0 ? (
                                  <span className="text-sm text-amber-500">None</span>
                                ) : (
                                  clickIdEntries.map(([key]) => (
                                    <Badge
                                      key={key}
                                      className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs"
                                    >
                                      {key}
                                    </Badge>
                                  ))
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">{sess.utm_source ?? '\u2014'}</TableCell>
                            <TableCell className="text-sm">{sess.utm_campaign ?? '\u2014'}</TableCell>
                            <TableCell>
                              <Badge className={statusClass}>{sess.status ?? 'pending'}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {truncateId(sess.matched_registration_id)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatTimestamp(sess.created_at)}
                            </TableCell>
                          </TableRow>
                        </CollapsibleTrigger>
                        <CollapsibleContent asChild>
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={8} className="p-4">
                              <div className="space-y-3">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                                      Full Session ID
                                    </p>
                                    <code className="text-xs break-all">{sess.session_id}</code>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                                      UTM Medium
                                    </p>
                                    <span>{sess.utm_medium ?? '\u2014'}</span>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                                      Matched Via
                                    </p>
                                    <span>{sess.matched_via ?? '\u2014'}</span>
                                  </div>
                                </div>

                                {clickIdEntries.length > 0 && (
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                                      All Click IDs
                                    </p>
                                    <div className="space-y-1">
                                      {clickIdEntries.map(([key, value]) => (
                                        <div key={key} className="flex items-center gap-2 text-xs">
                                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                            {key}
                                          </Badge>
                                          <code className="break-all">{value}</code>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {sess.conversions_sent && Object.keys(sess.conversions_sent).length > 0 && (
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                                      Conversions Sent
                                    </p>
                                    <pre className="text-xs font-mono rounded border bg-background p-3 overflow-x-auto max-h-48">
                                      {JSON.stringify(sess.conversions_sent, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        </CollapsibleContent>
                      </>
                    </Collapsible>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
