import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpTrayIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Button, Modal, Input } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { createSegmentService } from '@/lib/segments';
import { usePeopleAttributes } from '@/hooks/usePeopleAttributes';

/**
 * CSV import wizard: upload → map columns → options (contact kind, acquisition
 * source, list subscriptions, per-import segment) → run.
 *
 * Rows go through the people_import_batch RPC (migration 00043): new people are
 * created with the chosen contact_kind + acquisition_source; existing people
 * only gain missing attributes (their kind is never changed); subscriptions are
 * insert-if-absent so a prior unsubscribe is never overwritten. Every touched
 * person is tagged with attributes.import_batches, and the wizard creates a
 * dynamic segment on that tag — so the import is visible at a glance and the
 * segment survives recalculation.
 */

interface ImportPeopleModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful import (kind = what new people were created as). */
  onComplete: (result: { segmentId: string | null; kind: string }) => void;
}

interface ListOption { id: string; name: string; is_internal?: boolean | null }

interface ImportTotals {
  created: number;
  updated: number;
  subscriptions_added: number;
  skipped_invalid: number;
  deduped: number;
}

const SKIP = '__skip__';
const BATCH_SIZE = 500;

/** Minimal RFC-4180-ish CSV parser: quoted fields, embedded commas/quotes/newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/** Auto-map a CSV header to a target field (email or a people attribute key). */
function guessTarget(header: string, attrKeys: string[]): string {
  const h = header.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (/^e?_?mail(_address)?$/.test(h)) return 'email';
  if (attrKeys.includes(h)) return h;
  const aliases: Record<string, string> = {
    firstname: 'first_name', givenname: 'first_name', first: 'first_name',
    lastname: 'last_name', surname: 'last_name', familyname: 'last_name', last: 'last_name',
    organisation: 'company', organization: 'company', company_name: 'company', employer: 'company',
    title: 'job_title', jobtitle: 'job_title', position: 'job_title', role: 'job_title',
    linkedin: 'linkedin_url', linkedin_profile: 'linkedin_url',
  };
  const alias = aliases[h.replace(/_/g, '')] ?? aliases[h];
  if (alias && attrKeys.includes(alias)) return alias;
  return SKIP;
}

export function ImportPeopleModal({ isOpen, onClose, onComplete }: ImportPeopleModalProps) {
  const { attributes: peopleAttrConfig } = usePeopleAttributes();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'upload' | 'options' | 'done'>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});

  const [contactKind, setContactKind] = useState<'prospect' | 'member' | 'event_contact'>('prospect');
  const [source, setSource] = useState('');
  const [lists, setLists] = useState<ListOption[]>([]);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [createSegment, setCreateSegment] = useState(true);
  const [segmentName, setSegmentName] = useState('');

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totals, setTotals] = useState<ImportTotals | null>(null);
  const [segmentId, setSegmentId] = useState<string | null>(null);

  const attrKeys = useMemo(
    () => peopleAttrConfig.filter((a) => a.enabled).map((a) => a.key),
    [peopleAttrConfig],
  );
  const targetOptions = useMemo(
    () => [
      { value: SKIP, label: '— skip —' },
      { value: 'email', label: 'Email (required)' },
      ...peopleAttrConfig.filter((a) => a.enabled).map((a) => ({ value: a.key, label: a.label })),
    ],
    [peopleAttrConfig],
  );

  useEffect(() => {
    if (!isOpen) return;
    supabase
      .from('lists')
      .select('id, name, is_internal')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setLists((data ?? []) as ListOption[]));
  }, [isOpen]);

  const reset = () => {
    setStep('upload'); setFileName(''); setHeaders([]); setRows([]); setMapping({});
    setContactKind('prospect'); setSource(''); setSelectedListIds(new Set());
    setCreateSegment(true); setSegmentName(''); setRunning(false); setProgress(0);
    setTotals(null); setSegmentId(null);
    if (fileRef.current) fileRef.current.value = '';
  };
  const close = () => { if (!running) { reset(); onClose(); } };

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) { toast.error('Please select a CSV file'); return; }
    if (file.size > 50 * 1024 * 1024) { toast.error('File exceeds the 50MB limit'); return; }
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) { toast.error('CSV needs a header row and at least one data row'); return; }
    const hdrs = parsed[0].map((h) => h.trim());
    const initial: Record<number, string> = {};
    hdrs.forEach((h, i) => { initial[i] = guessTarget(h, attrKeys); });
    // guessTarget can map two columns to the same target; keep the first only
    const seen = new Set<string>();
    Object.keys(initial).map(Number).sort((a, b) => a - b).forEach((i) => {
      if (initial[i] !== SKIP && seen.has(initial[i])) initial[i] = SKIP;
      else seen.add(initial[i]);
    });
    setFileName(file.name);
    setHeaders(hdrs);
    setRows(parsed.slice(1));
    setMapping(initial);
  };

  const emailColumn = Object.entries(mapping).find(([, t]) => t === 'email')?.[0];
  const canContinue = headers.length > 0 && emailColumn !== undefined;

  const defaultSegmentName = () =>
    `Import: ${source.trim() || fileName.replace(/\.csv$/i, '')} — ${new Date().toLocaleDateString()}`;

  const runImport = async () => {
    if (!source.trim()) { toast.error('Set an acquisition source — you must be able to say where these contacts came from'); return; }
    setRunning(true);
    try {
      const batchId = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const emailIdx = Number(emailColumn);
      const attrEntries = Object.entries(mapping)
        .map(([i, t]) => [Number(i), t] as const)
        .filter(([, t]) => t !== SKIP && t !== 'email');

      const payload = rows
        .map((r) => ({
          email: (r[emailIdx] ?? '').trim(),
          attributes: Object.fromEntries(
            attrEntries.map(([i, t]) => [t, (r[i] ?? '').trim()]).filter(([, v]) => v !== ''),
          ),
        }))
        .filter((r) => r.email !== '');

      const sum: ImportTotals = { created: 0, updated: 0, subscriptions_added: 0, skipped_invalid: 0, deduped: 0 };
      for (let i = 0; i < payload.length; i += BATCH_SIZE) {
        const { data, error } = await supabase.rpc('people_import_batch', {
          p_rows: payload.slice(i, i + BATCH_SIZE),
          p_batch_id: batchId,
          p_contact_kind: contactKind,
          p_acquisition_source: source.trim(),
          p_list_ids: selectedListIds.size > 0 ? Array.from(selectedListIds) : null,
          p_subscription_source: `import:${source.trim()}`,
        });
        if (error) throw error;
        const t = data as ImportTotals;
        (Object.keys(sum) as (keyof ImportTotals)[]).forEach((k) => { sum[k] += Number(t[k] ?? 0); });
        setProgress(Math.min(i + BATCH_SIZE, payload.length));
      }

      let segId: string | null = null;
      if (createSegment) {
        const seg = await createSegmentService(supabase).createSegment({
          name: (segmentName.trim() || defaultSegmentName()).slice(0, 120),
          description: `People imported from "${fileName}" (source: ${source.trim()}) on ${new Date().toLocaleString()}.`,
          definition: {
            match: 'all',
            conditions: [{ type: 'attribute', field: 'import_batches', operator: 'contains', value: batchId }],
          },
        });
        segId = seg.id;
      }

      setTotals(sum);
      setSegmentId(segId);
      setStep('done');
      onComplete({ segmentId: segId, kind: contactKind });
    } catch (error) {
      console.error('Import failed:', error);
      toast.error(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setRunning(false);
    }
  };

  const inputCls = 'w-full rounded-md border border-[var(--gray-a6)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--gray-12)]';

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Import people"
      size="2xl"
      footer={
        <div className="flex justify-between items-center w-full">
          <span className="text-xs text-[var(--gray-a11)]">
            {step === 'upload' && rows.length > 0 && `${rows.length.toLocaleString()} data rows in ${fileName}`}
            {step === 'options' && running && `Imported ${progress.toLocaleString()} of ${rows.length.toLocaleString()}…`}
          </span>
          <div className="flex gap-2">
            {step !== 'done' && <Button variant="outline" onClick={close} disabled={running}>Cancel</Button>}
            {step === 'upload' && (
              <Button onClick={() => { setSegmentName(defaultSegmentName()); setStep('options'); }} disabled={!canContinue}>
                Continue
              </Button>
            )}
            {step === 'options' && (
              <Button onClick={runImport} disabled={running || !source.trim()}>
                {running ? 'Importing…' : `Import ${rows.length.toLocaleString()} rows`}
              </Button>
            )}
            {step === 'done' && <Button onClick={close}>Done</Button>}
          </div>
        </div>
      }
    >
      {step === 'upload' && (
        <div className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-lg border-2 border-dashed border-[var(--gray-a6)] p-8 text-center hover:border-[var(--accent-8)] transition-colors"
          >
            <ArrowUpTrayIcon className="mx-auto size-8 text-[var(--gray-a9)]" />
            <p className="mt-2 text-sm font-medium text-[var(--gray-12)]">
              {fileName || 'Choose a CSV file'}
            </p>
            <p className="mt-1 text-xs text-[var(--gray-a11)]">
              First row must be headers. An email column is required; other columns can map to profile fields.
            </p>
          </button>

          {headers.length > 0 && (
            <div>
              <p className="text-sm font-medium text-[var(--gray-12)] mb-2">Map columns</p>
              {!emailColumn && (
                <p className="text-xs text-red-600 dark:text-red-400 mb-2">Map one column to Email to continue.</p>
              )}
              <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--gray-a6)]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--gray-2)]">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-[var(--gray-11)]">CSV column</th>
                      <th className="text-left px-3 py-2 font-medium text-[var(--gray-11)]">Example</th>
                      <th className="text-left px-3 py-2 font-medium text-[var(--gray-11)]">Imports as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map((h, i) => (
                      <tr key={i} className="border-t border-[var(--gray-a4)]">
                        <td className="px-3 py-2 text-[var(--gray-12)]">{h || <em>(blank)</em>}</td>
                        <td className="px-3 py-2 text-[var(--gray-a11)] truncate max-w-[180px]">{rows[0]?.[i] || '—'}</td>
                        <td className="px-3 py-2">
                          <select
                            className={inputCls}
                            value={mapping[i] ?? SKIP}
                            onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value }))}
                          >
                            {targetOptions.map((o) => (
                              <option
                                key={o.value}
                                value={o.value}
                                disabled={o.value !== SKIP && o.value !== mapping[i] && Object.values(mapping).includes(o.value)}
                              >
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'options' && (
        <div className="space-y-5">
          <div>
            <span className="block text-sm font-medium text-[var(--gray-12)] mb-1.5">Contact kind for new people</span>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'prospect', label: 'Outreach prospect', hint: 'No opt-in — excluded from bulk email' },
                { value: 'event_contact', label: 'Event contact', hint: 'Registered/attended an event' },
                { value: 'member', label: 'Member', hint: 'Consented — only if consent genuinely exists' },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={running}
                  onClick={() => setContactKind(opt.value)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    contactKind === opt.value
                      ? 'border-[var(--accent-9)] bg-[var(--accent-a3)]'
                      : 'border-[var(--gray-a6)] hover:bg-[var(--gray-a2)]'
                  }`}
                >
                  <span className="block text-sm font-medium text-[var(--gray-12)]">{opt.label}</span>
                  <span className="block text-xs text-[var(--gray-11)] mt-0.5">{opt.hint}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--gray-a11)] mt-1.5">
              Applies to newly created people only — people who already exist keep their current kind, and only gain profile fields they were missing.
            </p>
          </div>

          <Input
            label="Acquisition source (where did these contacts come from?)"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="e.g. apollo_export_2026_07, conference_badges_kubecon, partner_list"
            required
            disabled={running}
          />

          <div>
            <span className="block text-sm font-medium text-[var(--gray-12)] mb-1.5">Subscribe to lists (optional)</span>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--gray-a6)] p-2 space-y-1">
              {lists.length === 0 && <p className="text-xs text-[var(--gray-a11)] px-1 py-2">No active lists.</p>}
              {lists.map((l) => (
                <label key={l.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-[var(--gray-a2)] cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded"
                    disabled={running}
                    checked={selectedListIds.has(l.id)}
                    onChange={(e) => setSelectedListIds((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(l.id); else next.delete(l.id);
                      return next;
                    })}
                  />
                  <span className="text-sm text-[var(--gray-12)]">{l.name}</span>
                  {l.is_internal && <span className="text-xs text-[var(--gray-a10)]">(internal)</span>}
                </label>
              ))}
            </div>
            <p className="text-xs text-[var(--gray-a11)] mt-1.5">
              Anyone who previously unsubscribed from a list stays unsubscribed. Subscribing prospects does not
              opt them into broadcasts — prospects stay excluded from bulk sends until they opt in or a send is
              explicitly marked as an outreach send.
            </p>
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer mb-1.5">
              <input type="checkbox" className="rounded" checked={createSegment} disabled={running} onChange={(e) => setCreateSegment(e.target.checked)} />
              <span className="text-sm font-medium text-[var(--gray-12)]">Create a segment for this import</span>
            </label>
            {createSegment && (
              <Input
                value={segmentName}
                onChange={(e) => setSegmentName(e.target.value)}
                placeholder={defaultSegmentName()}
                disabled={running}
              />
            )}
            <p className="text-xs text-[var(--gray-a11)] mt-1.5">
              Everyone in this import (new and existing) lands in the segment, so you can see them at a glance
              or target them later.
            </p>
          </div>
        </div>
      )}

      {step === 'done' && totals && (
        <div className="space-y-4 text-center py-4">
          <CheckCircleIcon className="mx-auto size-12 text-[var(--green-9)]" />
          <p className="text-lg font-medium text-[var(--gray-12)]">Import complete</p>
          <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
            {[
              { label: 'Created', value: totals.created },
              { label: 'Already existed', value: totals.updated },
              { label: 'Subscriptions added', value: totals.subscriptions_added },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-[var(--gray-a5)] p-3">
                <div className="text-xl font-bold text-[var(--gray-12)]">{s.value.toLocaleString()}</div>
                <div className="text-xs text-[var(--gray-11)]">{s.label}</div>
              </div>
            ))}
          </div>
          {(totals.skipped_invalid > 0 || totals.deduped > 0) && (
            <p className="text-xs text-[var(--gray-a11)]">
              {totals.skipped_invalid > 0 && `${totals.skipped_invalid} row(s) skipped (invalid email). `}
              {totals.deduped > 0 && `${totals.deduped} duplicate email(s) collapsed.`}
            </p>
          )}
          {segmentId && (
            <a href={`/segments/${segmentId}`} className="inline-block text-sm font-medium text-[var(--accent-11)] hover:text-[var(--accent-12)]">
              View the import segment →
            </a>
          )}
        </div>
      )}
    </Modal>
  );
}
