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
import { SendScheduleMap } from './SendScheduleMap';
import { supabase } from '@/lib/supabase';
import type {
  SendingAdapter, SendRecord, EmailDetails, ScheduleType, DeliveryStrategy, SendComposerConfig,
  ScheduleBreakdownRow,
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

// The schedule <input type="datetime-local"> value is a naive 'YYYY-MM-DDTHH:MM'
// wall-clock string. We interpret it as UTC (not the browser's local zone) so
// the scheduled time the admin types is unambiguous — see the "(UTC)" label.
function scheduleInputToIso(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)).toISOString();
}

function fmtUtc(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }) + ' UTC';
}

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

  // Mandatory unsubscribe list (broadcasts), selected here. Feeds the recipient
  // count (segment ∩ list subscribers) and gates Send.
  const [unsubListId, setUnsubListId] = useState<string | null>(adapter.unsubscribeList?.value ?? null);
  useEffect(() => { setUnsubListId(adapter.unsubscribeList?.value ?? null); }, [adapter.unsubscribeList?.value]);
  const listRequired = !!adapter.unsubscribeList?.required && !unsubListId;
  const canSendNow = canSend && !listRequired;
  const blockReason = listRequired ? `Choose ${adapter.unsubscribeList?.label || 'an unsubscribe list'} before sending` : canSendReason;

  useEffect(() => {
    let cancelled = false;
    if (!adapter.countRecipients) { setRecipientEstimate(adapter.recipientCount ?? null); return; }
    setCountingRecipients(true);
    const t = setTimeout(async () => {
      try {
        const n = await adapter.countRecipients!(excludeSentSendIds, unsubListId);
        if (!cancelled) setRecipientEstimate(n);
      } catch {
        if (!cancelled) setRecipientEstimate(adapter.recipientCount ?? null);
      } finally {
        if (!cancelled) setCountingRecipients(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [excludeSentSendIds, adapter, unsubListId]);

  const formTargetIso = scheduleType === 'scheduled' && scheduledAt ? scheduleInputToIso(scheduledAt) : null;
  const formTargetMs = formTargetIso ? new Date(formTargetIso).getTime() : NaN;

  // Pre-send confirmation: holds the pending config + the per-timezone delivery
  // preview so the admin can see who receives when (and catch an all-at-once
  // blast) before committing.
  const [confirmState, setConfirmState] = useState<
    { config: SendComposerConfig; rows: ScheduleBreakdownRow[]; loading: boolean } | null
  >(null);
  const [confirmView, setConfirmView] = useState<'list' | 'map'>('list');
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
  // Reload the sends list too (not just the log): the left-side progress/counts
  // come from newsletter_sends, whose realtime updates can lag/drop, whereas the
  // email_send_log tick fires reliably during a send — so piggy-back on it to
  // keep the Send History counts + status in sync with the delivery log.
  refreshRef.current = () => { loadSends(); loadSendLog(); loadOpenedCount(); if (selectedSendId) loadBreakdown(selectedSendId); };
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

  // Build the send config from the composer state. 'Send Now' is modelled as
  // 'scheduled for now' so it rides the EXACT same Tier 2 worker path as 'Send
  // Later' (the immediate Edge path timed out mid-fanout on real lists). The
  // typed schedule time is interpreted as UTC (see scheduleInputToIso).
  const buildConfig = (): SendComposerConfig => {
    const isImmediate = scheduleType === 'immediate';
    return {
      scheduleType: 'scheduled',
      scheduledAt: isImmediate ? new Date().toISOString() : scheduleInputToIso(scheduledAt),
      deliveryStrategy: isImmediate ? 'global' : deliveryStrategy,
      targetLocal: isImmediate || deliveryStrategy === 'global' ? null : targetLocal,
      defaultTimezone: isImmediate || deliveryStrategy === 'global' ? null : (defaultTimezone || null),
      excludeSentSendIds,
    };
  };

  const doCreate = async (config: SendComposerConfig) => {
    setSending(true);
    try {
      const { id } = await adapter.createSend(config);
      setSelectedSendId(id);
      toast.success(scheduleType === 'immediate'
        ? 'Send queued — dispatch begins within 60s'
        : 'Send scheduled');
      setExcludeSentSendIds([]);
      setConfirmState(null);
      await loadSends();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create send');
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (!hasParent) { toast.error(canSendReason || 'Save first'); return; }
    if (!canSendNow) { toast.error(blockReason || 'Cannot send yet'); return; }
    const config = buildConfig();
    // Staggered (recipient-local / personalised) scheduled sends get a
    // per-timezone confirmation so an accidental all-at-once blast is visible
    // before committing. Immediate / everyone-at-once sends proceed directly.
    const staggered = config.scheduleType === 'scheduled'
      && config.deliveryStrategy !== 'global'
      && scheduleType === 'scheduled';
    if (staggered && adapter.previewSchedule && config.scheduledAt) {
      setConfirmState({ config, rows: [], loading: true });
      try {
        const rows = await adapter.previewSchedule(config);
        setConfirmState({ config, rows, loading: false });
      } catch {
        toast.error('Could not load the delivery preview');
        setConfirmState(null);
      }
      return;
    }
    await doCreate(config);
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
              {details.forwardRepliesTo !== undefined && (
                <div>
                  <label className="block text-xs font-medium text-[var(--gray-9)] mb-0.5">Forward replies to</label>
                  <input className={INPUT_CLS} type="email" placeholder="team@example.com" value={details.forwardRepliesTo}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setDetails({ ...details, forwardRepliesTo: e.target.value })} />
                  <p className="text-xs text-[var(--gray-8)] mt-0.5">Human replies are also emailed here (auto-replies and bounces are not). Leave blank to only collect them in the Replies tab.</p>
                </div>
              )}
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

              {/* Unsubscribe list (broadcasts) — recipients are cross-referenced
                  against this list's subscribers, so it drives the count. */}
              {adapter.unsubscribeList && (
                <div>
                  <label className="block text-xs font-medium text-[var(--gray-9)] mb-0.5">
                    {adapter.unsubscribeList.label || 'Unsubscribe list'}
                    {adapter.unsubscribeList.required && <span className="text-[var(--red-11)]"> *</span>}
                  </label>
                  <select
                    className={INPUT_CLS}
                    value={unsubListId ?? ''}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      setUnsubListId(v);
                      adapter.unsubscribeList!.save(v).catch(() => { /* toast handled by adapter */ });
                    }}
                  >
                    <option value="">Select a list…</option>
                    {adapter.unsubscribeList.options.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-[var(--gray-8)] mt-0.5">
                    {adapter.unsubscribeList.helpText || 'Recipients unsubscribe from this list; only its subscribers within the audience are emailed.'}
                  </p>
                </div>
              )}
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
                  <div className="mt-2 flex items-center gap-2">
                    <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={INPUT_CLS} />
                    <span className="text-xs font-medium text-[var(--gray-9)] whitespace-nowrap">UTC</span>
                  </div>
                  {formTargetIso && Number.isFinite(formTargetMs) && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-[var(--gray-11)]">
                      <ClockIcon className="w-3.5 h-3.5 text-[var(--accent-9)]" />
                      <span>Starts <span className="font-semibold text-[var(--gray-12)]">{formatCountdown(formTargetMs, now)}</span> · {fmtUtc(formTargetIso)}</span>
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

            {!canSendNow && hasParent && blockReason && (
              <div className="rounded-md border border-[var(--amber-a6)] bg-[var(--amber-a2)] px-3 py-2 text-xs text-[var(--amber-11)]">{blockReason}</div>
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

            <Button variant="solid" onClick={handleSend} disabled={sending || !hasParent || isActive || !canSendNow}>
              {sendSpinning ? (
                <svg className="w-4 h-4 mr-1 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : <PaperAirplaneIcon className="w-4 h-4 mr-1" />}
              {sending ? 'Sending...' : isActive ? 'Send in progress...' : !canSendNow ? (blockReason || 'Cannot send') : scheduleType === 'scheduled' ? 'Schedule Send' : 'Send Now'}
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

      {confirmState && (() => {
        const rows = confirmState.rows;
        const total = rows.reduce((n, r) => n + r.recipients, 0);
        const first = rows[0]?.send_at;
        const last = rows[rows.length - 1]?.send_at;
        const schedIso = confirmState.config.scheduledAt;
        const atSchedule = schedIso ? rows.filter((r) => r.send_at === schedIso).reduce((n, r) => n + r.recipients, 0) : 0;
        const distinctTimes = new Set(rows.map((r) => r.send_at)).size;
        const blast = !confirmState.loading && total > 0 && (distinctTimes === 1 || (schedIso ? atSchedule / total >= 0.9 : false));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/40" onClick={() => !sending && setConfirmState(null)} />
            <div className="relative z-10 w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl bg-[var(--color-surface)] border border-[var(--gray-a5)] shadow-xl">
              <div className="px-5 py-4 border-b border-[var(--gray-a4)]">
                <h2 className="text-base font-semibold text-[var(--gray-12)]">Confirm scheduled send</h2>
                <p className="text-xs text-[var(--gray-9)] mt-0.5">Recipients receive at their local {confirmState.config.targetLocal} — here&apos;s exactly when each timezone goes out.</p>
              </div>

              <div className="px-5 py-4 overflow-y-auto">
                {confirmState.loading ? (
                  <div className="flex items-center gap-2 text-sm text-[var(--gray-9)] py-8 justify-center">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Calculating delivery times…
                  </div>
                ) : (
                  <>
                    {blast && (
                      <div className="mb-3 rounded-md border border-[var(--red-a6)] bg-[var(--red-a2)] px-3 py-2 text-xs text-[var(--red-11)]">
                        <strong>All {total.toLocaleString()} recipients will be sent at once</strong> at {schedIso ? fmtUtc(schedIso) : '—'} — no timezone staggering. This usually means {confirmState.config.targetLocal} has already passed for everyone on the schedule date. Move the scheduled time earlier (before {confirmState.config.targetLocal} UTC) if you want it staggered.
                      </div>
                    )}
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--gray-11)] mb-3">
                      <span>Recipients: <span className="font-semibold text-[var(--gray-12)]">{total.toLocaleString()}</span></span>
                      <span>Timezones: <span className="font-semibold text-[var(--gray-12)]">{rows.length}</span></span>
                      <span>First delivery: <span className="font-semibold text-[var(--gray-12)]">{first ? fmtUtc(first) : '—'}</span></span>
                      <span>Last delivery: <span className="font-semibold text-[var(--gray-12)]">{last ? fmtUtc(last) : '—'}</span></span>
                    </div>

                    {/* List / Map tabs */}
                    <div className="flex gap-4 border-b border-[var(--gray-a4)] mb-3">
                      {(['list', 'map'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setConfirmView(v)}
                          className={`-mb-px border-b-2 px-1 py-1.5 text-sm capitalize transition-colors ${
                            confirmView === v
                              ? 'border-[var(--accent-9)] text-[var(--gray-12)] font-medium'
                              : 'border-transparent text-[var(--gray-10)] hover:text-[var(--gray-12)]'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>

                    {confirmView === 'list' ? (
                      <div className="border border-[var(--gray-a4)] rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead><tr className="bg-[var(--gray-a2)] border-b border-[var(--gray-a4)]">
                            <th className="text-left px-3 py-2 text-xs font-medium text-[var(--gray-9)]">Timezone</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-[var(--gray-9)]">Recipients</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-[var(--gray-9)]">Delivered (UTC)</th>
                          </tr></thead>
                          <tbody>
                            {rows.map((r) => (
                              <tr key={r.timezone} className="border-b border-[var(--gray-a3)] last:border-0">
                                <td className="px-3 py-1.5 text-[var(--gray-12)]">{r.timezone}</td>
                                <td className="px-3 py-1.5 text-right text-[var(--gray-11)] tabular-nums">{r.recipients.toLocaleString()}</td>
                                <td className="px-3 py-1.5 text-[var(--gray-11)] tabular-nums">{fmtUtc(r.send_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <SendScheduleMap rows={rows} />
                    )}
                  </>
                )}
              </div>

              <div className="px-5 py-3 border-t border-[var(--gray-a4)] flex items-center justify-end gap-2">
                <Button variant="outlined" onClick={() => setConfirmState(null)} disabled={sending}>Cancel</Button>
                <Button variant="solid" onClick={() => doCreate(confirmState.config)} disabled={sending || confirmState.loading}>
                  {sending ? 'Scheduling…' : 'Confirm &amp; schedule'}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}
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
