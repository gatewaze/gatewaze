// @ts-nocheck
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  SparklesIcon,
  EnvelopeIcon,
  UserGroupIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  EyeIcon,
  XMarkIcon,
  BeakerIcon,
  PencilIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline';
import { Card, Button, Modal, Select } from '@/components/ui-legacy';
import { RichTextEditor } from '@/components/ui-legacy/RichTextEditor';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { supabase } from '@/lib/supabase';
import EmailService from '@/utils/emailService';

interface AttendeeInfo {
  id: string;
  full_name: string | null;
  email: string;
  job_title: string | null;
  company: string | null;
}

interface Match {
  id: string;
  event_id: string;
  registration_a_id: string;
  registration_b_id: string;
  match_score: number | null;
  match_reason: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  intro_email_sent_at: string | null;
  generated_at: string;
  preceding_word_a: string | null;
  preceding_word_b: string | null;
  person_a: AttendeeInfo | null;
  person_b: AttendeeInfo | null;
}

interface UnmatchedAttendee {
  registration_id: string;
  full_name: string;
  job_title: string | null;
  company: string | null;
}

interface GenerateResult {
  pairs_created: number;
  unmatched_count: number;
  unmatched?: UnmatchedAttendee[];
}

interface EventInfo {
  event_title: string;
  event_start: string | null;
  event_link: string | null;
}

interface Props {
  eventId: string;
}

const GENERATE_STEPS = [
  { label: 'Fetching registrants…', minMs: 0 },
  { label: 'Asking AI to generate matches…', minMs: 2000 },
  { label: 'Saving matches…', minMs: 99999 },
];

const DEFAULT_SUBJECT = '{{person_a_first_name}}, meet {{person_b_first_name}} — your intro for {{event_title}}';

const DEFAULT_CONTENT = `<p>Hey {{person_a_first_name}} and {{person_b_first_name}},</p>
<p>I want to introduce you both so you know at least one person on {{event_weekday}} at the {{event_title}}. I know going to an event can be intimidating sometimes so hopefully this helps.</p>
<p>{{person_a_first_name}} is {{preceding_word_a}} {{person_a_job_title}} at {{person_a_company}} and {{person_b_first_name}} is {{preceding_word_b}} {{person_b_job_title}} at {{person_b_company}}.</p>
<p>I'll let you all take it from here. Keep me posted how it goes.</p>
<p>- Demetrios</p>`;

function renderTemplateVars(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

function buildPreviewVars(match: Match, eventInfo: EventInfo): Record<string, string> {
  const aFirstName = match.person_a?.full_name?.split(' ')[0] ?? match.person_a?.email ?? '?';
  const bFirstName = match.person_b?.full_name?.split(' ')[0] ?? match.person_b?.email ?? '?';

  const weekday = eventInfo.event_start
    ? new Date(eventInfo.event_start).toLocaleDateString('en-US', { weekday: 'long' })
    : 'the event day';

  return {
    event_title: eventInfo.event_title,
    event_weekday: weekday,
    event_link: eventInfo.event_link ?? '',
    person_a_first_name: aFirstName,
    person_a_job_title: match.person_a?.job_title ?? '',
    person_a_company: match.person_a?.company ?? '',
    preceding_word_a: match.preceding_word_a ?? 'a',
    person_b_first_name: bFirstName,
    person_b_job_title: match.person_b?.job_title ?? '',
    person_b_company: match.person_b?.company ?? '',
    preceding_word_b: match.preceding_word_b ?? 'a',
    match_reason: match.match_reason ?? '',
  };
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  content_html: string;
}

export function EventMatchingTab({ eventId }: Props) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedAttendee[]>([]);
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateStep, setGenerateStep] = useState(0);
  const [generateElapsed, setGenerateElapsed] = useState(0);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [sendingEmails, setSendingEmails] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ sent: number; total: number; errors: string[] } | null>(null);
  const [previewMatch, setPreviewMatch] = useState<Match | null>(null);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [testSendOpen, setTestSendOpen] = useState(false);

  // Email settings state
  const [commSettingsId, setCommSettingsId] = useState<string | null>(null);
  const [fromKey, setFromKey] = useState('events');
  const [replyTo, setReplyTo] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailContent, setEmailContent] = useState('');
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Templates
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // From addresses
  const fromAddresses = EmailService.getFromAddresses();
  const fromOptions = useMemo(() => {
    const options: { label: string; value: string }[] = [];
    if (fromAddresses.events) options.push({ label: `Events (${fromAddresses.events})`, value: 'events' });
    if (fromAddresses.partners) options.push({ label: `Partners (${fromAddresses.partners})`, value: 'partners' });
    if (fromAddresses.members) options.push({ label: `Members (${fromAddresses.members})`, value: 'members' });
    if (fromAddresses.default) options.push({ label: `Default (${fromAddresses.default})`, value: 'default' });
    if (fromAddresses.admin) options.push({ label: `Admin (${fromAddresses.admin})`, value: 'admin' });
    return options;
  }, [fromAddresses]);

  const startGenerateTimer = () => {
    setGenerateElapsed(0);
    setGenerateStep(0);
    setGenerateError(null);
    timerRef.current = setInterval(() => {
      setGenerateElapsed((s) => {
        const next = s + 1;
        setGenerateStep(GENERATE_STEPS.findLastIndex((step) => next * 1000 >= step.minMs));
        return next;
      });
    }, 1000);
  };

  const stopGenerateTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => stopGenerateTimer(), []);

  // Load templates — query directly for match_intro_email type
  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const { data, error } = await supabase
        .from('email_templates')
        .select('id, name, subject, content_html')
        .eq('template_type', 'match_intro_email')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      setTemplates((data as EmailTemplate[]) ?? []);
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const loadMatches = useCallback(async () => {
    setLoading(true);
    try {
      const [evRes, matchRes, csRes] = await Promise.all([
        supabase.from('events').select('event_title, event_start, event_link').eq('event_id', eventId).single(),
        supabase
          .from('event_attendee_matches')
          .select('id, event_id, registration_a_id, registration_b_id, match_score, match_reason, status, intro_email_sent_at, generated_at, preceding_word_a, preceding_word_b')
          .eq('event_id', eventId)
          .order('match_score', { ascending: false }),
        supabase
          .from('event_communication_settings')
          .select('id, match_intro_email_template_id, match_intro_email_from_key, match_intro_email_from_address, match_intro_email_reply_to, match_intro_email_subject, match_intro_email_content')
          .eq('event_id', eventId)
          .single(),
      ]);

      if (evRes.data) setEventInfo(evRes.data);

      if (csRes.data) {
        setCommSettingsId(csRes.data.id);
        const savedFromKey = csRes.data.match_intro_email_from_key ?? 'events';
        setFromKey(savedFromKey);
        setReplyTo(csRes.data.match_intro_email_reply_to ?? '');
        setTemplateId(csRes.data.match_intro_email_template_id ?? null);

        // Auto-resolve from_address if it's missing (backfill for existing rows)
        if (!csRes.data.match_intro_email_from_address && savedFromKey) {
          const parsedFrom = EmailService.getParsedFromAddresses();
          const resolvedFrom = parsedFrom[savedFromKey as keyof typeof parsedFrom]?.email || '';
          if (resolvedFrom) {
            await supabase
              .from('event_communication_settings')
              .update({ match_intro_email_from_address: resolvedFrom })
              .eq('id', csRes.data.id);
          }
        }

        // Load content: prefer inline content, fall back to template, then defaults
        if (csRes.data.match_intro_email_subject || csRes.data.match_intro_email_content) {
          setEmailSubject(csRes.data.match_intro_email_subject ?? '');
          setEmailContent(csRes.data.match_intro_email_content ?? '');
        } else if (csRes.data.match_intro_email_template_id) {
          const { data: tmpl } = await supabase
            .from('email_templates')
            .select('subject, content_html')
            .eq('id', csRes.data.match_intro_email_template_id)
            .single();
          if (tmpl) {
            setEmailSubject(tmpl.subject);
            setEmailContent(tmpl.content_html);
          }
        }
      }
      setSettingsDirty(false);

      const matchRows = matchRes.data;
      if (matchRes.error) throw matchRes.error;

      if (!matchRows || matchRows.length === 0) {
        setMatches([]);
        setLoading(false);
        return;
      }

      const allRegIds = matchRows.flatMap((m: any) => [m.registration_a_id, m.registration_b_id]);
      const { data: registrations } = await supabase
        .from('event_registrations_with_members')
        .select('id, full_name, email, job_title, company')
        .in('id', allRegIds);

      const regMap = new Map<string, AttendeeInfo>();
      for (const r of registrations ?? []) {
        regMap.set(r.id, { id: r.id, full_name: r.full_name, email: r.email, job_title: r.job_title, company: r.company });
      }

      setMatches(matchRows.map((m: any) => ({
        ...m,
        person_a: regMap.get(m.registration_a_id) ?? null,
        person_b: regMap.get(m.registration_b_id) ?? null,
      })));
    } catch (err: any) {
      toast.error('Failed to load matches: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  const handleTemplateSelect = async (selectedTemplateId: string) => {
    setTemplateId(selectedTemplateId || null);
    setSettingsDirty(true);

    if (selectedTemplateId) {
      const template = templates.find(t => t.id === selectedTemplateId);
      if (template) {
        setEmailSubject(template.subject);
        setEmailContent(template.content_html);
      }
    } else {
      // "Start from scratch" — clear to defaults
      setEmailSubject('');
      setEmailContent('');
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      // Resolve the from key to the actual email address
      const parsedFrom = EmailService.getParsedFromAddresses();
      const resolvedFrom = parsedFrom[fromKey as keyof typeof parsedFrom]?.email || '';

      const payload = {
        event_id: eventId,
        match_intro_email_template_id: templateId || null,
        match_intro_email_from_key: fromKey || 'events',
        match_intro_email_from_address: resolvedFrom || null,
        match_intro_email_reply_to: replyTo || null,
        match_intro_email_subject: emailSubject || null,
        match_intro_email_content: emailContent || null,
      };

      if (commSettingsId) {
        const { error } = await supabase
          .from('event_communication_settings')
          .update(payload)
          .eq('id', commSettingsId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('event_communication_settings')
          .upsert(payload, { onConflict: 'event_id' })
          .select('id')
          .single();
        if (error) throw error;
        if (data) setCommSettingsId(data.id);
      }

      setSettingsDirty(false);
      toast.success('Email settings saved');
    } catch (err: any) {
      toast.error('Failed to save settings: ' + err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    startGenerateTimer();
    try {
      const { data, error } = await supabase.functions.invoke('generate-matches', {
        body: { event_id: eventId },
      });

      if (error) {
        let msg = error.message ?? 'Unknown error';
        try {
          const body = await (error as any).context?.json?.();
          if (body?.error) msg = body.error;
        } catch {
          if ((data as any)?.error) msg = (data as any).error;
        }
        throw new Error(msg);
      }

      const result = data as GenerateResult;
      toast.success(`Generated ${result.pairs_created} matches`);
      if (result.unmatched_count > 0) {
        toast.info(`${result.unmatched_count} attendee${result.unmatched_count > 1 ? 's' : ''} left unmatched`);
      }
      if (result.unmatched) setUnmatched(result.unmatched);
      setGenerateError(null);
      await loadMatches();
    } catch (err: any) {
      const msg = err.message ?? 'Unknown error';
      setGenerateError(msg);
      toast.error('Matching failed — see details below');
    } finally {
      stopGenerateTimer();
      setGenerating(false);
    }
  };

  const doSendEmails = async () => {
    setSendConfirmOpen(false);
    setSendingEmails(true);

    // Get unsent match IDs to send in batches with progress
    const unsentMatches = matches.filter((m) => !m.intro_email_sent_at);
    const BATCH_SIZE = 5;
    const totalBatches = Math.ceil(unsentMatches.length / BATCH_SIZE);
    let totalSent = 0;
    const allErrors: string[] = [];

    setSendProgress({ sent: 0, total: unsentMatches.length, errors: [] });

    try {
      for (let i = 0; i < totalBatches; i++) {
        const batch = unsentMatches.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const batchIds = batch.map((m) => m.id);

        const { data, error } = await supabase.functions.invoke('send-match-emails', {
          body: { event_id: eventId, match_ids: batchIds },
        });

        if (error) {
          let msg = error.message ?? 'Unknown error';
          try {
            const body = await (error as any).context?.json?.();
            if (body?.error) msg = body.error;
          } catch {}
          allErrors.push(msg);
          continue;
        }

        const result = data as { emails_sent: number; errors?: string[] };
        totalSent += result.emails_sent;
        if (result.errors) allErrors.push(...result.errors);
        setSendProgress({ sent: totalSent, total: unsentMatches.length, errors: [...allErrors] });
      }

      toast.success(`Sent ${totalSent} introduction email${totalSent !== 1 ? 's' : ''}`);
      if (allErrors.length > 0) {
        toast.warning(`${allErrors.length} error${allErrors.length > 1 ? 's' : ''} during send`);
      }
      await loadMatches();
    } catch (err: any) {
      toast.error('Failed to send emails: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSendingEmails(false);
      setSendProgress(null);
    }
  };

  // Build preview content using first match as sample
  const previewSample = matches[0] ?? null;
  const previewVars = previewSample && eventInfo ? buildPreviewVars(previewSample, eventInfo) : null;
  const previewSubject = previewVars ? renderTemplateVars(emailSubject || DEFAULT_SUBJECT, previewVars) : '';
  const previewContent = previewVars ? renderTemplateVars(emailContent || DEFAULT_CONTENT, previewVars) : '';

  const emailsSentCount = matches.filter((m) => m.intro_email_sent_at).length;
  const unsentCount = matches.filter((m) => !m.intro_email_sent_at).length;

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <div className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">1:1 Attendee matching</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                AI pairs attendees based on job title and company to spark great conversations before the event.
              </p>
            </div>
            <div className="flex gap-3 flex-shrink-0 flex-wrap">
              <Button
                variant="outline"
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-2"
              >
                <SparklesIcon className="w-4 h-4" />
                {generating ? 'Generating…' : matches.length > 0 ? 'Regenerate' : 'Generate matches'}
              </Button>
              {matches.length > 0 && (
                <Button
                  onClick={() => setSendConfirmOpen(true)}
                  disabled={sendingEmails || unsentCount === 0}
                  className="flex items-center gap-2"
                >
                  <EnvelopeIcon className="w-4 h-4" />
                  {sendingEmails ? 'Sending…' : unsentCount > 0 ? `Send all emails (${unsentCount})` : 'All emails sent'}
                </Button>
              )}
            </div>
          </div>

          {matches.length > 0 && (
            <div className="flex gap-6 mt-5 pt-5 border-t border-gray-100 dark:border-gray-700">
              <Stat label="Pairs" value={matches.length} />
              <Stat label="Emails sent" value={emailsSentCount} color="text-blue-600 dark:text-blue-400" />
            </div>
          )}
        </div>
      </Card>

      {/* Match Intro Email — same style as comms page */}
      <Card>
        <div className={`border rounded-lg p-5 transition-colors ${
          settingsOpen
            ? 'border-primary-500 dark:border-primary-400'
            : 'border-gray-200 dark:border-gray-700'
        }`}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                Match intro email
              </h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Configure the introduction email sent to matched attendee pairs
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settingsOpen}
                onChange={(e) => setSettingsOpen(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:border-gray-600 peer-checked:bg-primary-600" />
            </label>
          </div>

          {settingsOpen && (
            <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              {/* From Address */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  From address
                </label>
                <Select
                  value={fromKey}
                  onChange={(e) => {
                    setFromKey(e.target.value);
                    setSettingsDirty(true);
                  }}
                  data={fromOptions}
                />
              </div>

              {/* Load Template */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Load template
                </label>
                <select
                  value={templateId || ''}
                  onChange={(e) => handleTemplateSelect(e.target.value)}
                  disabled={loadingTemplates}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-50"
                >
                  <option value="">
                    {loadingTemplates ? 'Loading templates...' : 'Start from scratch'}
                  </option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                {templates.length === 0 && !loadingTemplates && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    No match_intro_email templates available. Create one in Admin &gt; Emails.
                  </p>
                )}
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => { setEmailSubject(e.target.value); setSettingsDirty(true); }}
                  placeholder={DEFAULT_SUBJECT}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>

              {/* Message Editor / Preview Toggle */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Message
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTestSendOpen(true)}
                      disabled={matches.length === 0}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      <PaperAirplaneIcon className="h-4 w-4" />
                      Send test
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPreview(!showPreview)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5 ${
                        showPreview
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                          : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {showPreview ? (
                        <>
                          <PencilIcon className="h-4 w-4" />
                          Edit
                        </>
                      ) : (
                        <>
                          <EyeIcon className="h-4 w-4" />
                          Preview
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Template variable hint when editing */}
                {!showPreview && (
                  <div className="mb-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      Available variables: {'{{person_a_first_name}}'}, {'{{person_b_first_name}}'}, {'{{event_title}}'}, {'{{event_weekday}}'}, {'{{person_a_job_title}}'}, {'{{person_a_company}}'}, {'{{person_b_job_title}}'}, {'{{person_b_company}}'}, {'{{preceding_word_a}}'}, {'{{preceding_word_b}}'}, {'{{event_link}}'}, {'{{match_reason}}'}
                    </p>
                  </div>
                )}

                {showPreview ? (
                  /* Preview Mode */
                  <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Preview for: {previewSample?.person_a?.full_name ?? 'Person A'} &amp; {previewSample?.person_b?.full_name ?? 'Person B'}
                      </p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                        Subject: {previewSubject || '(No subject)'}
                      </p>
                    </div>
                    <div
                      className="p-4 prose prose-sm dark:prose-invert max-w-none overflow-y-auto bg-white dark:bg-gray-900"
                      style={{ minHeight: '300px', maxHeight: '500px' }}
                      dangerouslySetInnerHTML={{ __html: previewContent || '<p class="text-gray-400">(No content)</p>' }}
                    />
                  </div>
                ) : (
                  /* Edit Mode */
                  <div style={{ minHeight: '300px' }}>
                    <RichTextEditor
                      content={emailContent || DEFAULT_CONTENT}
                      onChange={(val) => { setEmailContent(val); setSettingsDirty(true); }}
                      placeholder="Enter your message here... Use {{person_a_first_name}}, {{event_title}}, etc."
                    />
                  </div>
                )}
              </div>

              {/* Reply-To Address */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Reply-to address (optional)
                </label>
                <input
                  type="email"
                  value={replyTo}
                  onChange={(e) => { setReplyTo(e.target.value); setSettingsDirty(true); }}
                  placeholder="replies@example.com"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Where replies should be sent (if different from the from address)
                </p>
              </div>

              {/* Save */}
              <div className="flex items-center justify-end gap-3 pt-2">
                {settingsDirty && (
                  <span className="text-xs text-amber-500 dark:text-amber-400">Unsaved changes</span>
                )}
                <Button
                  onClick={handleSaveSettings}
                  disabled={!settingsDirty || savingSettings}
                >
                  {savingSettings ? 'Saving…' : 'Save email settings'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Generation progress */}
      {generating && (
        <Card>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {GENERATE_STEPS[generateStep]?.label}
              </p>
              <span className="flex items-center gap-1.5 text-sm text-gray-400 dark:text-gray-500 tabular-nums">
                <ClockIcon className="w-4 h-4" />
                {generateElapsed}s
              </span>
            </div>
            <div className="flex gap-2">
              {GENERATE_STEPS.map((step, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${
                    i <= generateStep ? 'bg-violet-500' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              This may take 15–30 seconds while the AI analyses your attendees.
            </p>
          </div>
        </Card>
      )}

      {/* Error state */}
      {generateError && !generating && (
        <Card>
          <div className="p-4 flex gap-3 items-start">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">Matching failed</p>
              <p className="text-sm text-red-600 dark:text-red-300 mt-1 font-mono break-all">{generateError}</p>
            </div>
            <button
              onClick={() => setGenerateError(null)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex-shrink-0"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        </Card>
      )}

      {/* Empty state */}
      {matches.length === 0 && !generating && (
        <Card>
          <div className="flex flex-col items-center py-16 text-center">
            <UserGroupIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No matches yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              Click "Generate matches" to have AI pair up your confirmed registrants.
            </p>
          </div>
        </Card>
      )}

      {/* Matches table */}
      {matches.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-left">
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-[38%]">Person A</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-[38%]">Person B</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-[10%]">Score</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((match) => (
                  <MatchRow
                    key={match.id}
                    match={match}
                    onPreview={() => setPreviewMatch(match)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Unmatched attendees */}
      {unmatched.length > 0 && (
        <Card>
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
            <ExclamationTriangleIcon className="w-4 h-4 text-amber-500" />
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Unmatched ({unmatched.length})
            </h4>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {unmatched.map((person) => (
              <div key={person.registration_id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{person.full_name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {[person.job_title, person.company].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500">No match found</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Email preview modal (per-row) */}
      {eventInfo && (
        <EmailPreviewModal
          match={previewMatch}
          eventInfo={eventInfo}
          emailSubject={emailSubject}
          emailContent={emailContent}
          onClose={() => setPreviewMatch(null)}
        />
      )}

      {/* Send confirmation modal */}
      <SendConfirmModal
        open={sendConfirmOpen}
        unsentCount={unsentCount}
        sending={sendingEmails}
        progress={sendProgress}
        onConfirm={doSendEmails}
        onClose={() => setSendConfirmOpen(false)}
      />

      {/* Test send modal */}
      <TestSendModal
        open={testSendOpen}
        eventId={eventId}
        onClose={() => setTestSendOpen(false)}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  color = 'text-gray-900 dark:text-white',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

function PersonCell({ person }: { person: AttendeeInfo | null }) {
  if (!person) return <span className="text-gray-400 text-xs">Unknown</span>;
  return (
    <div className="min-w-0">
      <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
        {person.full_name ?? person.email}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
        {[person.job_title, person.company].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}

function MatchRow({
  match,
  onPreview,
}: {
  match: Match;
  onPreview: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-4 py-3"><PersonCell person={match.person_a} /></td>
        <td className="px-4 py-3"><PersonCell person={match.person_b} /></td>
        <td className="px-4 py-3">
          {match.match_score != null ? (
            <span className="text-sm font-mono">{(match.match_score * 100).toFixed(0)}%</span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            {match.intro_email_sent_at && (
              <EnvelopeIcon className="w-3.5 h-3.5 text-blue-500" title="Introduction email sent" />
            )}
            <button
              onClick={onPreview}
              className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Preview email"
            >
              <EyeIcon className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
      {expanded && match.match_reason && (
        <tr className="bg-gray-50 dark:bg-gray-800/30">
          <td colSpan={4} className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 italic border-b border-gray-100 dark:border-gray-700">
            {match.match_reason}
          </td>
        </tr>
      )}
    </>
  );
}

function EmailPreviewModal({
  match,
  eventInfo,
  emailSubject,
  emailContent,
  onClose,
}: {
  match: Match | null;
  eventInfo: EventInfo;
  emailSubject: string;
  emailContent: string;
  onClose: () => void;
}) {
  if (!match) return null;

  const vars = buildPreviewVars(match, eventInfo);
  const subject = renderTemplateVars(emailSubject || DEFAULT_SUBJECT, vars);
  const html = renderTemplateVars(emailContent || DEFAULT_CONTENT, vars);
  const aFirstName = match.person_a?.full_name?.split(' ')[0] ?? '?';
  const bFirstName = match.person_b?.full_name?.split(' ')[0] ?? '?';

  return (
    <Modal
      isOpen={!!match}
      onClose={onClose}
      title={`Email preview: ${aFirstName} & ${bFirstName}`}
      size="lg"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 space-y-0.5">
            <div>To: {match.person_a?.email}, {match.person_b?.email}</div>
            <div>Subject: {subject}</div>
          </div>
          <div
            className="p-4 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

function SendConfirmModal({
  open,
  unsentCount,
  sending,
  progress,
  onConfirm,
  onClose,
}: {
  open: boolean;
  unsentCount: number;
  sending: boolean;
  progress: { sent: number; total: number; errors: string[] } | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const pct = progress ? Math.round((progress.sent / progress.total) * 100) : 0;
  return (
    <Modal isOpen={open} onClose={onClose} title="Send introduction emails" size="sm">
      <div className="space-y-4">
        {!sending ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            This will send introduction emails to{' '}
            <strong className="text-gray-900 dark:text-white">{unsentCount} pair{unsentCount !== 1 ? 's' : ''}</strong>{' '}
            ({unsentCount * 2} attendees). Once sent, this cannot be undone.
          </p>
        ) : progress ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Sent <strong className="text-gray-900 dark:text-white">{progress.sent}</strong> of{' '}
              <strong className="text-gray-900 dark:text-white">{progress.total}</strong> emails…
            </p>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            {progress.errors.length > 0 && (
              <p className="text-xs text-red-500">{progress.errors.length} error{progress.errors.length !== 1 ? 's' : ''} so far</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400">Starting send…</p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          {!sending && (
            <Button onClick={onConfirm} className="flex items-center gap-2">
              <EnvelopeIcon className="w-4 h-4" />
              Send {unsentCount} email{unsentCount !== 1 ? 's' : ''}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function TestSendModal({
  open,
  eventId,
  onClose,
}: {
  open: boolean;
  eventId: string;
  onClose: () => void;
}) {
  const [emailA, setEmailA] = useState('');
  const [emailB, setEmailB] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!emailA.trim() || !emailB.trim()) {
      toast.error('Please enter both email addresses');
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-match-emails', {
        body: {
          event_id: eventId,
          test_mode: { email_a: emailA.trim(), email_b: emailB.trim() },
        },
      });

      if (error) {
        let msg = error.message ?? 'Unknown error';
        try {
          const body = await (error as any).context?.json?.();
          if (body?.error) msg = body.error;
        } catch {}
        throw new Error(msg);
      }

      const result = data as { emails_sent: number; errors?: string[] };
      if (result.emails_sent > 0) {
        toast.success(`Test email sent to ${emailA} and ${emailB}`);
        onClose();
      } else {
        toast.error('No matches available to use as test sample');
      }
    } catch (err: any) {
      toast.error('Test send failed: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Test send" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Sends one sample intro email using the first pair's data, but addressed to these test emails instead of the actual attendees.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Test email for person A
            </label>
            <input
              type="email"
              value={emailA}
              onChange={(e) => setEmailA(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Test email for person B
            </label>
            <input
              type="email"
              value={emailB}
              onChange={(e) => setEmailB(e.target.value)}
              placeholder="colleague@example.com"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending || !emailA.trim() || !emailB.trim()} className="flex items-center gap-2">
            <BeakerIcon className="w-4 h-4" />
            {sending ? 'Sending…' : 'Send test email'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
