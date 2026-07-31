import { useState, useEffect, useCallback } from 'react';
import {
  EnvelopeIcon,
  EnvelopeOpenIcon,
  CursorArrowRippleIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  PaperAirplaneIcon,
  TicketIcon,
  PlayCircleIcon,
  GlobeAltIcon,
  CalendarDaysIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '@/lib/supabase';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

/**
 * A unified, chronological feed of everything a person has done: emails
 * (sent / delivered / opened / clicked / bounced), event registrations and
 * attendance, and first-party web activity (page views, video plays, link
 * clicks) as it is recorded into people_events.
 *
 * Sources and their person link key:
 *   - email_send_log       -> recipient_email  (email lifecycle timestamps)
 *   - events_registrations -> person_id        (registered)
 *   - events_attendance    -> person_id        (attended / checked in)
 *   - people_events        -> person_id        (web activity + generic events)
 *
 * Page views / video plays reach people_events via the portal tracking relay,
 * so they accrue going forward for identified (signed-in) visitors.
 */

type ActivityKind =
  | 'email_sent' | 'email_delivered' | 'email_opened' | 'email_clicked' | 'email_bounced'
  | 'event_registered' | 'event_attended'
  | 'page_view' | 'video_play' | 'link_click' | 'generic';

interface ActivityItem {
  id: string;
  kind: ActivityKind;
  at: string;          // ISO timestamp
  title: string;
  detail?: string;
  url?: string;
}

interface PersonActivityTimelineProps {
  personId: string;
  email?: string;
}

const KIND_META: Record<ActivityKind, { label: string; icon: typeof EnvelopeIcon; color: string }> = {
  email_sent:       { label: 'Email sent',       icon: PaperAirplaneIcon,     color: 'text-gray-500 bg-gray-100 dark:bg-gray-800' },
  email_delivered:  { label: 'Email delivered',  icon: CheckCircleIcon,       color: 'text-green-600 bg-green-100 dark:bg-green-900/40' },
  email_opened:     { label: 'Email opened',     icon: EnvelopeOpenIcon,      color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/40' },
  email_clicked:    { label: 'Email link clicked', icon: CursorArrowRippleIcon, color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/40' },
  email_bounced:    { label: 'Email bounced',    icon: ExclamationCircleIcon, color: 'text-red-600 bg-red-100 dark:bg-red-900/40' },
  event_registered: { label: 'Registered for event', icon: TicketIcon,        color: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-900/40' },
  event_attended:   { label: 'Attended event',   icon: CalendarDaysIcon,      color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40' },
  page_view:        { label: 'Viewed page',      icon: GlobeAltIcon,          color: 'text-sky-600 bg-sky-100 dark:bg-sky-900/40' },
  video_play:       { label: 'Played video',     icon: PlayCircleIcon,        color: 'text-rose-600 bg-rose-100 dark:bg-rose-900/40' },
  link_click:       { label: 'Clicked link',     icon: CursorArrowRippleIcon, color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/40' },
  generic:          { label: 'Activity',         icon: SparklesIcon,          color: 'text-gray-500 bg-gray-100 dark:bg-gray-800' },
};

function fmt(ts: string): string {
  return new Date(ts).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// Map a people_events event_name onto a timeline kind.
function kindForEventName(name: string): ActivityKind {
  const n = (name || '').toLowerCase();
  if (n === 'video_play' || n === 'video_played' || n.includes('video')) return 'video_play';
  if (n === 'page_view' || n === 'pageview' || n === 'page') return 'page_view';
  if (n === 'link_click' || n === 'click' || n.includes('click')) return 'link_click';
  return 'generic';
}

export function PersonActivityTimeline({ personId, email }: PersonActivityTimelineProps) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const out: ActivityItem[] = [];
    try {
      const emailVariants = email
        ? Array.from(new Set([email, email.toLowerCase()]))
        : [];

      const [logRes, regRes, attRes, peRes] = await Promise.all([
        // Emails — one row per send, keyed by recipient_email (indexed).
        emailVariants.length
          ? supabase
              .from('email_send_log')
              .select('id, subject, sent_at, delivered_at, first_opened_at, first_clicked_at, bounced_at, bounce_reason')
              .in('recipient_email', emailVariants)
              .order('sent_at', { ascending: false, nullsFirst: false })
              .limit(100)
          : Promise.resolve({ data: [] as any[] }),
        // Event registrations / attendance — keyed by person_id.
        supabase
          .from('events_registrations')
          .select('id, event_id, status, registered_at')
          .eq('person_id', personId)
          .order('registered_at', { ascending: false })
          .limit(100),
        supabase
          .from('events_attendance')
          .select('id, event_id, checked_in_at')
          .eq('person_id', personId)
          .order('checked_in_at', { ascending: false })
          .limit(100),
        // First-party web activity + generic events — keyed by person_id.
        supabase
          .from('people_events')
          .select('id, event_name, event_data, occurred_at, source')
          .eq('person_id', personId)
          .order('occurred_at', { ascending: false })
          .limit(200),
      ]);

      // Emails -> one item per lifecycle stage that happened.
      for (const log of (logRes.data ?? []) as any[]) {
        const subj = log.subject || '(No subject)';
        if (log.sent_at) out.push({ id: `es-${log.id}`, kind: 'email_sent', at: log.sent_at, title: subj });
        if (log.delivered_at) out.push({ id: `ed-${log.id}`, kind: 'email_delivered', at: log.delivered_at, title: subj });
        if (log.first_opened_at) out.push({ id: `eo-${log.id}`, kind: 'email_opened', at: log.first_opened_at, title: subj });
        if (log.first_clicked_at) out.push({ id: `ec-${log.id}`, kind: 'email_clicked', at: log.first_clicked_at, title: subj });
        if (log.bounced_at) out.push({ id: `eb-${log.id}`, kind: 'email_bounced', at: log.bounced_at, title: subj, detail: log.bounce_reason || undefined });
      }

      // Resolve event titles for registrations + attendance in one query.
      const eventIds = Array.from(new Set([
        ...((regRes.data ?? []) as any[]).map((r) => r.event_id),
        ...((attRes.data ?? []) as any[]).map((a) => a.event_id),
      ].filter(Boolean)));
      const eventTitles = new Map<string, string>();
      if (eventIds.length) {
        const { data: evs } = await supabase.from('events').select('id, event_title').in('id', eventIds);
        for (const e of (evs ?? []) as any[]) eventTitles.set(e.id, e.event_title);
      }

      for (const r of (regRes.data ?? []) as any[]) {
        if (!r.registered_at) continue;
        out.push({ id: `rg-${r.id}`, kind: 'event_registered', at: r.registered_at,
          title: eventTitles.get(r.event_id) || 'Event', detail: r.status || undefined });
      }
      for (const a of (attRes.data ?? []) as any[]) {
        if (!a.checked_in_at) continue;
        out.push({ id: `at-${a.id}`, kind: 'event_attended', at: a.checked_in_at,
          title: eventTitles.get(a.event_id) || 'Event' });
      }

      // people_events -> web activity + generic.
      for (const pe of (peRes.data ?? []) as any[]) {
        if (!pe.occurred_at) continue;
        const kind = kindForEventName(pe.event_name);
        const data = (pe.event_data ?? {}) as Record<string, unknown>;
        const url = typeof data.url === 'string' ? data.url : typeof data.href === 'string' ? data.href : undefined;
        const title =
          (typeof data.title === 'string' && data.title) ||
          (typeof data.name === 'string' && data.name) ||
          url ||
          (kind === 'generic' ? pe.event_name : KIND_META[kind].label);
        out.push({ id: `pe-${pe.id}`, kind, at: pe.occurred_at, title: String(title), url });
      }

      out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      setItems(out);
    } catch (err) {
      console.error('Error loading activity timeline:', err);
    } finally {
      setLoading(false);
    }
  }, [personId, email]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="medium" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--gray-11)]">
        <SparklesIcon className="size-10 mx-auto mb-3 opacity-50" />
        <p>No recorded activity for this person yet.</p>
      </div>
    );
  }

  return (
    <div className="flow-root">
      <ul className="-mb-8">
        {items.map((item, idx) => {
          const meta = KIND_META[item.kind];
          const Icon = meta.icon;
          const isLast = idx === items.length - 1;
          return (
            <li key={item.id}>
              <div className="relative pb-8">
                {!isLast && (
                  <span className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-[var(--gray-a5)]" aria-hidden="true" />
                )}
                <div className="relative flex items-start gap-3">
                  <span className={`flex size-8 items-center justify-center rounded-full ring-4 ring-[var(--color-background)] ${meta.color}`}>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm text-[var(--gray-12)]">
                        <span className="font-medium">{meta.label}</span>
                        {item.title && <span className="text-[var(--gray-11)]"> · {item.title}</span>}
                      </p>
                      <span className="shrink-0 text-xs text-[var(--gray-a9)] whitespace-nowrap">{fmt(item.at)}</span>
                    </div>
                    {item.detail && <p className="mt-0.5 text-xs text-[var(--gray-11)]">{item.detail}</p>}
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noopener noreferrer"
                        className="mt-0.5 block truncate text-xs text-[var(--accent-11)] hover:underline" title={item.url}>
                        {item.url}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default PersonActivityTimeline;
