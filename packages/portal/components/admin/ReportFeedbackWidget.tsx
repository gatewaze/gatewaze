'use client';
/**
 * "Report feedback" on the PORTAL for signed-in admins (software-engineer SPEC §10.5, phase 3).
 *
 * Self-contained portal twin of the admin widget: a floating button that renders ONLY when the
 * signed-in user passes the SE module's admin gate (the /projects probe 401/403s for everyone
 * else — regular portal visitors never see it). The triage copilot turns rough feedback into a
 * draft ticket seeded with the current portal route; the human reviews the editable draft and the
 * issue is created via the SE module's admin API (project PAT). All calls carry the user's own
 * Supabase JWT to the api service (NEXT_PUBLIC_API_URL base; same-origin '' in dev proxies).
 *
 * Lives in core (not the module) because the portal has no module contribution point for GLOBAL
 * components — module portal contributions are page-scoped via the generated registry. If such a
 * contribution point lands later, this file moves into the module unchanged.
 */
import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
const API = `${API_BASE}/api/modules/software-engineer/admin`;

async function api(path: string, init?: RequestInit) {
  const { data } = await getSupabaseClient().auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('no session');
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${r.status}`);
  return r.status === 204 ? null : r.json();
}

interface Msg { role: 'user' | 'assistant'; content: string }

export default function ReportFeedbackWidget() {
  const [projects, setProjects] = useState<Array<{ id: string; name: string; avatar_emoji?: string }> | null>(null);
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ title: string; body: string; assign: boolean } | null>(null);
  const [created, setCreated] = useState<{ number?: number; url?: string; runId?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api('/projects')
      .then((d) => { const l = d?.projects ?? []; if (l.length) { setProjects(l); setProjectId(l[0].id); } })
      .catch(() => { /* not an SE admin (or no session) → widget stays hidden */ });
  }, []);

  if (!projects) return null;

  const send = async () => {
    const content = input.trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next); setInput(''); setBusy(true); setErr(null);
    try {
      const r = await api('/issues/triage', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          messages: next,
          page_context: { route: typeof window !== 'undefined' ? `portal:${window.location.pathname}` : undefined },
        }),
      });
      if (r?.type === 'draft') {
        setDraft({ title: r.title ?? '', body: r.body ?? '', assign: !!r.assign_to_agent });
        setMessages((m) => [...m, { role: 'assistant', content: `Drafted: ${r.title}\nReview below and press Create.` }]);
      } else if (r?.type === 'questions' && r.message) {
        setMessages((m) => [...m, { role: 'assistant', content: r.message }]);
      } else setErr(r?.message || 'triage failed');
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  const create = async () => {
    if (!draft?.title.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await api('/issues', { method: 'POST', body: JSON.stringify({
        project_id: projectId, title: draft.title.trim(), body: draft.body, assign_to_agent: draft.assign,
      }) });
      setCreated(res); setDraft(null); setMessages([]);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-[360px] max-w-[calc(100vw-2rem)] space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-gray-900 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
          <div className="flex items-center gap-2 text-sm font-medium">
            Report feedback
            {projects.length > 1 && (
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="ml-auto rounded-md border px-1.5 py-0.5 text-xs dark:bg-gray-800">
                {projects.map((p) => <option key={p.id} value={p.id}>{p.avatar_emoji || '📁'} {p.name}</option>)}
              </select>
            )}
          </div>

          {created ? (
            <div className="rounded-md border border-green-300 bg-green-50 p-2 text-sm text-green-800">
              Issue #{created.number} created{created.runId ? ' — an agent is on it' : ''}.{' '}
              {created.url && <a href={created.url} target="_blank" rel="noreferrer" className="underline">View</a>}
              <button onClick={() => setCreated(null)} className="ml-2 text-xs underline">Report another</button>
            </div>
          ) : (
            <>
              {messages.length > 0 && (
                <div className="max-h-48 space-y-1.5 overflow-y-auto text-sm">
                  {messages.map((m, i) => (
                    <div key={i} className={`whitespace-pre-wrap rounded-md px-2.5 py-1.5 ${m.role === 'user' ? 'bg-gray-100 dark:bg-gray-800' : 'bg-blue-500/10'}`}>{m.content}</div>
                  ))}
                  {busy && <div className="px-2.5 py-1 text-xs text-gray-500">thinking…</div>}
                </div>
              )}
              <div className="flex gap-2">
                <textarea value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Describe the problem on this page…" rows={2} disabled={busy}
                  className="min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-sm dark:bg-gray-800" />
                <button onClick={send} disabled={busy || !input.trim()} className="rounded-md bg-blue-600 px-3 text-sm font-medium text-white disabled:opacity-50">→</button>
              </div>
              {draft && (
                <div className="space-y-1.5 rounded-md border p-2 dark:border-gray-700">
                  <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="w-full rounded-md border px-2 py-1 text-sm dark:bg-gray-800" />
                  <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={5} className="w-full rounded-md border px-2 py-1 font-mono text-xs dark:bg-gray-800" />
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input type="checkbox" checked={draft.assign} onChange={(e) => setDraft({ ...draft, assign: e.target.checked })} />
                    Hand to a software engineer agent
                  </label>
                  <button onClick={create} disabled={busy || !draft.title.trim()} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                    {busy ? 'Creating…' : 'Create issue'}
                  </button>
                </div>
              )}
              {err && <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800">{err}</div>}
            </>
          )}
        </div>
      )}
      <button onClick={() => setOpen((v) => !v)}
        className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-blue-700"
        aria-label="Report feedback">
        {open ? '×' : '💬 Report feedback'}
      </button>
    </div>
  );
}
