/**
 * Shared sending panel — one component for newsletters, broadcasts, and event
 * comms, driven by a per-domain `SendingAdapter` (see ./types). Generalised from
 * the newsletter EditionSendingTab on the uniform parent→sends→recipients model:
 * a parent has many send instances, each with status, schedule, and a realtime
 * delivery log.
 *
 * FIRST CUT — built headless (typecheck + eslint only). Needs visual QA in the
 * admin. Behaviour mirrors the proven newsletter sending tab; the per-domain
 * email-details editing, recipients edit affordance, and test send are new.
 */
import { useState, useEffect, useCallback, useRef, type ChangeEvent, type MouseEvent } from 'react';
import {
  PaperAirplaneIcon, ClockIcon, CheckCircleIcon, XCircleIcon, PauseIcon, PlayIcon,
  ArrowPathIcon, EnvelopeIcon, PencilSquareIcon, BeakerIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Card, Button, Badge } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { getSupabaseConfig } from '@/config/brands';
import type {
  SendingAdapter, SendRecord, EmailDetails, ScheduleType, DeliveryStrategy, SendComposerConfig,
} from './types';

interface SendLogEntry {
  id: string;
  recipient_email: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  first_opened_at: string | null;
  first_clicked_at: string | null;
  bounced_at: string | null;
  failure_error: string | null;
  created_at: string;
}
interface TimezoneBreakdownRow {
  timezone: string; recipients: number; pending: number; sent: number; failed: number; skipped: number; send_at: string;
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  queued: { color: 'gray', label: 'Queued' },
  sent: { color: 'blue', label: 'Sent' },
  delivered: { color: 'green', label: 'Delivered' },
  send_failed: { color: 'red', label: 'Failed' },
  permanently_failed: { color: 'red', label: 'Failed' },
  bounced: { color: 'orange', label: 'Bounced' },
  opened: { color: 'green', label: 'Opened' },
  clicked: { color: 'green', label: 'Clicked' },
};

const SEND_LOG_PAGE_SIZE = 50;

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const TIMEZONES: string[] = (() => {
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof sv === 'function') return sv('timeZone');
  } catch { /* fall through */ }
  return ['UTC', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];
})();

function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

function formatCountdown(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  if (diff <= 0) return 'due now';
  const total = Math.floor(diff / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  if (mins > 0) return `in ${mins}m ${secs}s`;
  return `in ${secs}s`;
}

function tzRowStatus(r: TimezoneBreakdownRow, nowMs: number): { label: string; color: string } {
  if (r.pending === 0) {
    if (r.sent > 0) return { label: 'Sent', color: 'green' };
    if (r.skipped > 0) return { label: 'Cancelled', color: 'gray' };
    if (r.failed > 0) return { label: 'Failed', color: 'red' };
    return { label: '—', color: 'gray' };
  }
  if (r.sent > 0) return { label: 'Sending', color: 'blue' };
  const ts = new Date(r.send_at).getTime();
  if (nowMs >= ts) return { label: 'Sending', color: 'blue' };
  return { label: `Sends ${formatCountdown(ts, nowMs)}`, color: 'amber' };
}

const INPUT_CLS = 'w-full px-3 py-1.5 text-sm border border-[var(--gray-a6)] rounded-md bg-[var(--color-surface)]';

export function SendingPanel({ adapter }: { adapter: SendingAdapter }) {
  const { parentId, canSend, canSendReason } = adapter;
  const hasParent = !!parentId;

  const [sends, setSends] = useState<SendRecord[]>([]);
  const [sendLog, setSendLog] = useState<SendLogEntry[]>([]);
  const [sendLogPage, setSendLogPage] = useState(0);
  const [sendLogTotal, setSendLogTotal] = useState(0);
  const [openedCount, setOpenedCount] = useState(0);
  const [selectedSendId, setSelectedSendId] = useState<string | null>(null);
  const [tzBreakdown, setTzBreakdown] = useState<Record<string, TimezoneBreakdownRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [scheduleType, setScheduleType] = useState<ScheduleType>('immediate');
  const [scheduledAt, setScheduledAt] = useState('');
  const [deliveryStrategy, setDeliveryStrategy] = useState<DeliveryStrategy>('global');
  const [targetLocal, setTargetLocal] = useState('09:00');
  const [defaultTimezone, setDefaultTimezone] = useState<string>(() => browserTimezone());
  const [excludeSentSendIds, setExcludeSentSendIds] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Email-details inline editing (broadcast/event only).
  const [details, setDetails] = useState<EmailDetails>(adapter.emailDetails.values);
  const [savingDetails, setSavingDetails] = useState(false);
  useEffect(() => { setDetails(adapter.emailDetails.values); }, [adapter.emailDetails.values]);

  // Test send.
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  // Live "will send to N recipients" — the real deliverable count for the
  // current exclusions (audience minus already-sent overlap), not a subtraction.
  const [recipientEstimate, setRecipientEstimate] = useState<number | null>(adapter.recipientCount ?? null);
  const [countingRecipients, setCountingRecipients] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!adapter.countRecipients) { setRecipientEstimate(adapter.recipientCount ?? null); return; }
    setCountingRecipients(true);
    const t = setTimeout(async () => {
      try {
        const n = await adapter.countRecipients!(excludeSentSendIds);
        if (!cancelled) setRecipientEstimate(n);
      } catch {
        if (!cancelled) setRecipientEstimate(adapter.recipientCount ?? null);
      } finally {
        if (!cancelled) setCountingRecipients(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [excludeSentSendIds, adapter]);

  const formTargetMs = scheduleType === 'scheduled' && scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  const hasActiveRow = sends.some((s) => s.status === 'scheduled' || s.status === 'sending' || s.status === 'cancelling');
  const needCountdown = (Number.isFinite(formTargetMs) && formTargetMs > now) || hasActiveRow;
  useEffect(() => {
    if (!needCountdown) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [needCountdown]);

  const loadSends = useCallback(async () => {
    if (!hasParent) { setLoading(false); return; }
    const { data } = await supabase
      .from(adapter.sendsTable)
      .select('*')
      .eq(adapter.parentFkColumn, parentId)
      .order('created_at', { ascending: false });
    setSends((data as SendRecord[]) || []);
    if (data && data.length > 0) setSelectedSendId((cur) => cur ?? data[0].id);
    setLoading(false);
  }, [hasParent, adapter.sendsTable, adapter.parentFkColumn, parentId]);
  useEffect(() => { loadSends(); }, [loadSends]);

  const loadSendLog = useCallback(async () => {
    if (!selectedSendId) { setSendLog([]); setSendLogTotal(0); return; }
    const from = sendLogPage * SEND_LOG_PAGE_SIZE;
    const { data, count } = await supabase
      .from('email_send_log')
      .select('id, recipient_email, status, sent_at, delivered_at, first_opened_at, first_clicked_at, bounced_at, failure_error, created_at', { count: 'exact' })
      .eq(adapter.logSendIdColumn, selectedSendId)
      .order('created_at', { ascending: true })
      .range(from, from + SEND_LOG_PAGE_SIZE - 1);
    setSendLog((data as SendLogEntry[]) || []);
    if (count != null) setSendLogTotal(count);
  }, [selectedSendId, sendLogPage, adapter.logSendIdColumn]);

  const loadOpenedCount = useCallback(async () => {
    if (!selectedSendId) { setOpenedCount(0); return; }
    const { count } = await supabase
      .from('email_send_log')
      .select('id', { count: 'exact', head: true })
      .eq(adapter.logSendIdColumn, selectedSendId)
      .not('first_opened_at', 'is', null);
    setOpenedCount(count || 0);
  }, [selectedSendId, adapter.logSendIdColumn]);

  const loadBreakdown = useCallback(async (sendId: string) => {
    if (!adapter.tzBreakdownRpc) return;
    const { data } = await supabase.rpc(adapter.tzBreakdownRpc, { p_send_id: sendId });
    setTzBreakdown((prev) => ({ ...prev, [sendId]: (data as TimezoneBreakdownRow[] | null) ?? [] }));
  }, [adapter.tzBreakdownRpc]);

  useEffect(() => { loadSendLog(); }, [loadSendLog]);
  useEffect(() => { loadOpenedCount(); }, [loadOpenedCount]);
  useEffect(() => { if (selectedSendId) loadBreakdown(selectedSendId); }, [selectedSendId, loadBreakdown]);
  useEffect(() => {
    for (const s of sends) {
      if ((s.status === 'sending' || s.status === 'cancelling') && !tzBreakdown[s.id]) loadBreakdown(s.id);
    }
  }, [sends, tzBreakdown, loadBreakdown]);
  useEffect(() => { setSendLogPage(0); }, [selectedSendId]);

  const refreshRef = useRef<() => void>(() => {});
  refreshRef.current = () => { loadSendLog(); loadOpenedCount(); if (selectedSendId) loadBreakdown(selectedSendId); };
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => refreshRef.current(), 400);
  }, []);

  // Realtime: send rows for this parent + log rows for the selected send.
  useEffect(() => {
    if (!hasParent) return;
    const channel = supabase
      .channel(`sends:${adapter.sendsTable}:${parentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: adapter.sendsTable, filter: `${adapter.parentFkColumn}=eq.${parentId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as SendRecord;
            setSends((prev) => (prev.some((s) => s.id === row.id) ? prev : [row, ...prev]));
            setSelectedSendId((cur) => cur ?? row.id);
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as SendRecord;
            setSends((prev) => prev.map((s) => (s.id === row.id ? { ...s, ...row } : s)));
          } else if (payload.eventType === 'DELETE') {
            const row = payload.old as { id: string };
            setSends((prev) => prev.filter((s) => s.id !== row.id));
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hasParent, adapter.sendsTable, adapter.parentFkColumn, parentId]);

  useEffect(() => {
    if (!selectedSendId) return;
    const channel = supabase
      .channel(`email-send-log:${adapter.logSendIdColumn}:${selectedSendId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_send_log', filter: `${adapter.logSendIdColumn}=eq.${selectedSendId}` },
        () => scheduleRefresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedSendId, adapter.logSendIdColumn, scheduleRefresh]);

  const handleSend = async () => {
    if (!hasParent) { toast.error(canSendReason || 'Save first'); return; }
    if (!canSend) { toast.error(canSendReason || 'Cannot send yet'); return; }
    setSending(true);
    try {
      const config: SendComposerConfig = {
        scheduleType,
        scheduledAt: scheduleType === 'scheduled' && scheduledAt ? new Date(scheduledAt).toISOString() : null,
        deliveryStrategy: scheduleType === 'immediate' ? 'global' : deliveryStrategy,
        targetLocal: scheduleType === 'immediate' || deliveryStrategy === 'global' ? null : targetLocal,
        defaultTimezone: scheduleType === 'immediate' || deliveryStrategy === 'global' ? null : (defaultTimezone || null),
        excludeSentSendIds,
      };
      const { id } = await adapter.createSend(config);
      setSelectedSendId(id);
      if (scheduleType === 'immediate') {
        const { url } = getSupabaseConfig();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Authentication required');
        const res = await fetch(`${url}/functions/v1/${adapter.sendEndpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ send_id: id }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          await supabase.from(adapter.sendsTable).update({ status: 'failed' }).eq('id', id);
          throw new Error(err.error || `Send failed (${res.status})`);
        }
      }
      if (scheduleType === 'scheduled') toast.success('Send scheduled');
      setExcludeSentSendIds([]);
      await loadSends();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create send');
    } finally {
      setSending(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!adapter.emailDetails.save) return;
    setSavingDetails(true);
    try {
      await adapter.emailDetails.save(details);
      toast.success('Email details saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save details');
    } finally {
      setSavingDetails(false);
    }
  };

  const handleTestSend = async () => {
    if (!adapter.sendTest || !testEmail) return;
    setSendingTest(true);
    try {
      await adapter.sendTest(testEmail);
      toast.success(`Test sent to ${testEmail}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send test');
    } finally {
      setSendingTest(false);
    }
  };

  const handleCancel = async (send: SendRecord) => {
    const isActive = send.status === 'sending' || send.status === 'paused';
    const ok = window.confirm(isActive
      ? 'Stop this send now? Recipients already processed will still receive it; the rest will be skipped.'
      : 'Cancel this scheduled send? It will not go out.');
    if (!ok) return;
    const { error } = await supabase.from(adapter.sendsTable)
      .update({ status: isActive ? 'cancelling' : 'cancelled', updated_at: new Date().toISOString() }).eq('id', send.id);
    if (error) { toast.error(error.message || 'Failed to cancel'); return; }
    toast.success(isActive ? 'Stopping send…' : 'Scheduled send cancelled');
    await loadSends();
  };

  const handlePause = async (send: SendRecord) => {
    const { error } = await supabase.from(adapter.sendsTable).update({ status: 'paused', updated_at: new Date().toISOString() }).eq('id', send.id);
    if (error) { toast.error(error.message || 'Failed to pause'); return; }
    toast.success('Send paused'); await loadSends();
  };
  const handleResume = async (send: SendRecord) => {
    const { error } = await supabase.from(adapter.sendsTable).update({ status: 'sending', updated_at: new Date().toISOString() }).eq('id', send.id);
    if (error) { toast.error(error.message || 'Failed to resume'); return; }
    toast.success('Send resumed'); await loadSends();
  };
  const handleApplyLatestContent = async (send: SendRecord) => {
    if (!adapter.rerenderContent) return;
    if (!window.confirm('Update this send to the latest content? Only recipients not yet sent will get the new version.')) return;
    try {
      await adapter.rerenderContent(send.id);
      toast.success('Content updated for remaining recipients');
      await loadSends();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update content');
    }
  };

  const latestSend = sends[0];
  const isActive = latestSend?.status === 'sending' || latestSend?.status === 'scheduled' || latestSend?.status === 'cancelling';
  const sendSpinning = sending || latestSend?.status === 'sending' || latestSend?.status === 'cancelling';

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent-9)]" /></div>;
  }

  const selectedSend = sends.find((s) => s.id === selectedSendId);
  const ed = adapter.emailDetails;
  const rc = adapter.recipients;
  const priorSent = sends.filter((s) => (s.sent_count || 0) > 0);

  return (
    <div className="flex gap-6">
      {/* Left column — controls & history */}
      <div className="w-[400px] flex-shrink-0 space-y-4">
        {/* Email details — editable for broadcast/event */}
        {ed.editable && (
          <Card variant="surface" className="p-5">
            <h2 className="text-sm font-semibold text-[var(--gray-12)] mb-4">Email details</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--gray-9)] mb-0.5">Subject</label>
                <input className={INPUT_CLS} value={details.subject} onChange={(e: ChangeEvent<HTMLInputElement>) => setDetails({ ...details, subject: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--gray-9)] mb-0.5">Preheader</label>
                <input className={INPUT_CLS} value={details.preheader} onChange={(e: ChangeEvent<HTMLInputElement>) => setDetails({ ...details, preheader: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-[var(--gray-9)] mb-0.5">From address</label>
                  <input className={INPUT_CLS} value={details.fromAddress} onChange={(e: ChangeEvent<HTMLInputElement>) => setDetails({ ...details, fromAddress: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--gray-9)] mb-0.5">From name</label>
                  <input className={INPUT_CLS} value={details.fromName} onChange={(e: ChangeEvent<HTMLInputElement>) => setDetails({ ...details, fromName: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--gray-9)] mb-0.5">Reply-to</label>
                <input className={INPUT_CLS} value={details.replyTo} onChange={(e: ChangeEvent<HTMLInputElement>) => setDetails({ ...details, replyTo: e.target.value })} />
              </div>
              <div className="flex justify-end">
                <Button variant="soft" size="2" onClick={handleSaveDetails} disabled={savingDetails}>
                  {savingDetails ? 'Saving…' : 'Save details'}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Send composer */}
        <Card variant="surface" className="p-5">
          <h2 className="text-sm font-semibold text-[var(--gray-12)] mb-4 flex items-center gap-2">
            <PaperAirplaneIcon className="w-4 h-4" />
            {adapter.title}
          </h2>
          <div className="space-y-4">
            {/* From + Recipients summary (with edit affordance) */}
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-[var(--gray-9)] mb-0.5">From</label>
                  {!ed.editable && ed.editHref && (
                    <a href={ed.editHref} className="text-xs text-[var(--accent-11)] inline-flex items-center gap-0.5 hover:underline">
                      <PencilSquareIcon className="w-3 h-3" />{ed.editLabel || 'Edit'}
                    </a>
                  )}
                </div>
                <p className="text-sm text-[var(--gray-12)]">
                  {ed.values.fromName || 'Not configured'} {ed.values.fromAddress ? `<${ed.values.fromAddress}>` : ''}
                </p>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-[var(--gray-9)] mb-0.5">Recipients</label>
                  {rc.editable && rc.editHref && (
                    <a href={rc.editHref} className="text-xs text-[var(--accent-11)] inline-flex items-center gap-0.5 hover:underline">
                      <PencilSquareIcon className="w-3 h-3" />{rc.editLabel || 'Edit'}
                    </a>
                  )}
                </div>
                <p className="text-sm text-[var(--gray-12)]">{rc.display}</p>
                {rc.editNode}
              </div>
            </div>

            {/* Schedule */}
            <div>
              <label className="block text-xs font-medium text-[var(--gray-9)] mb-2">Schedule</label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={scheduleType === 'immediate'} onChange={() => setScheduleType('immediate')} /> Immediately
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={scheduleType === 'scheduled'} onChange={() => setScheduleType('scheduled')} /> Later
                </label>
              </div>
              {scheduleType === 'scheduled' && (
                <>
                  <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={`mt-2 ${INPUT_CLS}`} />
                  {Number.isFinite(formTargetMs) && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-[var(--gray-11)]">
                      <ClockIcon className="w-3.5 h-3.5 text-[var(--accent-9)]" />
                      <span>Sends <span className="font-semibold text-[var(--gray-12)]">{formatCountdown(formTargetMs, now)}</span></span>
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Delivery timing (scheduled only) */}
            {adapter.features.deliveryStrategy && scheduleType === 'scheduled' && (
              <div>
                <label className="block text-xs font-medium text-[var(--gray-9)] mb-2">Delivery timing</label>
                <select value={deliveryStrategy} onChange={(e) => setDeliveryStrategy(e.target.value as DeliveryStrategy)} className={INPUT_CLS}>
                  <option value="global">Everyone at once</option>
                  <option value="tz_local">Recipient local time</option>
                  <option value="personalised">Personalised send-time</option>
                </select>
                {deliveryStrategy !== 'global' && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs text-[var(--gray-9)]">Local time
                      <input type="time" value={targetLocal} onChange={(e) => setTargetLocal(e.target.value)} className={`mt-1 ${INPUT_CLS}`} />
                    </label>
                    <label className="text-xs text-[var(--gray-9)]">Default timezone
                      <select value={defaultTimezone} onChange={(e) => setDefaultTimezone(e.target.value)} className={`mt-1 ${INPUT_CLS}`}>
                        {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                      </select>
                    </label>
                  </div>
                )}
                {deliveryStrategy === 'personalised' && (
                  <p className="mt-1 text-xs text-[var(--gray-8)]">Uses each recipient&apos;s modelled open time where known, otherwise their local time.</p>
                )}
              </div>
            )}

            {/* Exclude already-sent */}
            {adapter.features.excludeSent && priorSent.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-[var(--gray-9)] mb-1">Exclude already-sent recipients</label>
                <p className="text-xs text-[var(--gray-8)] mb-2">Skip anyone successfully sent in a previous send — re-send corrected content to the rest without double-sending.</p>
                <div className="space-y-1.5">
                  {priorSent.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={excludeSentSendIds.includes(s.id)}
                        onChange={(e) => setExcludeSentSendIds((prev) => e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id))} />
                      <span className="text-[var(--gray-11)]">{s.sent_count} sent · {formatTime(s.created_at)}{s.status !== 'sent' ? ` · ${s.status}` : ''}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {!canSend && hasParent && canSendReason && (
              <div className="rounded-md border border-[var(--amber-a6)] bg-[var(--amber-a2)] px-3 py-2 text-xs text-[var(--amber-11)]">{canSendReason}</div>
            )}

            {recipientEstimate != null && (
              <p className="text-xs text-[var(--gray-11)] flex items-center gap-1">
                <EnvelopeIcon className="w-3.5 h-3.5 text-[var(--gray-9)]" />
                {countingRecipients ? (
                  <span className="text-[var(--gray-9)]">Calculating recipients…</span>
                ) : (
                  <span>Will send to <span className="font-semibold text-[var(--gray-12)]">{recipientEstimate.toLocaleString()}</span> recipient{recipientEstimate === 1 ? '' : 's'}{excludeSentSendIds.length > 0 ? ' (after exclusions)' : ''}</span>
                )}
              </p>
            )}

            <Button variant="solid" onClick={handleSend} disabled={sending || !hasParent || isActive || !canSend}>
              {sendSpinning ? (
                <svg className="w-4 h-4 mr-1 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : <PaperAirplaneIcon className="w-4 h-4 mr-1" />}
              {sending ? 'Sending...' : isActive ? 'Send in progress...' : !canSend ? (canSendReason || 'Cannot send') : scheduleType === 'scheduled' ? 'Schedule Send' : 'Send Now'}
            </Button>

          </div>
          {/* Test send — outside the composer's space-y so the divider gets
              clear breathing room under the Send button. */}
          {adapter.sendTest && (
            <div className="mt-5 pt-4 border-t border-[var(--gray-a4)]">
              <label className="block text-xs font-medium text-[var(--gray-9)] mb-1 flex items-center gap-1"><BeakerIcon className="w-3.5 h-3.5" />Send a test</label>
              <div className="flex gap-2">
                <input type="email" placeholder="you@example.com" value={testEmail} onChange={(e: ChangeEvent<HTMLInputElement>) => setTestEmail(e.target.value)} className={INPUT_CLS} />
                <Button variant="soft" size="2" onClick={handleTestSend} disabled={sendingTest || !testEmail}>{sendingTest ? '…' : 'Test'}</Button>
              </div>
            </div>
          )}
        </Card>

        {/* Send history */}
        {sends.length > 0 && (
          <Card variant="surface" className="p-5">
            <h2 className="text-sm font-semibold text-[var(--gray-12)] mb-2">Send History</h2>
            <div className="space-y-1">
              {sends.map((send) => {
                const statusCfg = send.status === 'sent' ? { color: 'green', icon: CheckCircleIcon }
                  : send.status === 'failed' ? { color: 'red', icon: XCircleIcon }
                  : send.status === 'cancelled' || send.status === 'cancelling' ? { color: 'gray', icon: XCircleIcon }
                  : send.status === 'paused' ? { color: 'amber', icon: PauseIcon }
                  : send.status === 'sending' ? { color: 'blue', icon: ClockIcon }
                  : { color: 'gray', icon: ClockIcon };
                const Icon = statusCfg.icon;
                const isSelected = send.id === selectedSendId;
                const strategy = send.delivery_strategy || 'global';
                const isStaggered = strategy !== 'global';
                const isSendingRow = send.status === 'sending' || send.status === 'cancelling' || send.status === 'paused';
                const canUpdateContent = !!adapter.rerenderContent && (send.status === 'scheduled' || (isStaggered && (send.status === 'sending' || send.status === 'paused' || send.status === 'cancelling')));
                const pct = (send.total_recipients || 0) > 0 ? Math.round(((send.sent_count || 0) / (send.total_recipients || 1)) * 100) : 0;
                return (
                  <div key={send.id} role="button" tabIndex={0}
                    onClick={() => setSelectedSendId(send.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedSendId(send.id); } }}
                    className={`w-full text-left px-3 py-2.5 rounded-md transition-colors cursor-pointer ${isSelected ? 'bg-[var(--accent-a3)] border border-[var(--accent-a6)]' : 'hover:bg-[var(--gray-a3)] border border-transparent'}`}>
                    <div className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 flex-shrink-0 ${send.status === 'sent' ? 'text-green-600' : send.status === 'failed' ? 'text-red-600' : send.status === 'sending' ? 'text-[var(--accent-9)] animate-pulse' : 'text-[var(--gray-9)]'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <Badge variant="soft" color={statusCfg.color as never} size="1">{send.status === 'cancelling' ? 'stopping' : send.status}</Badge>
                          <span className="text-xs text-[var(--gray-9)]">{formatTime(send.created_at)}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--gray-11)]">
                          <span>{send.sent_count || 0} sent</span>
                          {(send.failed_count || 0) > 0 && <span className="text-red-600">{send.failed_count} failed</span>}
                          <span>{send.total_recipients || 0} recipients</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {canUpdateContent && <Button variant="soft" color="gray" size="1" title="Update to latest content" onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); handleApplyLatestContent(send); }}><ArrowPathIcon className="w-4 h-4" /></Button>}
                        {isStaggered && send.status === 'sending' && <Button variant="soft" color="gray" size="1" title="Pause" onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); handlePause(send); }}><PauseIcon className="w-4 h-4" /></Button>}
                        {send.status === 'paused' && <Button variant="soft" color="green" size="1" onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); handleResume(send); }}><PlayIcon className="w-4 h-4 mr-1" />Resume</Button>}
                        {send.status === 'scheduled' && <Button variant="soft" color="red" size="1" onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); handleCancel(send); }}><XCircleIcon className="w-4 h-4 mr-1" />Cancel</Button>}
                        {(send.status === 'sending' || send.status === 'paused') && <Button variant="soft" color="red" size="1" onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); handleCancel(send); }}><XCircleIcon className="w-4 h-4 mr-1" />Stop</Button>}
                      </div>
                    </div>
                    {send.status === 'scheduled' && send.scheduled_at && (
                      <p className="mt-2 ml-7 text-xs text-[var(--gray-11)]">Sends <span className="font-semibold text-[var(--gray-12)]">{formatCountdown(new Date(send.scheduled_at).getTime(), now)}</span><span className="text-[var(--gray-9)]"> · {formatTime(send.scheduled_at)}</span></p>
                    )}
                    {isSendingRow && (send.total_recipients || 0) > 0 && (
                      <div className="mt-2 ml-7">
                        <div className="flex justify-between text-xs text-[var(--gray-11)] mb-1">
                          <span>{send.status === 'cancelling' ? 'Stopping…' : send.status === 'paused' ? 'Paused' : 'Progress'}</span>
                          <span>{send.sent_count || 0} / {send.total_recipients} · {pct}%</span>
                        </div>
                        <div className="w-full bg-[var(--gray-a4)] rounded-full h-1.5"><div className="bg-[var(--accent-9)] h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} /></div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {/* Right column — delivery log */}
      <div className="flex-1 min-w-0">
        {selectedSendId && (tzBreakdown[selectedSendId]?.length ?? 0) > 0 && (
          <Card variant="surface" className="p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--gray-12)] flex items-center gap-2"><ClockIcon className="w-4 h-4" />Delivery by timezone</h2>
              <span className="text-xs text-[var(--gray-9)]">{tzBreakdown[selectedSendId].length} zones</span>
            </div>
            <div className="border border-[var(--gray-a4)] rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-[var(--gray-a2)] border-b border-[var(--gray-a4)]">
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--gray-9)]">Timezone</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--gray-9)]">Recipients</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--gray-9)]">Local time</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--gray-9)]">Status</th>
                </tr></thead>
                <tbody>
                  {tzBreakdown[selectedSendId].map((r) => {
                    const st = tzRowStatus(r, now);
                    let localTime = '—';
                    try { localTime = new Date(now).toLocaleTimeString('en-GB', { timeZone: r.timezone, hour: '2-digit', minute: '2-digit' }); } catch { /* invalid zone */ }
                    return (
                      <tr key={r.timezone} className="border-b border-[var(--gray-a3)] last:border-0">
                        <td className="px-3 py-2 text-[var(--gray-12)]">{r.timezone}</td>
                        <td className="px-3 py-2 text-[var(--gray-11)] tabular-nums">{r.recipients}</td>
                        <td className="px-3 py-2 text-[var(--gray-11)] tabular-nums">{localTime}</td>
                        <td className="px-3 py-2"><Badge variant="soft" color={st.color as never} size="1">{st.label}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card variant="surface" className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[var(--gray-12)] flex items-center gap-2">
              <EnvelopeIcon className="w-4 h-4" />Delivery Log
              {selectedSend && <Badge variant="soft" color={(selectedSend.status === 'sent' ? 'green' : selectedSend.status === 'failed' ? 'red' : selectedSend.status === 'sending' ? 'blue' : 'gray') as never} size="1">{selectedSend.status}</Badge>}
            </h2>
            {selectedSend && <span className="text-xs text-[var(--gray-9)]">{formatTime(selectedSend.created_at)}</span>}
          </div>
          {selectedSend && (
            <div className="flex gap-3 mb-4">
              <StatCard label="Recipients" value={selectedSend.total_recipients || 0} />
              <StatCard label="Sent" value={selectedSend.sent_count || 0} color="blue" />
              <StatCard label="Failed" value={selectedSend.failed_count || 0} color={(selectedSend.failed_count || 0) > 0 ? 'red' : undefined} />
              <StatCard label="Opened" value={openedCount} color="green" />
            </div>
          )}
          {sendLogTotal > 0 ? (
            <>
              <div className="border border-[var(--gray-a4)] rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-[var(--gray-a2)] border-b border-[var(--gray-a4)]">
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--gray-9)]">Recipient</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--gray-9)]">Status</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--gray-9)]">Sent</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--gray-9)]">Delivered</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--gray-9)]">Opened</th>
                  </tr></thead>
                  <tbody>
                    {sendLog.map((entry) => {
                      const cfg = STATUS_CONFIG[entry.status] || { color: 'gray', label: entry.status };
                      return (
                        <tr key={entry.id} className="border-b border-[var(--gray-a3)] last:border-0 hover:bg-[var(--gray-a2)]">
                          <td className="px-3 py-2 text-[var(--gray-12)] truncate max-w-[200px]">{entry.recipient_email}</td>
                          <td className="px-3 py-2">
                            <Badge variant="soft" color={cfg.color as never} size="1">{cfg.label}</Badge>
                            {entry.failure_error && <span className="block text-xs text-red-600 mt-0.5 truncate max-w-[150px]" title={entry.failure_error}>{entry.failure_error}</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-[var(--gray-11)]">{formatTime(entry.sent_at)}</td>
                          <td className="px-3 py-2 text-xs text-[var(--gray-11)]">{entry.delivered_at ? formatTime(entry.delivered_at) : '—'}</td>
                          <td className="px-3 py-2 text-xs text-[var(--gray-11)]">{entry.first_opened_at ? formatTime(entry.first_opened_at) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {sendLogTotal > SEND_LOG_PAGE_SIZE && (
                <div className="flex items-center justify-between mt-3 text-xs text-[var(--gray-10)]">
                  <span>{sendLogPage * SEND_LOG_PAGE_SIZE + 1}–{Math.min((sendLogPage + 1) * SEND_LOG_PAGE_SIZE, sendLogTotal)} of {sendLogTotal.toLocaleString()}</span>
                  <div className="flex gap-2">
                    <Button variant="outlined" size="1" disabled={sendLogPage === 0} onClick={() => setSendLogPage((p) => Math.max(0, p - 1))}>Previous</Button>
                    <Button variant="outlined" size="1" disabled={(sendLogPage + 1) * SEND_LOG_PAGE_SIZE >= sendLogTotal} onClick={() => setSendLogPage((p) => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </>
          ) : selectedSendId ? (
            <div className="text-center py-12 text-[var(--gray-9)]"><EnvelopeIcon className="w-8 h-8 mx-auto mb-2 opacity-40" /><p className="text-sm">No delivery records yet</p>{isActive && <p className="text-xs mt-1">Records will appear as emails are sent</p>}</div>
          ) : (
            <div className="text-center py-12 text-[var(--gray-9)]"><EnvelopeIcon className="w-8 h-8 mx-auto mb-2 opacity-40" /><p className="text-sm">Select a send to view delivery details</p></div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex-1 text-center p-2.5 bg-[var(--gray-a2)] rounded-lg">
      <p className={`text-xl font-bold ${color === 'red' ? 'text-red-600' : color === 'green' ? 'text-green-600' : color === 'blue' ? 'text-blue-600' : 'text-[var(--gray-12)]'}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-[var(--gray-9)] mt-0.5">{label}</p>
    </div>
  );
}
