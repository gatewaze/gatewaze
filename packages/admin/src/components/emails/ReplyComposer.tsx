import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { PaperClipIcon, PaperAirplaneIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { supabase } from '@/lib/supabase';

interface ReplyComposerProps {
  /** Which module the reply belongs to — routes the send server-side. */
  kind: 'broadcast' | 'newsletter';
  /** The inbound reply row id we're responding to. */
  replyId: string;
  /** Recipient (the person who replied). */
  toEmail: string;
  toName?: string | null;
  /** Called after a successful send (e.g. to reload the thread). */
  onSent?: () => void;
}

// SendGrid caps a message at 30 MB; keep well under that and under the edge
// function request-body limit by capping attachments at 10 MB total.
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Inline composer for replying to a broadcast/newsletter reply. Sends via the
 * `reply-send` edge function, which dispatches FROM the original send address
 * (so the person's next reply is forwarded like any other). Rich-text body plus
 * optional file attachments.
 */
export function ReplyComposer({ kind, replyId, toEmail, toName, onSent }: ReplyComposerProps) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isEmpty = !body.replace(/<[^>]*>/g, '').trim();

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const next = [...files, ...Array.from(list)];
    const total = next.reduce((n, f) => n + f.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      toast.error('Attachments exceed 10 MB total');
      return;
    }
    setFiles(next);
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const send = async () => {
    if (isEmpty) {
      toast.error('Write a reply first');
      return;
    }
    setSending(true);
    try {
      const attachments = await Promise.all(
        files.map(async (f) => ({
          filename: f.name,
          type: f.type || 'application/octet-stream',
          content: await fileToBase64(f),
        })),
      );
      const bodyText = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const { data, error } = await supabase.functions.invoke('reply-send', {
        body: { kind, replyId, bodyHtml: body, bodyText, attachments },
      });
      if (error || (data && data.error)) {
        throw new Error(error?.message || data?.error || 'Send failed');
      }
      toast.success(`Reply sent to ${toName || toEmail}`);
      setBody('');
      setFiles([]);
      onSent?.();
    } catch (e) {
      toast.error(`Could not send reply: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-[var(--gray-a5)] bg-[var(--gray-a1)] p-3">
      <div className="flex items-center justify-between mb-2 text-xs text-[var(--gray-9)]">
        <span>
          Reply to{' '}
          <span className="text-[var(--gray-11)]">
            {toName ? `${toName} <${toEmail}>` : toEmail}
          </span>
        </span>
        <span className="italic">Sends from the original address</span>
      </div>

      <RichTextEditor
        content={body}
        onChange={setBody}
        placeholder="Write your reply…"
        editable={!sending}
      />

      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs text-[var(--gray-11)]">
              <PaperClipIcon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{f.name}</span>
              <span className="text-[var(--gray-9)] flex-shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                disabled={sending}
                className="text-[var(--gray-9)] hover:text-[var(--red-9)] flex-shrink-0"
                title="Remove attachment"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-center justify-between">
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
        <Button variant="soft" color="gray" size="1" onClick={() => inputRef.current?.click()} disabled={sending}>
          <PaperClipIcon className="w-4 h-4" /> Attach
        </Button>
        <Button variant="solid" size="2" onClick={send} disabled={sending || isEmpty}>
          <PaperAirplaneIcon className="w-4 h-4" /> {sending ? 'Sending…' : 'Send reply'}
        </Button>
      </div>
    </div>
  );
}

export default ReplyComposer;

export interface SentReplyMessage {
  id: string;
  from_address: string;
  to_address: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  attachments: { filename: string; type?: string; size?: number }[] | null;
  created_at: string;
}

/** Renders the admin's outbound replies (a thread) beneath an inbound reply. */
export function SentReplyList({ messages }: { messages: SentReplyMessage[] }) {
  if (!messages.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {messages.map((m) => (
        <div
          key={m.id}
          className="rounded-lg border-l-2 border-l-[var(--accent-9)] bg-[var(--accent-a2)] px-3 py-2"
        >
          <div className="text-xs text-[var(--gray-9)] mb-1">
            You replied · {new Date(m.created_at).toLocaleString()} · {m.from_address} → {m.to_address}
          </div>
          {m.body_html ? (
            <div
              className="prose prose-sm max-w-none text-[var(--gray-12)] [&_a]:text-[var(--accent-9)]"
              dangerouslySetInnerHTML={{ __html: m.body_html }}
            />
          ) : (
            <pre className="text-sm text-[var(--gray-12)] whitespace-pre-wrap font-sans">{m.body_text || ''}</pre>
          )}
          {m.attachments && m.attachments.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {m.attachments.map((a, i) => (
                <li key={`${a.filename}-${i}`} className="flex items-center gap-1.5 text-xs text-[var(--gray-10)]">
                  <PaperClipIcon className="w-3 h-3" />
                  <span className="truncate">{a.filename}</span>
                  {typeof a.size === 'number' && a.size > 0 && (
                    <span className="text-[var(--gray-9)]">{(a.size / 1024).toFixed(0)} KB</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
