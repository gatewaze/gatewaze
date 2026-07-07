import { useMemo, useState, type ComponentType } from 'react';
import {
  InboxIcon, StarIcon, PaperAirplaneIcon, ArchiveBoxIcon, ClockIcon, BriefcaseIcon,
  ExclamationTriangleIcon, EnvelopeIcon, EnvelopeOpenIcon, ChevronDownIcon, ChevronUpIcon,
  ArrowUturnRightIcon, ArrowUturnLeftIcon, ArchiveBoxArrowDownIcon, ArchiveBoxXMarkIcon,
  PaperClipIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { Card, Badge } from '@/components/ui';
import { ReplyComposer, SentReplyList, type SentReplyMessage } from '@/components/emails/ReplyComposer';
import { PersonLink } from '@/components/people/PersonLink';
import { supabase } from '@/lib/supabase';

export interface WorkspaceReply {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  is_read: boolean;
  is_starred: boolean;
  is_archived: boolean;
  is_auto_reply: boolean;
  auto_reply_reason: string | null;
  forwarded_to: string | null;
  forwarded_at: string | null;
  created_at: string;
  /** Optional right-aligned tag (e.g. the newsletter edition). */
  badge?: string | null;
}

type SentMessage = SentReplyMessage & { reply_id: string };

interface RepliesWorkspaceProps {
  kind: 'broadcast' | 'newsletter';
  replies: WorkspaceReply[];
  sent: SentMessage[];
  personByEmail: Record<string, string>;
  /** Reload the parent's data (used after sending a reply). */
  onReload: () => void;
  emptyHint?: string;
}

type Category = 'reply' | 'ooo' | 'job_change' | 'bounce';
type FolderKey = 'inbox' | 'starred' | 'sent' | 'archived' | 'ooo' | 'job_change' | 'bounce';

function replyCategory(r: { is_auto_reply: boolean; auto_reply_reason: string | null }): Category {
  const reason = r.auto_reply_reason || '';
  if (reason.startsWith('departed')) return 'job_change';
  if (!r.is_auto_reply) return 'reply';
  if (reason === 'dsn' || reason === 'bounce-sender') return 'bounce';
  return 'ooo';
}

const CATEGORY_BADGE: Record<Exclude<Category, 'reply'>, { label: string; color: 'amber' | 'red' | 'gray' }> = {
  ooo: { label: 'Out of office', color: 'amber' },
  job_change: { label: 'Job change', color: 'red' },
  bounce: { label: 'Bounce', color: 'gray' },
};

type Icon = ComponentType<{ className?: string }>;
const FOLDERS: { key: FolderKey; label: string; icon: Icon; group: 'primary' | 'filter' }[] = [
  { key: 'inbox', label: 'Inbox', icon: InboxIcon, group: 'primary' },
  { key: 'starred', label: 'Starred', icon: StarIcon, group: 'primary' },
  { key: 'sent', label: 'Sent', icon: PaperAirplaneIcon, group: 'primary' },
  { key: 'archived', label: 'Archived', icon: ArchiveBoxIcon, group: 'primary' },
  { key: 'ooo', label: 'Out of office', icon: ClockIcon, group: 'filter' },
  { key: 'job_change', label: 'Job changes', icon: BriefcaseIcon, group: 'filter' },
  { key: 'bounce', label: 'Bounces', icon: ExclamationTriangleIcon, group: 'filter' },
];

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const diffDays = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function RepliesWorkspace({ kind, replies, sent, personByEmail, onReload, emptyHint }: RepliesWorkspaceProps) {
  const [folder, setFolder] = useState<FolderKey>('inbox');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Optimistic status overrides (star/archive/read) for instant feedback; the
  // DB write happens in parallel and the parent poll reconciles.
  const [overrides, setOverrides] = useState<Record<string, Partial<WorkspaceReply>>>({});

  const table = kind === 'broadcast' ? 'broadcast_replies' : 'newsletter_replies';

  const rows = useMemo(
    () => replies.map((r) => (overrides[r.id] ? { ...r, ...overrides[r.id] } : r)),
    [replies, overrides],
  );

  const sentByReply = useMemo(() => {
    const g: Record<string, SentMessage[]> = {};
    for (const m of sent) (g[m.reply_id] ||= []).push(m);
    return g;
  }, [sent]);

  const counts = useMemo(() => {
    const active = rows.filter((r) => !r.is_archived);
    const byCat = (c: Category) => active.filter((r) => replyCategory(r) === c).length;
    return {
      inbox: byCat('reply'),
      ooo: byCat('ooo'),
      job_change: byCat('job_change'),
      bounce: byCat('bounce'),
      starred: active.filter((r) => r.is_starred).length,
      archived: rows.filter((r) => r.is_archived).length,
      sent: sent.length,
    } as Record<FolderKey, number>;
  }, [rows, sent]);

  const inboxUnread = useMemo(
    () => rows.filter((r) => !r.is_archived && !r.is_read && replyCategory(r) === 'reply').length,
    [rows],
  );

  const visible = useMemo(() => {
    if (folder === 'archived') return rows.filter((r) => r.is_archived);
    const active = rows.filter((r) => !r.is_archived);
    if (folder === 'starred') return active.filter((r) => r.is_starred);
    if (folder === 'inbox') return active.filter((r) => replyCategory(r) === 'reply');
    return active.filter((r) => replyCategory(r) === folder);
  }, [rows, folder]);

  const applyStatus = (id: string, fields: Partial<WorkspaceReply>) => {
    setOverrides((o) => ({ ...o, [id]: { ...(o[id] || {}), ...fields } }));
    void supabase.from(table).update(fields).eq('id', id);
  };

  const toggleExpand = (reply: WorkspaceReply) => {
    const opening = expandedId !== reply.id;
    setExpandedId(opening ? reply.id : null);
    if (opening && !reply.is_read) applyStatus(reply.id, { is_read: true });
  };

  const visibleFolders = FOLDERS.filter((f) => {
    if (f.group === 'primary') return true;
    return counts[f.key] > 0; // classification folders only when non-empty
  });

  return (
    <div className="flex gap-6">
      {/* Folder rail */}
      <nav className="w-44 flex-shrink-0 space-y-0.5">
        {visibleFolders.map((f, i) => {
          const prev = visibleFolders[i - 1];
          const showDivider = prev && prev.group === 'primary' && f.group === 'filter';
          const active = folder === f.key;
          const FIcon = f.icon;
          const count = counts[f.key];
          return (
            <div key={f.key}>
              {showDivider && <div className="my-2 border-t border-[var(--gray-a4)]" />}
              <button
                type="button"
                onClick={() => { setFolder(f.key); setExpandedId(null); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-[var(--accent-a3)] text-[var(--accent-11)] font-medium'
                    : 'text-[var(--gray-11)] hover:bg-[var(--gray-a3)]'
                }`}
              >
                <FIcon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left truncate">{f.label}</span>
                {f.key === 'inbox' && inboxUnread > 0 ? (
                  <Badge variant="solid" color="blue" size="1">{inboxUnread}</Badge>
                ) : count > 0 ? (
                  <span className={`text-xs ${active ? 'opacity-80' : 'text-[var(--gray-9)]'}`}>{count}</span>
                ) : null}
              </button>
            </div>
          );
        })}
      </nav>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {folder === 'sent' ? (
          <SentFolder sent={sent} personByEmail={personByEmail} />
        ) : visible.length === 0 ? (
          <Card variant="surface" className="p-12 text-center">
            <EnvelopeIcon className="w-10 h-10 text-[var(--gray-8)] mx-auto mb-3" />
            <p className="text-[var(--gray-11)] mb-1">Nothing here</p>
            <p className="text-sm text-[var(--gray-9)]">{emptyHint || 'Replies will appear here'}</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {visible.map((reply) => {
              const isExpanded = expandedId === reply.id;
              const cat = replyCategory(reply);
              const catBadge = cat === 'reply' ? null : CATEGORY_BADGE[cat];
              const personId = personByEmail[reply.from_email?.toLowerCase()];
              const repliedCount = sentByReply[reply.id]?.length ?? 0;
              return (
                <Card
                  key={reply.id}
                  variant="surface"
                  className={`transition-colors ${!reply.is_read ? 'border-l-2 border-l-[var(--accent-9)]' : ''}`}
                >
                  <button onClick={() => toggleExpand(reply)} className="w-full text-left px-4 py-3 flex items-center gap-3">
                    {reply.is_read
                      ? <EnvelopeOpenIcon className="w-4 h-4 text-[var(--gray-9)] flex-shrink-0" />
                      : <EnvelopeIcon className="w-4 h-4 text-[var(--accent-9)] flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <PersonLink
                          personId={personId}
                          label={reply.from_name || reply.from_email}
                          className={`text-sm truncate ${!reply.is_read ? 'font-semibold' : ''}`}
                          title={personId ? 'View person profile' : undefined}
                        />
                        {reply.from_name && <span className="text-xs text-[var(--gray-9)] truncate hidden sm:inline">{reply.from_email}</span>}
                      </div>
                      <p className={`text-sm truncate ${!reply.is_read ? 'font-medium text-[var(--gray-11)]' : 'text-[var(--gray-9)]'}`}>
                        {reply.subject || '(no subject)'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {catBadge && (
                        <Badge variant="soft" color={catBadge.color} size="1" className="hidden md:inline-flex" title={reply.auto_reply_reason || undefined}>
                          {catBadge.label}
                        </Badge>
                      )}
                      {reply.badge && (
                        <Badge variant="soft" color="blue" size="1" className="hidden md:inline-flex">{reply.badge}</Badge>
                      )}
                      {reply.forwarded_at && (
                        <ArrowUturnRightIcon className="w-3.5 h-3.5 text-[var(--gray-9)]" title={`Forwarded to ${reply.forwarded_to}`} />
                      )}
                      {repliedCount > 0 && (
                        <ArrowUturnLeftIcon className="w-3.5 h-3.5 text-[var(--accent-9)]" title={`Replied ${repliedCount}×`} />
                      )}
                      {/* Star */}
                      <span
                        role="button"
                        tabIndex={0}
                        title={reply.is_starred ? 'Unstar' : 'Star'}
                        onClick={(e) => { e.stopPropagation(); applyStatus(reply.id, { is_starred: !reply.is_starred }); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); applyStatus(reply.id, { is_starred: !reply.is_starred }); } }}
                        className="cursor-pointer flex-shrink-0"
                      >
                        {reply.is_starred
                          ? <StarIconSolid className="w-4 h-4 text-[var(--amber-9)]" />
                          : <StarIcon className="w-4 h-4 text-[var(--gray-9)] hover:text-[var(--amber-9)]" />}
                      </span>
                      {/* Archive */}
                      <span
                        role="button"
                        tabIndex={0}
                        title={reply.is_archived ? 'Move to inbox' : 'Archive'}
                        onClick={(e) => { e.stopPropagation(); applyStatus(reply.id, { is_archived: !reply.is_archived }); if (!reply.is_archived) setExpandedId(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); applyStatus(reply.id, { is_archived: !reply.is_archived }); } }}
                        className="cursor-pointer flex-shrink-0"
                      >
                        {reply.is_archived
                          ? <ArchiveBoxXMarkIcon className="w-4 h-4 text-[var(--gray-9)] hover:text-[var(--gray-12)]" />
                          : <ArchiveBoxArrowDownIcon className="w-4 h-4 text-[var(--gray-9)] hover:text-[var(--gray-12)]" />}
                      </span>
                      <span className="text-xs text-[var(--gray-9)] whitespace-nowrap">{formatTime(reply.created_at)}</span>
                      {isExpanded ? <ChevronUpIcon className="w-4 h-4 text-[var(--gray-9)]" /> : <ChevronDownIcon className="w-4 h-4 text-[var(--gray-9)]" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-[var(--gray-a4)]">
                      <div className="pt-3">
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--gray-9)] mb-3">
                          <span>
                            From:{' '}
                            <PersonLink
                              personId={personId}
                              label={reply.from_name ? `${reply.from_name} <${reply.from_email}>` : reply.from_email}
                              className="text-xs"
                            />
                          </span>
                          <span>Date: {new Date(reply.created_at).toLocaleString()}</span>
                          {reply.forwarded_at && (
                            <span className="flex items-center gap-1">
                              <ArrowUturnRightIcon className="w-3 h-3" /> Forwarded to {reply.forwarded_to} at {new Date(reply.forwarded_at).toLocaleString()}
                            </span>
                          )}
                        </div>
                        {reply.body_html ? (
                          <div className="prose prose-sm max-w-none text-[var(--gray-12)] [&_a]:text-[var(--accent-9)]" dangerouslySetInnerHTML={{ __html: reply.body_html }} />
                        ) : (
                          <pre className="text-sm text-[var(--gray-12)] whitespace-pre-wrap font-sans">{reply.body_text || '(empty)'}</pre>
                        )}
                        <SentReplyList messages={sentByReply[reply.id] || []} />
                        <ReplyComposer
                          kind={kind}
                          replyId={reply.id}
                          toEmail={reply.from_email}
                          toName={reply.from_name}
                          onSent={onReload}
                        />
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Sent folder: our outbound replies (admin composer), newest first. */
function SentFolder({ sent, personByEmail }: { sent: SentMessage[]; personByEmail: Record<string, string> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const ordered = useMemo(
    () => [...sent].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [sent],
  );

  if (ordered.length === 0) {
    return (
      <Card variant="surface" className="p-12 text-center">
        <PaperAirplaneIcon className="w-10 h-10 text-[var(--gray-8)] mx-auto mb-3" />
        <p className="text-[var(--gray-11)] mb-1">No sent replies</p>
        <p className="text-sm text-[var(--gray-9)]">Replies you send from here will appear in this folder</p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {ordered.map((m) => {
        const open = openId === m.id;
        const personId = personByEmail[m.to_address?.toLowerCase()];
        return (
          <Card key={m.id} variant="surface">
            <button onClick={() => setOpenId(open ? null : m.id)} className="w-full text-left px-4 py-3 flex items-center gap-3">
              <PaperAirplaneIcon className="w-4 h-4 text-[var(--gray-9)] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[var(--gray-9)]">To</span>
                  <PersonLink personId={personId} label={m.to_address} className="text-sm truncate" />
                </div>
                <p className="text-sm truncate text-[var(--gray-9)]">{m.subject || '(no subject)'}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {m.attachments && m.attachments.length > 0 && (
                  <PaperClipIcon className="w-3.5 h-3.5 text-[var(--gray-9)]" title={`${m.attachments.length} attachment(s)`} />
                )}
                <span className="text-xs text-[var(--gray-9)] whitespace-nowrap">{formatTime(m.created_at)}</span>
                {open ? <ChevronUpIcon className="w-4 h-4 text-[var(--gray-9)]" /> : <ChevronDownIcon className="w-4 h-4 text-[var(--gray-9)]" />}
              </div>
            </button>
            {open && (
              <div className="px-4 pb-4 border-t border-[var(--gray-a4)]">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--gray-9)] my-3">
                  <span>To: {m.to_address}</span>
                  <span>From: {m.from_address}</span>
                  <span>Date: {new Date(m.created_at).toLocaleString()}</span>
                </div>
                {m.body_html ? (
                  <div className="prose prose-sm max-w-none text-[var(--gray-12)] [&_a]:text-[var(--accent-9)]" dangerouslySetInnerHTML={{ __html: m.body_html }} />
                ) : (
                  <pre className="text-sm text-[var(--gray-12)] whitespace-pre-wrap font-sans">{m.body_text || ''}</pre>
                )}
                {m.attachments && m.attachments.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {m.attachments.map((a, i) => (
                      <li key={`${a.filename}-${i}`} className="flex items-center gap-1.5 text-xs text-[var(--gray-10)]">
                        <PaperClipIcon className="w-3 h-3" />
                        <span className="truncate">{a.filename}</span>
                        {typeof a.size === 'number' && a.size > 0 && <span className="text-[var(--gray-9)]">{(a.size / 1024).toFixed(0)} KB</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export default RepliesWorkspace;
