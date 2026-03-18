// @ts-nocheck
/**
 * Event Communications Tab Component
 * Manages email communications and push notifications for events
 */

import { useState, useEffect, useMemo, Fragment, useRef } from 'react';
import { toast } from 'sonner';
import {
  EnvelopeIcon,
  EnvelopeOpenIcon,
  BellIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  PaperAirplaneIcon,
  UsersIcon,
  EyeIcon,
  PencilIcon,
  MicrophoneIcon,
  XMarkIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ClockIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { Button, Card, Select, ConfirmModal } from '@/components/ui-legacy';
import { Modal } from '@/components/ui-legacy/Modal';
import { Input } from '@/components/ui-legacy/Form/Input';
import { RichTextEditor } from '@/components/ui-legacy/RichTextEditor';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { SendNotificationModal } from './SendNotificationModal';
import { SlackNotificationsTab } from './SlackNotificationsTab';
import { GoogleSheetsNotificationsTab } from './GoogleSheetsNotificationsTab';
import { supabase } from '@/lib/supabase';
import EmailService from '@/utils/emailService';
import EmailTemplateService, { EmailTemplate } from '@/utils/emailTemplateService';
import { useAuthContext } from '@/app/contexts/auth/context';
import {
  replaceVariables,
  findAllVariables,
  type TemplateContext,
} from '@/utils/templateVariables';

interface EventCommunicationsTabProps {
  eventId: string;
  eventUuid: string;
  eventTitle: string;
}

interface EmailBatchJob {
  id: string;
  event_id: string;
  email_type: string;
  subject_template: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  total_recipients: number;
  processed_count: number;
  success_count: number;
  fail_count: number;
  errors: any[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface CommunicationSettings {
  id?: string;
  event_id: string;
  // Registration email settings
  registration_email_enabled: boolean;
  registration_email_template_id: string | null;
  registration_email_from_key: string;
  registration_email_reply_to: string | null;
  registration_email_cc: string | null;
  registration_email_subject: string | null;
  registration_email_content: string | null;
  // Reminder email settings
  reminder_email_enabled: boolean;
  reminder_email_template_id: string | null;
  reminder_email_from_key: string;
  reminder_email_reply_to: string | null;
  reminder_email_cc: string | null;
  reminder_email_subject: string | null;
  reminder_email_content: string | null;
  reminder_email_sent_at: string | null;
  // Speaker submitted email settings
  speaker_submitted_email_enabled: boolean;
  speaker_submitted_email_template_id: string | null;
  speaker_submitted_email_from_key: string;
  speaker_submitted_email_reply_to: string | null;
  speaker_submitted_email_cc: string | null;
  speaker_submitted_email_subject: string | null;
  speaker_submitted_email_content: string | null;
  // Speaker approved email settings
  speaker_approved_email_enabled: boolean;
  speaker_approved_email_template_id: string | null;
  speaker_approved_email_from_key: string;
  speaker_approved_email_reply_to: string | null;
  speaker_approved_email_cc: string | null;
  speaker_approved_email_subject: string | null;
  speaker_approved_email_content: string | null;
  // Speaker rejected email settings
  speaker_rejected_email_enabled: boolean;
  speaker_rejected_email_template_id: string | null;
  speaker_rejected_email_from_key: string;
  speaker_rejected_email_reply_to: string | null;
  speaker_rejected_email_cc: string | null;
  speaker_rejected_email_subject: string | null;
  speaker_rejected_email_content: string | null;
  // Speaker reserve email settings
  speaker_reserve_email_enabled: boolean;
  speaker_reserve_email_template_id: string | null;
  speaker_reserve_email_from_key: string;
  speaker_reserve_email_reply_to: string | null;
  speaker_reserve_email_cc: string | null;
  speaker_reserve_email_subject: string | null;
  speaker_reserve_email_content: string | null;
  // Speaker confirmed email settings
  speaker_confirmed_email_enabled: boolean;
  speaker_confirmed_email_template_id: string | null;
  speaker_confirmed_email_from_key: string;
  speaker_confirmed_email_reply_to: string | null;
  speaker_confirmed_email_cc: string | null;
  speaker_confirmed_email_subject: string | null;
  speaker_confirmed_email_content: string | null;
  // Post-event attendee email settings
  post_event_attendee_email_enabled: boolean;
  post_event_attendee_email_template_id: string | null;
  post_event_attendee_email_from_key: string;
  post_event_attendee_email_reply_to: string | null;
  post_event_attendee_email_cc: string | null;
  post_event_attendee_email_subject: string | null;
  post_event_attendee_email_content: string | null;
  // Post-event non-attendee email settings
  post_event_non_attendee_email_enabled: boolean;
  post_event_non_attendee_email_template_id: string | null;
  post_event_non_attendee_email_from_key: string;
  post_event_non_attendee_email_reply_to: string | null;
  post_event_non_attendee_email_cc: string | null;
  post_event_non_attendee_email_subject: string | null;
  post_event_non_attendee_email_content: string | null;
  // Competition entry email settings (auto-responder)
  competition_entry_email_enabled: boolean;
  competition_entry_email_template_id: string | null;
  competition_entry_email_from_key: string;
  competition_entry_email_reply_to: string | null;
  competition_entry_email_cc: string | null;
  competition_entry_email_subject: string | null;
  competition_entry_email_content: string | null;
  // Competition non-winner email settings (manual batch)
  competition_non_winner_email_enabled: boolean;
  competition_non_winner_email_template_id: string | null;
  competition_non_winner_email_from_key: string;
  competition_non_winner_email_reply_to: string | null;
  competition_non_winner_email_cc: string | null;
  competition_non_winner_email_subject: string | null;
  competition_non_winner_email_content: string | null;
  // Competition winner email settings (manual per-winner send)
  competition_winner_email_template_id: string | null;
  competition_winner_email_from_key: string;
  competition_winner_email_reply_to: string | null;
  competition_winner_email_subject: string | null;
  competition_winner_email_content: string | null;
  // Competition winner follow-up email (for notified re-send)
  competition_winner_followup_email_template_id: string | null;
  competition_winner_followup_email_content: string | null;
  // Competition winner accepted colleague email
  competition_winner_accepted_email_template_id: string | null;
  competition_winner_accepted_email_subject: string | null;
  competition_winner_accepted_email_content: string | null;
  // Registrant email settings (ad-hoc email to selected/all registrants)
  registrant_email_enabled: boolean;
  registrant_email_template_id: string | null;
  registrant_email_from_key: string;
  registrant_email_reply_to: string | null;
  registrant_email_cc: string | null;
  registrant_email_subject: string | null;
  registrant_email_content: string | null;
}

interface EventDetails {
  event_title: string;
  event_city?: string;
  event_country_code?: string;
  event_start?: string;
  event_end?: string;
  event_location?: string;
  event_link?: string;
}

type SubTab = 'email' | 'push' | 'slack' | 'sheets';

// Slack icon component (Heroicons doesn't have one)
function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    </svg>
  );
}

// Speaker Email Config component for individual speaker email automations
interface SpeakerEmailConfigProps {
  title: string;
  description: string;
  speakerStatus: 'pending' | 'approved' | 'rejected' | 'reserve' | 'confirmed';
  enabled: boolean;
  templateId: string | null;
  fromKey: string;
  replyTo: string | null;
  cc: string | null;
  emailSubject: string;
  emailContent: string;
  onEnabledChange: (enabled: boolean) => void;
  onTemplateIdChange: (templateId: string | null) => void;
  onFromKeyChange: (fromKey: string) => void;
  onReplyToChange: (replyTo: string | null) => void;
  onCcChange: (cc: string | null) => void;
  onEmailSubjectChange: (subject: string) => void;
  onEmailContentChange: (content: string) => void;
  userId: string;
  eventId: string;
  eventUuid: string;
  eventDetails: EventDetails | null;
  fromAddresses: ReturnType<typeof EmailService.getFromAddresses>;
  fromOptions: { label: string; value: string }[];
}

function SpeakerEmailConfig({
  title,
  description,
  speakerStatus,
  enabled,
  templateId,
  fromKey,
  replyTo,
  cc,
  emailSubject,
  emailContent,
  onEnabledChange,
  onTemplateIdChange,
  onFromKeyChange,
  onReplyToChange,
  onCcChange,
  onEmailSubjectChange,
  onEmailContentChange,
  userId,
  eventId,
  eventUuid,
  eventDetails,
  fromAddresses,
  fromOptions,
}: SpeakerEmailConfigProps) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showTestSendModal, setShowTestSendModal] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sendingToExisting, setSendingToExisting] = useState(false);
  const [speakerCount, setSpeakerCount] = useState(0);
  const [loadingCount, setLoadingCount] = useState(false);
  const [includeDirectlyAdded, setIncludeDirectlyAdded] = useState(false);
  const [activeSpeakerJob, setActiveSpeakerJob] = useState<EmailBatchJob | null>(null);
  const speakerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (enabled && userId) {
      loadTemplates();
      loadSpeakerCount();
    }
  }, [enabled, fromKey, userId, eventUuid, speakerStatus, includeDirectlyAdded]);

  // Check for active batch jobs on mount
  useEffect(() => {
    const emailType = `speaker_${speakerStatus}`;
    const checkActiveSpeakerJob = async () => {
      const { data } = await supabase
        .from('email_batch_jobs')
        .select('*')
        .eq('event_id', eventId)
        .eq('email_type', emailType)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setActiveSpeakerJob(data);
        setSendingToExisting(true);
        startSpeakerJobPolling(data.id);
      }
    };
    checkActiveSpeakerJob();
    return () => {
      if (speakerPollRef.current) clearInterval(speakerPollRef.current);
    };
  }, [eventId, speakerStatus]);

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const data = await EmailTemplateService.getTemplatesForAdmin(userId, fromKey);
      const filteredTemplates = data.filter(t => t.template_type === 'member_email');
      setTemplates(filteredTemplates);
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const loadSpeakerCount = async () => {
    setLoadingCount(true);
    try {
      let query = supabase
        .from('event_speakers')
        .select('*', { count: 'exact', head: true })
        .eq('event_uuid', eventUuid)
        .eq('status', speakerStatus);

      // Filter out directly added speakers (those without submitted_at) if checkbox is not checked
      if (!includeDirectlyAdded) {
        query = query.not('submitted_at', 'is', null);
      }

      const { count, error } = await query;

      if (error) throw error;
      setSpeakerCount(count || 0);
    } catch (error) {
      console.error('Error loading speaker count:', error);
    } finally {
      setLoadingCount(false);
    }
  };

  const handleTemplateSelect = async (selectedTemplateId: string) => {
    onTemplateIdChange(selectedTemplateId || null);
    if (selectedTemplateId) {
      const template = templates.find(t => t.id === selectedTemplateId);
      if (template) {
        onEmailSubjectChange(template.subject);
        onEmailContentChange(template.content_html);
      }
    } else {
      onEmailSubjectChange('');
      onEmailContentChange('');
    }
  };

  // Build preview context for speaker emails
  const buildSpeakerPreviewContext = (
    email: string = 'speaker@example.com',
    firstName: string = 'Jane',
    lastName: string = 'Smith'
  ): TemplateContext => {
    // Build example confirmation link for preview/test
    const baseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://api.gatewaze.com';
    const exampleConfirmationLink = `${baseUrl}/functions/v1/speaker-confirm?token=example-token-123`;
    // Build example edit link for speaker portal (relative path)
    // Points to the success/dashboard page where confirmed speakers see their checklist
    const exampleEditLink = `/events/${eventId}/talks/success/example-edit-token-123`;

    return {
      customer: {
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`.trim(),
        email: email,
      },
      speaker: {
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`.trim(),
        email: email,
        talk_title: 'Building AI-Powered Applications',
        talk_synopsis: 'In this talk, we will explore how to build production-ready AI applications...',
        company: 'Tech Corp',
        job_title: 'Senior Engineer',
        confirmation_link: exampleConfirmationLink,
        edit_link: exampleEditLink,
      },
      event: {
        name: eventDetails?.event_title || '',
        city: eventDetails?.event_city || '',
        country: eventDetails?.event_country_code || '',
        start_date: eventDetails?.event_start ? new Date(eventDetails.event_start).toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) : '',
        end_date: eventDetails?.event_end ? new Date(eventDetails.event_end).toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) : '',
      },
    };
  };

  const previewContext = useMemo(() => buildSpeakerPreviewContext(), [eventDetails]);
  const previewSubject = useMemo(() => replaceVariables(emailSubject, previewContext), [emailSubject, previewContext]);
  const previewContent = useMemo(() => replaceVariables(emailContent, previewContext), [emailContent, previewContext]);

  const hasTemplateVariables = useMemo(() => {
    const subjectVars = findAllVariables(emailSubject);
    const contentVars = findAllVariables(emailContent);
    return subjectVars.length > 0 || contentVars.length > 0;
  }, [emailSubject, emailContent]);

  const handleTestSend = async () => {
    if (!testEmailAddress.trim()) {
      toast.error('Please enter an email address');
      return;
    }
    if (!emailSubject.trim() || !emailContent.trim()) {
      toast.error('Please configure the email subject and content first');
      return;
    }

    setSendingTest(true);
    try {
      const context = buildSpeakerPreviewContext(testEmailAddress, 'Test', 'Speaker');
      const processedSubject = replaceVariables(emailSubject, context);
      const processedHtml = replaceVariables(emailContent, context);
      const fromAddress = fromAddresses[fromKey as keyof typeof fromAddresses] || fromAddresses.events;

      const result = await EmailService.sendEmail({
        to: [testEmailAddress],
        cc: cc || undefined,
        from: fromAddress || '',
        subject: `[TEST] ${processedSubject}`,
        html: processedHtml,
        replyTo: replyTo || undefined,
      });

      if (result.success) {
        toast.success(`Test email sent to ${testEmailAddress}`);
        setShowTestSendModal(false);
        setTestEmailAddress('');
      } else {
        toast.error(result.error || 'Failed to send test email');
      }
    } catch (error) {
      console.error('Error sending test email:', error);
      toast.error('Failed to send test email');
    } finally {
      setSendingTest(false);
    }
  };

  const handleSendToExisting = async () => {
    if (!emailSubject.trim() || !emailContent.trim()) {
      toast.error('Please configure the email subject and content first');
      return;
    }

    setSendingToExisting(true);
    setShowSendConfirm(false);

    try {
      const fromAddress = fromAddresses[fromKey as keyof typeof fromAddresses] || fromAddresses.events;
      const emailType = `speaker_${speakerStatus}`;

      // Create batch job
      const { data: job, error: jobError } = await supabase
        .from('email_batch_jobs')
        .insert({
          event_id: eventId,
          email_type: emailType,
          subject_template: emailSubject,
          content_template: emailContent,
          from_address: fromAddress || '',
          reply_to: replyTo || null,
          cc: cc || null,
          config: {
            speaker_status: speakerStatus,
            include_directly_added: includeDirectlyAdded,
            event_uuid: eventUuid,
          },
          created_by: userId || null,
        })
        .select('*')
        .single();

      if (jobError || !job) throw jobError || new Error('Failed to create job');

      setActiveSpeakerJob(job);

      // Invoke edge function
      await supabase.functions.invoke('batch-send-email', {
        body: { jobId: job.id },
      });

      startSpeakerJobPolling(job.id);
      toast.success('Email send started in the background');
    } catch (error) {
      console.error('Error starting batch send:', error);
      toast.error('Failed to start email send');
      setSendingToExisting(false);
    }
  };

  const startSpeakerJobPolling = (jobId: string) => {
    if (speakerPollRef.current) clearInterval(speakerPollRef.current);
    speakerPollRef.current = setInterval(async () => {
      const { data: job } = await supabase
        .from('email_batch_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (!job) return;
      setActiveSpeakerJob(job);

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        if (speakerPollRef.current) clearInterval(speakerPollRef.current);
        setSendingToExisting(false);

        if (job.status === 'completed') {
          if (job.fail_count === 0) {
            toast.success(`Email sent to ${job.success_count} ${speakerStatus} speaker${job.success_count !== 1 ? 's' : ''}`);
          } else {
            toast.warning(`Sent to ${job.success_count}, failed for ${job.fail_count} speakers`);
          }
        } else if (job.status === 'cancelled') {
          toast.info(`Send cancelled. ${job.success_count} sent, ${job.total_recipients - job.processed_count} remaining.`);
        } else {
          toast.error('Email send failed');
        }

        if (job.success_count > 0 && templateId) {
          EmailTemplateService.incrementUsage(templateId).catch(console.error);
        }
      }
    }, 2000);
  };

  const handleCancelSpeakerJob = async () => {
    if (!activeSpeakerJob) return;
    await supabase
      .from('email_batch_jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', activeSpeakerJob.id);
  };

  const statusLabel = speakerStatus === 'pending' ? 'Pending' : speakerStatus === 'approved' ? 'Approved' : speakerStatus === 'confirmed' ? 'Confirmed' : speakerStatus === 'reserve' ? 'Reserve' : 'Rejected';

  return (
    <div className={`border rounded-lg p-5 transition-colors ${
      enabled
        ? 'border-primary-500 dark:border-primary-400'
        : 'border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h4 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h4>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
        </label>
      </div>

      {enabled && (
        <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          {/* From Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              From Address
            </label>
            <Select
              value={fromKey}
              onChange={(e) => onFromKeyChange(e.target.value)}
              data={fromOptions}
            />
          </div>

          {/* Email Template */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Load Template
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
                No templates available. Create a member email template in Admin &gt; Emails.
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
              onChange={(e) => onEmailSubjectChange(e.target.value)}
              placeholder="Enter email subject (use {{speaker.first_name}}, {{event.name}}, etc.)"
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
                  onClick={() => setShowTestSendModal(true)}
                  disabled={!emailSubject.trim() || !emailContent.trim()}
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <PaperAirplaneIcon className="h-4 w-4" />
                  Send Test
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

            {!showPreview && hasTemplateVariables && (
              <div className="mb-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  This message contains template variables. Each speaker will receive a personalized version.
                  Use the "Variables" button in the toolbar to insert dynamic content.
                </p>
              </div>
            )}

            {showPreview ? (
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Preview for: Jane Smith (speaker@example.com)
                  </p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                    Subject: {previewSubject || '(No subject)'}
                  </p>
                </div>
                <div
                  className="p-4 prose prose-sm dark:prose-invert max-w-none overflow-y-auto bg-white dark:bg-gray-900"
                  style={{ minHeight: '250px', maxHeight: '400px' }}
                  dangerouslySetInnerHTML={{ __html: previewContent || '<p class="text-gray-400">(No content)</p>' }}
                />
              </div>
            ) : (
              <div style={{ minHeight: '250px' }}>
                <RichTextEditor
                  content={emailContent}
                  onChange={onEmailContentChange}
                  placeholder="Enter your message here... Use the Variables button in the toolbar to insert dynamic content like {{speaker.first_name}}, {{event.name}}, etc."
                  templateVariables={{
                    enabled: true,
                    availableScopes: ['speaker', 'event'],
                  }}
                />
              </div>
            )}
          </div>

          {/* Reply-To Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Reply-To Address (optional)
            </label>
            <input
              type="email"
              value={replyTo || ''}
              onChange={(e) => onReplyToChange(e.target.value || null)}
              placeholder="replies@example.com"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Where replies should be sent (if different from the From address)
            </p>
          </div>

          {/* CC Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              CC Address (optional)
            </label>
            <input
              type="email"
              value={cc || ''}
              onChange={(e) => onCcChange(e.target.value || null)}
              placeholder="team@example.com"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Send a copy of every email to this address
            </p>
          </div>

          {/* Send to Existing Speakers */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-2 mb-2">
              <UsersIcon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              <h5 className="text-sm font-medium text-gray-900 dark:text-white">
                Send to Existing {statusLabel} Speakers
              </h5>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Send this email to all {loadingCount ? '...' : speakerCount} speakers who are currently {speakerStatus}.
            </p>

            {/* Include directly added checkbox */}
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeDirectlyAdded}
                onChange={(e) => setIncludeDirectlyAdded(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:focus:ring-blue-600"
              />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                Include speakers added directly via admin (not through application form)
              </span>
            </label>

            {activeSpeakerJob && (activeSpeakerJob.status === 'pending' || activeSpeakerJob.status === 'processing') ? (
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                    <span>Sending {activeSpeakerJob.processed_count}/{activeSpeakerJob.total_recipients}...</span>
                    <span>{activeSpeakerJob.total_recipients > 0 ? Math.round((activeSpeakerJob.processed_count / activeSpeakerJob.total_recipients) * 100) : 0}%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                    <div
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                      style={{ width: `${activeSpeakerJob.total_recipients > 0 ? (activeSpeakerJob.processed_count / activeSpeakerJob.total_recipients) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-green-600 dark:text-green-400">{activeSpeakerJob.success_count} sent</span>
                    {activeSpeakerJob.fail_count > 0 && (
                      <span className="text-red-600 dark:text-red-400">{activeSpeakerJob.fail_count} failed</span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelSpeakerJob}
                    className="flex items-center gap-1 text-red-600 hover:text-red-700 border-red-300 hover:border-red-400"
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSendConfirm(true)}
                  disabled={sendingToExisting || !emailSubject.trim() || !emailContent.trim() || speakerCount === 0}
                  className="flex items-center gap-2"
                >
                  <PaperAirplaneIcon className="h-4 w-4" />
                  Send to {speakerCount} {statusLabel} Speaker{speakerCount !== 1 ? 's' : ''}
                </Button>
                {(!emailSubject.trim() || !emailContent.trim()) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                    Configure the email subject and content above to enable this feature.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Confirm Send Modal */}
      <ConfirmModal
        isOpen={showSendConfirm}
        onClose={() => setShowSendConfirm(false)}
        onConfirm={handleSendToExisting}
        title={`Send to ${statusLabel} Speakers`}
        message={`Are you sure you want to send this email to all ${speakerCount} ${speakerStatus} speakers? This action cannot be undone.`}
        confirmText="Send Emails"
        confirmVariant="primary"
      />

      {/* Test Send Modal */}
      <Modal
        isOpen={showTestSendModal}
        onClose={() => {
          setShowTestSendModal(false);
          setTestEmailAddress('');
        }}
        title="Send Test Email"
        size="md"
        footer={
          <div className="flex justify-end gap-3 px-6 py-4">
            <button
              onClick={() => {
                setShowTestSendModal(false);
                setTestEmailAddress('');
              }}
              disabled={sendingTest}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleTestSend}
              disabled={sendingTest || !testEmailAddress.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {sendingTest ? (
                <>
                  <LoadingSpinner size="xs" />
                  Sending...
                </>
              ) : (
                <>
                  <PaperAirplaneIcon className="h-4 w-4" />
                  Send Test
                </>
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Send a test email to verify how the speaker email will look.
            Template variables will be replaced with sample values.
          </p>
          <Input
            label="Email Address"
            type="email"
            value={testEmailAddress}
            onChange={(e) => setTestEmailAddress(e.target.value)}
            placeholder="your@email.com"
            disabled={sendingTest}
            description="The test email will be sent to this address with [TEST] prefix in the subject"
          />
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Preview:</p>
            <p className="text-sm text-gray-900 dark:text-white">
              <strong>Subject:</strong> [TEST] {previewSubject || '(No subject)'}
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// --- Post-Event Email Config Component ---

interface PostEventEmailConfigProps {
  title: string;
  description: string;
  emailType: 'post_event_attendee' | 'post_event_non_attendee' | 'competition_non_winner';
  recipientLabel: string;
  enabled: boolean;
  templateId: string | null;
  fromKey: string;
  replyTo: string | null;
  cc: string | null;
  emailSubject: string;
  emailContent: string;
  onEnabledChange: (enabled: boolean) => void;
  onTemplateIdChange: (templateId: string | null) => void;
  onFromKeyChange: (fromKey: string) => void;
  onReplyToChange: (replyTo: string | null) => void;
  onCcChange: (cc: string | null) => void;
  onEmailSubjectChange: (subject: string) => void;
  onEmailContentChange: (content: string) => void;
  userId: string;
  eventId: string;
  eventDetails: EventDetails | null;
  fromAddresses: ReturnType<typeof EmailService.getFromAddresses>;
  fromOptions: { label: string; value: string }[];
}

function PostEventEmailConfig({
  title,
  description,
  emailType,
  recipientLabel,
  enabled,
  templateId,
  fromKey,
  replyTo,
  cc,
  emailSubject,
  emailContent,
  onEnabledChange,
  onTemplateIdChange,
  onFromKeyChange,
  onReplyToChange,
  onCcChange,
  onEmailSubjectChange,
  onEmailContentChange,
  userId,
  eventId,
  eventDetails,
  fromAddresses,
  fromOptions,
}: PostEventEmailConfigProps) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showTestSendModal, setShowTestSendModal] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sendingToExisting, setSendingToExisting] = useState(false);
  const [recipientCount, setRecipientCount] = useState(0);
  const [loadingCount, setLoadingCount] = useState(false);
  const [activeJob, setActiveJob] = useState<EmailBatchJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (enabled && userId) {
      loadTemplates();
      loadRecipientCount();
    }
  }, [enabled, fromKey, userId, eventId]);

  useEffect(() => {
    const checkActiveJob = async () => {
      const { data } = await supabase
        .from('email_batch_jobs')
        .select('*')
        .eq('event_id', eventId)
        .eq('email_type', emailType)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setActiveJob(data);
        setSendingToExisting(true);
        startJobPolling(data.id);
      }
    };
    checkActiveJob();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [eventId, emailType]);

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const data = await EmailTemplateService.getTemplatesForAdmin(userId, fromKey);
      const filteredTemplates = data.filter(t => t.template_type === 'member_email');
      setTemplates(filteredTemplates);
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const loadRecipientCount = async () => {
    setLoadingCount(true);
    try {
      if (emailType === 'post_event_attendee') {
        const { count, error } = await supabase
          .from('event_attendance')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', eventId);
        if (error) throw error;
        setRecipientCount(count || 0);
      } else if (emailType === 'competition_non_winner') {
        const { data, error } = await supabase
          .rpc('count_competition_non_winner_recipients', { p_event_id: eventId });
        if (error) throw error;
        setRecipientCount(data || 0);
      } else {
        const { data, error } = await supabase
          .rpc('count_non_attendee_recipients', { p_event_id: eventId });
        if (error) throw error;
        setRecipientCount(data || 0);
      }
    } catch (error) {
      console.error('Error loading recipient count:', error);
    } finally {
      setLoadingCount(false);
    }
  };

  const handleTemplateSelect = async (selectedTemplateId: string) => {
    onTemplateIdChange(selectedTemplateId || null);
    if (selectedTemplateId) {
      const template = templates.find(t => t.id === selectedTemplateId);
      if (template) {
        onEmailSubjectChange(template.subject);
        onEmailContentChange(template.content_html);
      }
    } else {
      onEmailSubjectChange('');
      onEmailContentChange('');
    }
  };

  const buildPreviewContext = (
    email: string = 'attendee@example.com',
    firstName: string = 'Jane',
    lastName: string = 'Smith'
  ): TemplateContext => ({
    customer: {
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`.trim(),
      email: email,
    },
    event: {
      name: eventDetails?.event_title || '',
      city: eventDetails?.event_city || '',
      country: eventDetails?.event_country_code || '',
      start_date: eventDetails?.event_start ? new Date(eventDetails.event_start).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      }) : '',
      end_date: eventDetails?.event_end ? new Date(eventDetails.event_end).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      }) : '',
      link: eventDetails?.event_link || '',
      location: eventDetails?.event_location || '',
    },
  });

  const previewContext = useMemo(() => buildPreviewContext(), [eventDetails]);
  const previewSubject = useMemo(() => replaceVariables(emailSubject, previewContext), [emailSubject, previewContext]);
  const previewContent = useMemo(() => replaceVariables(emailContent, previewContext), [emailContent, previewContext]);

  const hasTemplateVariables = useMemo(() => {
    const subjectVars = findAllVariables(emailSubject);
    const contentVars = findAllVariables(emailContent);
    return subjectVars.length > 0 || contentVars.length > 0;
  }, [emailSubject, emailContent]);

  const handleTestSend = async () => {
    if (!testEmailAddress.trim()) {
      toast.error('Please enter an email address');
      return;
    }
    if (!emailSubject.trim() || !emailContent.trim()) {
      toast.error('Please configure the email subject and content first');
      return;
    }

    setSendingTest(true);
    try {
      const context = buildPreviewContext(testEmailAddress, 'Test', 'User');
      const processedSubject = replaceVariables(emailSubject, context);
      const processedHtml = replaceVariables(emailContent, context);
      const fromAddress = fromAddresses[fromKey as keyof typeof fromAddresses] || fromAddresses.events;

      const result = await EmailService.sendEmail({
        to: [testEmailAddress],
        cc: cc || undefined,
        from: fromAddress || '',
        subject: `[TEST] ${processedSubject}`,
        html: processedHtml,
        replyTo: replyTo || undefined,
      });

      if (result.success) {
        toast.success(`Test email sent to ${testEmailAddress}`);
        setShowTestSendModal(false);
        setTestEmailAddress('');
      } else {
        toast.error(result.error || 'Failed to send test email');
      }
    } catch (error) {
      console.error('Error sending test email:', error);
      toast.error('Failed to send test email');
    } finally {
      setSendingTest(false);
    }
  };

  const handleSendToExisting = async () => {
    if (!emailSubject.trim() || !emailContent.trim()) {
      toast.error('Please configure the email subject and content first');
      return;
    }

    setSendingToExisting(true);
    setShowSendConfirm(false);

    try {
      const fromAddress = fromAddresses[fromKey as keyof typeof fromAddresses] || fromAddresses.events;

      const { data: job, error: jobError } = await supabase
        .from('email_batch_jobs')
        .insert({
          event_id: eventId,
          email_type: emailType,
          subject_template: emailSubject,
          content_template: emailContent,
          from_address: fromAddress || '',
          reply_to: replyTo || null,
          cc: cc || null,
          config: {},
          created_by: userId || null,
        })
        .select('*')
        .single();

      if (jobError || !job) throw jobError || new Error('Failed to create job');

      setActiveJob(job);

      await supabase.functions.invoke('batch-send-email', {
        body: { jobId: job.id },
      });

      startJobPolling(job.id);
      toast.success('Email send started in the background');
    } catch (error) {
      console.error('Error starting batch send:', error);
      toast.error('Failed to start email send');
      setSendingToExisting(false);
    }
  };

  const startJobPolling = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const { data: job } = await supabase
        .from('email_batch_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (!job) return;
      setActiveJob(job);

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        if (pollRef.current) clearInterval(pollRef.current);
        setSendingToExisting(false);

        if (job.status === 'completed') {
          if (job.fail_count === 0) {
            toast.success(`Email sent to ${job.success_count} ${recipientLabel.toLowerCase()}${job.success_count !== 1 ? 's' : ''}`);
          } else {
            toast.warning(`Sent to ${job.success_count}, failed for ${job.fail_count}`);
          }
        } else if (job.status === 'cancelled') {
          toast.info(`Send cancelled. ${job.success_count} sent, ${job.total_recipients - job.processed_count} remaining.`);
        } else {
          toast.error('Email send failed');
        }

        if (job.success_count > 0 && templateId) {
          EmailTemplateService.incrementUsage(templateId).catch(console.error);
        }
      }
    }, 2000);
  };

  const handleCancelJob = async () => {
    if (!activeJob) return;
    await supabase
      .from('email_batch_jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', activeJob.id);
  };

  return (
    <div className={`border rounded-lg p-5 transition-colors ${
      enabled
        ? 'border-primary-500 dark:border-primary-400'
        : 'border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h4 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h4>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
        </label>
      </div>

      {enabled && (
        <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          {/* From Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              From Address
            </label>
            <Select
              value={fromKey}
              onChange={(e) => onFromKeyChange(e.target.value)}
              data={fromOptions}
            />
          </div>

          {/* Email Template */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Load Template
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
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Subject
            </label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => onEmailSubjectChange(e.target.value)}
              placeholder="Enter email subject (use {{customer.first_name}}, {{event.name}}, etc.)"
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
                  onClick={() => setShowTestSendModal(true)}
                  disabled={!emailSubject.trim() || !emailContent.trim()}
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <PaperAirplaneIcon className="h-4 w-4" />
                  Send Test
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

            {!showPreview && hasTemplateVariables && (
              <div className="mb-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  This message contains template variables. Each recipient will receive a personalized version.
                  Use the "Variables" button in the toolbar to insert dynamic content.
                </p>
              </div>
            )}

            {showPreview ? (
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Preview for: Jane Smith (attendee@example.com)
                  </p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                    Subject: {previewSubject || '(No subject)'}
                  </p>
                </div>
                <div
                  className="p-4 prose prose-sm dark:prose-invert max-w-none overflow-y-auto bg-white dark:bg-gray-900"
                  style={{ minHeight: '250px', maxHeight: '400px' }}
                  dangerouslySetInnerHTML={{ __html: previewContent || '<p class="text-gray-400">(No content)</p>' }}
                />
              </div>
            ) : (
              <div style={{ minHeight: '250px' }}>
                <RichTextEditor
                  content={emailContent}
                  onChange={onEmailContentChange}
                  placeholder="Enter your message here... Use the Variables button in the toolbar to insert dynamic content like {{customer.first_name}}, {{event.name}}, etc."
                  templateVariables={{
                    enabled: true,
                    availableScopes: ['customer', 'event'],
                  }}
                />
              </div>
            )}
          </div>

          {/* Reply-To Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Reply-To Address (optional)
            </label>
            <input
              type="email"
              value={replyTo || ''}
              onChange={(e) => onReplyToChange(e.target.value || null)}
              placeholder="replies@example.com"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>

          {/* CC Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              CC Address (optional)
            </label>
            <input
              type="email"
              value={cc || ''}
              onChange={(e) => onCcChange(e.target.value || null)}
              placeholder="team@example.com"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>

          {/* Send to Recipients */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-2 mb-2">
              <UsersIcon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              <h5 className="text-sm font-medium text-gray-900 dark:text-white">
                Send to {recipientLabel}
              </h5>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Send this email to all {loadingCount ? '...' : recipientCount} {recipientLabel.toLowerCase()}.
            </p>

            {activeJob && (activeJob.status === 'pending' || activeJob.status === 'processing') ? (
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                    <span>Sending {activeJob.processed_count}/{activeJob.total_recipients}...</span>
                    <span>{activeJob.total_recipients > 0 ? Math.round((activeJob.processed_count / activeJob.total_recipients) * 100) : 0}%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                    <div
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                      style={{ width: `${activeJob.total_recipients > 0 ? (activeJob.processed_count / activeJob.total_recipients) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-green-600 dark:text-green-400">{activeJob.success_count} sent</span>
                    {activeJob.fail_count > 0 && (
                      <span className="text-red-600 dark:text-red-400">{activeJob.fail_count} failed</span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelJob}
                    className="flex items-center gap-1 text-red-600 hover:text-red-700 border-red-300 hover:border-red-400"
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSendConfirm(true)}
                  disabled={sendingToExisting || !emailSubject.trim() || !emailContent.trim() || recipientCount === 0}
                  className="flex items-center gap-2"
                >
                  <PaperAirplaneIcon className="h-4 w-4" />
                  Send to {recipientCount} {recipientLabel}
                </Button>
                {(!emailSubject.trim() || !emailContent.trim()) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                    Configure the email subject and content above to enable this feature.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Confirm Send Modal */}
      <ConfirmModal
        isOpen={showSendConfirm}
        onClose={() => setShowSendConfirm(false)}
        onConfirm={handleSendToExisting}
        title={`Send to ${recipientLabel}`}
        message={`Are you sure you want to send this email to all ${recipientCount} ${recipientLabel.toLowerCase()}? This action cannot be undone.`}
        confirmText="Send Emails"
        confirmVariant="primary"
      />

      {/* Test Send Modal */}
      <Modal
        isOpen={showTestSendModal}
        onClose={() => {
          setShowTestSendModal(false);
          setTestEmailAddress('');
        }}
        title="Send Test Email"
        size="md"
        footer={
          <div className="flex justify-end gap-3 px-6 py-4">
            <button
              onClick={() => {
                setShowTestSendModal(false);
                setTestEmailAddress('');
              }}
              disabled={sendingTest}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleTestSend}
              disabled={sendingTest || !testEmailAddress.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {sendingTest ? (
                <>
                  <LoadingSpinner size="xs" />
                  Sending...
                </>
              ) : (
                <>
                  <PaperAirplaneIcon className="h-4 w-4" />
                  Send Test
                </>
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Send a test email to verify how the post-event email will look.
            Template variables will be replaced with sample values.
          </p>
          <Input
            label="Email Address"
            type="email"
            value={testEmailAddress}
            onChange={(e) => setTestEmailAddress(e.target.value)}
            placeholder="your@email.com"
            disabled={sendingTest}
            description="The test email will be sent to this address with [TEST] prefix in the subject"
          />
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Preview:</p>
            <p className="text-sm text-gray-900 dark:text-white">
              <strong>Subject:</strong> [TEST] {previewSubject || '(No subject)'}
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// --- Registrant Email Config Component ---

interface RegistrantInfo {
  registration_id: string;
  full_name: string;
  email: string;
  company: string;
  job_title: string;
}

interface RegistrantEmailConfigProps {
  enabled: boolean;
  templateId: string | null;
  fromKey: string;
  replyTo: string | null;
  cc: string | null;
  emailSubject: string;
  emailContent: string;
  onEnabledChange: (enabled: boolean) => void;
  onTemplateIdChange: (templateId: string | null) => void;
  onFromKeyChange: (fromKey: string) => void;
  onReplyToChange: (replyTo: string | null) => void;
  onCcChange: (cc: string | null) => void;
  onEmailSubjectChange: (subject: string) => void;
  onEmailContentChange: (content: string) => void;
  userId: string;
  eventId: string;
  eventDetails: EventDetails | null;
  fromAddresses: ReturnType<typeof EmailService.getFromAddresses>;
  fromOptions: { label: string; value: string }[];
}

function RegistrantEmailConfig({
  enabled,
  templateId,
  fromKey,
  replyTo,
  cc,
  emailSubject,
  emailContent,
  onEnabledChange,
  onTemplateIdChange,
  onFromKeyChange,
  onReplyToChange,
  onCcChange,
  onEmailSubjectChange,
  onEmailContentChange,
  userId,
  eventId,
  eventDetails,
  fromAddresses,
  fromOptions,
}: RegistrantEmailConfigProps) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showTestSendModal, setShowTestSendModal] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sendingToExisting, setSendingToExisting] = useState(false);
  const [activeJob, setActiveJob] = useState<EmailBatchJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Registrant selection state
  const [selectionMode, setSelectionMode] = useState<'all' | 'specific'>('all');
  const [registrants, setRegistrants] = useState<RegistrantInfo[]>([]);
  const [loadingRegistrants, setLoadingRegistrants] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [totalRegistrantCount, setTotalRegistrantCount] = useState(0);

  useEffect(() => {
    if (enabled && userId) {
      loadTemplates();
      loadRegistrants();
    }
  }, [enabled, fromKey, userId, eventId]);

  useEffect(() => {
    const checkActiveJob = async () => {
      const { data } = await supabase
        .from('email_batch_jobs')
        .select('*')
        .eq('event_id', eventId)
        .eq('email_type', 'registrant_email')
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setActiveJob(data);
        setSendingToExisting(true);
        startJobPolling(data.id);
      }
    };
    checkActiveJob();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [eventId]);

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const data = await EmailTemplateService.getTemplatesForAdmin(userId, fromKey);
      const filteredTemplates = data.filter(t => t.template_type === 'member_email');
      setTemplates(filteredTemplates);
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const loadRegistrants = async () => {
    setLoadingRegistrants(true);
    try {
      const { data, error, count } = await supabase
        .from('event_registrations')
        .select(`
          id,
          member_profiles!inner(
            customers!inner(
              email, attributes
            )
          )
        `, { count: 'exact' })
        .eq('event_id', eventId)
        .eq('status', 'confirmed');

      if (error) throw error;

      const mapped: RegistrantInfo[] = (data || [])
        .map((reg: any) => {
          const customer = reg.member_profiles?.customers;
          if (!customer?.email) return null;
          const attrs = customer.attributes || {};
          return {
            registration_id: reg.id,
            full_name: `${attrs.first_name || ''} ${attrs.last_name || ''}`.trim() || customer.email,
            email: customer.email,
            company: attrs.company || '',
            job_title: attrs.job_title || '',
          };
        })
        .filter(Boolean) as RegistrantInfo[];

      setRegistrants(mapped);
      setTotalRegistrantCount(count || mapped.length);
    } catch (error) {
      console.error('Error loading registrants:', error);
    } finally {
      setLoadingRegistrants(false);
    }
  };

  const filteredRegistrants = useMemo(() => {
    if (!searchQuery.trim()) return registrants;
    const q = searchQuery.toLowerCase();
    return registrants.filter(r =>
      r.full_name.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      r.company.toLowerCase().includes(q) ||
      r.job_title.toLowerCase().includes(q)
    );
  }, [registrants, searchQuery]);

  const recipientCount = selectionMode === 'all' ? totalRegistrantCount : selectedIds.size;

  const handleSelectAll = () => {
    const newSelected = new Set(selectedIds);
    filteredRegistrants.forEach(r => newSelected.add(r.registration_id));
    setSelectedIds(newSelected);
  };

  const handleDeselectAll = () => {
    if (searchQuery.trim()) {
      const filteredIds = new Set(filteredRegistrants.map(r => r.registration_id));
      setSelectedIds(new Set([...selectedIds].filter(id => !filteredIds.has(id))));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleRegistrant = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleTemplateSelect = async (selectedTemplateId: string) => {
    onTemplateIdChange(selectedTemplateId || null);
    if (selectedTemplateId) {
      const template = templates.find(t => t.id === selectedTemplateId);
      if (template) {
        onEmailSubjectChange(template.subject);
        onEmailContentChange(template.content_html);
      }
    } else {
      onEmailSubjectChange('');
      onEmailContentChange('');
    }
  };

  const buildPreviewContext = (
    email: string = 'registrant@example.com',
    firstName: string = 'Jane',
    lastName: string = 'Smith'
  ): TemplateContext => ({
    customer: {
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`.trim(),
      email: email,
    },
    event: {
      name: eventDetails?.event_title || '',
      city: eventDetails?.event_city || '',
      country: eventDetails?.event_country_code || '',
      start_date: eventDetails?.event_start ? new Date(eventDetails.event_start).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      }) : '',
      end_date: eventDetails?.event_end ? new Date(eventDetails.event_end).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      }) : '',
      link: eventDetails?.event_link || '',
      location: eventDetails?.event_location || '',
    },
  });

  const previewContext = useMemo(() => buildPreviewContext(), [eventDetails]);
  const previewSubject = useMemo(() => replaceVariables(emailSubject, previewContext), [emailSubject, previewContext]);
  const previewContent = useMemo(() => replaceVariables(emailContent, previewContext), [emailContent, previewContext]);

  const hasTemplateVariables = useMemo(() => {
    const subjectVars = findAllVariables(emailSubject);
    const contentVars = findAllVariables(emailContent);
    return subjectVars.length > 0 || contentVars.length > 0;
  }, [emailSubject, emailContent]);

  const handleTestSend = async () => {
    if (!testEmailAddress.trim()) {
      toast.error('Please enter an email address');
      return;
    }
    if (!emailSubject.trim() || !emailContent.trim()) {
      toast.error('Please configure the email subject and content first');
      return;
    }

    setSendingTest(true);
    try {
      const context = buildPreviewContext(testEmailAddress, 'Test', 'User');
      const processedSubject = replaceVariables(emailSubject, context);
      const processedHtml = replaceVariables(emailContent, context);
      const fromAddress = fromAddresses[fromKey as keyof typeof fromAddresses] || fromAddresses.events;

      const result = await EmailService.sendEmail({
        to: [testEmailAddress],
        cc: cc || undefined,
        from: fromAddress || '',
        subject: `[TEST] ${processedSubject}`,
        html: processedHtml,
        replyTo: replyTo || undefined,
      });

      if (result.success) {
        toast.success(`Test email sent to ${testEmailAddress}`);
        setShowTestSendModal(false);
        setTestEmailAddress('');
      } else {
        toast.error(result.error || 'Failed to send test email');
      }
    } catch (error) {
      console.error('Error sending test email:', error);
      toast.error('Failed to send test email');
    } finally {
      setSendingTest(false);
    }
  };

  const handleSendToRegistrants = async () => {
    if (!emailSubject.trim() || !emailContent.trim()) {
      toast.error('Please configure the email subject and content first');
      return;
    }

    setSendingToExisting(true);
    setShowSendConfirm(false);

    try {
      const fromAddress = fromAddresses[fromKey as keyof typeof fromAddresses] || fromAddresses.events;

      const config: Record<string, any> = {};
      if (selectionMode === 'specific') {
        config.registration_ids = [...selectedIds];
      }

      const { data: job, error: jobError } = await supabase
        .from('email_batch_jobs')
        .insert({
          event_id: eventId,
          email_type: 'registrant_email',
          subject_template: emailSubject,
          content_template: emailContent,
          from_address: fromAddress || '',
          reply_to: replyTo || null,
          cc: cc || null,
          config,
          created_by: userId || null,
        })
        .select('*')
        .single();

      if (jobError || !job) throw jobError || new Error('Failed to create job');

      setActiveJob(job);

      await supabase.functions.invoke('batch-send-email', {
        body: { jobId: job.id },
      });

      startJobPolling(job.id);
      toast.success('Email send started in the background');
    } catch (error) {
      console.error('Error starting batch send:', error);
      toast.error('Failed to start email send');
      setSendingToExisting(false);
    }
  };

  const startJobPolling = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const { data: job } = await supabase
        .from('email_batch_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (!job) return;
      setActiveJob(job);

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        if (pollRef.current) clearInterval(pollRef.current);
        setSendingToExisting(false);

        if (job.status === 'completed') {
          if (job.fail_count === 0) {
            toast.success(`Email sent to ${job.success_count} registrant${job.success_count !== 1 ? 's' : ''}`);
          } else {
            toast.warning(`Sent to ${job.success_count}, failed for ${job.fail_count}`);
          }
        } else if (job.status === 'cancelled') {
          toast.info(`Send cancelled. ${job.success_count} sent, ${job.total_recipients - job.processed_count} remaining.`);
        } else {
          toast.error('Email send failed');
        }

        if (job.success_count > 0 && templateId) {
          EmailTemplateService.incrementUsage(templateId).catch(console.error);
        }
      }
    }, 2000);
  };

  const handleCancelJob = async () => {
    if (!activeJob) return;
    await supabase
      .from('email_batch_jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', activeJob.id);
  };

  return (
    <div className={`border rounded-lg p-5 transition-colors ${
      enabled
        ? 'border-primary-500 dark:border-primary-400'
        : 'border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h4 className="text-base font-semibold text-gray-900 dark:text-white">Registrant Email</h4>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Send an ad-hoc email to all or selected event registrants</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
        </label>
      </div>

      {enabled && (
        <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          {/* From Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              From Address
            </label>
            <Select
              value={fromKey}
              onChange={(e) => onFromKeyChange(e.target.value)}
              data={fromOptions}
            />
          </div>

          {/* Email Template */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Load Template
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
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Subject
            </label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => onEmailSubjectChange(e.target.value)}
              placeholder="Enter email subject (use {{customer.first_name}}, {{event.name}}, etc.)"
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
                  onClick={() => setShowTestSendModal(true)}
                  disabled={!emailSubject.trim() || !emailContent.trim()}
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <PaperAirplaneIcon className="h-4 w-4" />
                  Send Test
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

            {!showPreview && hasTemplateVariables && (
              <div className="mb-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  This message contains template variables. Each recipient will receive a personalized version.
                  Use the "Variables" button in the toolbar to insert dynamic content.
                </p>
              </div>
            )}

            {showPreview ? (
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Preview for: Jane Smith (registrant@example.com)
                  </p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                    Subject: {previewSubject || '(No subject)'}
                  </p>
                </div>
                <div
                  className="p-4 prose prose-sm dark:prose-invert max-w-none overflow-y-auto bg-white dark:bg-gray-900"
                  style={{ minHeight: '250px', maxHeight: '400px' }}
                  dangerouslySetInnerHTML={{ __html: previewContent || '<p class="text-gray-400">(No content)</p>' }}
                />
              </div>
            ) : (
              <div style={{ minHeight: '250px' }}>
                <RichTextEditor
                  content={emailContent}
                  onChange={onEmailContentChange}
                  placeholder="Enter your message here... Use the Variables button in the toolbar to insert dynamic content like {{customer.first_name}}, {{event.name}}, etc."
                  templateVariables={{
                    enabled: true,
                    availableScopes: ['customer', 'event'],
                  }}
                />
              </div>
            )}
          </div>

          {/* Reply-To Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Reply-To Address (optional)
            </label>
            <input
              type="email"
              value={replyTo || ''}
              onChange={(e) => onReplyToChange(e.target.value || null)}
              placeholder="replies@example.com"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>

          {/* CC Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              CC Address (optional)
            </label>
            <input
              type="email"
              value={cc || ''}
              onChange={(e) => onCcChange(e.target.value || null)}
              placeholder="team@example.com"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>

          {/* Recipient Selection */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-2 mb-3">
              <UsersIcon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              <h5 className="text-sm font-medium text-gray-900 dark:text-white">
                Select Recipients
              </h5>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                ({totalRegistrantCount} total registrant{totalRegistrantCount !== 1 ? 's' : ''})
              </span>
            </div>

            {/* Selection Mode Toggle */}
            <div className="flex items-center gap-4 mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="selectionMode"
                  checked={selectionMode === 'all'}
                  onChange={() => setSelectionMode('all')}
                  className="text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">All Registrants</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="selectionMode"
                  checked={selectionMode === 'specific'}
                  onChange={() => setSelectionMode('specific')}
                  className="text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Select Specific</span>
              </label>
            </div>

            {/* Registrant Picker (only in specific mode) */}
            {selectionMode === 'specific' && (
              <div className="space-y-2">
                {/* Search */}
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, email, company, or job title..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400"
                  />
                </div>

                {/* Select/Deselect buttons */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      Select All{searchQuery.trim() ? ' Filtered' : ''}
                    </button>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="text-xs text-gray-500 dark:text-gray-400 hover:underline"
                    >
                      Deselect All{searchQuery.trim() ? ' Filtered' : ''}
                    </button>
                  </div>
                  {selectedIds.size > 0 && (
                    <span className="text-xs font-medium text-primary-600 dark:text-primary-400">
                      {selectedIds.size} selected
                    </span>
                  )}
                </div>

                {/* Registrant List */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
                  {loadingRegistrants ? (
                    <div className="flex items-center justify-center py-8">
                      <LoadingSpinner size="sm" />
                      <span className="ml-2 text-sm text-gray-500">Loading registrants...</span>
                    </div>
                  ) : filteredRegistrants.length === 0 ? (
                    <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                      {searchQuery.trim() ? 'No registrants match your search' : 'No registrants found'}
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
                      {filteredRegistrants.map((registrant) => (
                        <label
                          key={registrant.registration_id}
                          className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                            selectedIds.has(registrant.registration_id) ? 'bg-primary-50 dark:bg-primary-900/10' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(registrant.registration_id)}
                            onChange={() => toggleRegistrant(registrant.registration_id)}
                            className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                {registrant.full_name}
                              </span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {registrant.email}
                              </span>
                            </div>
                            {(registrant.company || registrant.job_title) && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {[registrant.job_title, registrant.company].filter(Boolean).join(' at ')}
                              </div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Send Button / Progress */}
            <div className="mt-3">
              {activeJob && (activeJob.status === 'pending' || activeJob.status === 'processing') ? (
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                      <span>Sending {activeJob.processed_count}/{activeJob.total_recipients}...</span>
                      <span>{activeJob.total_recipients > 0 ? Math.round((activeJob.processed_count / activeJob.total_recipients) * 100) : 0}%</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                      <div
                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                        style={{ width: `${activeJob.total_recipients > 0 ? (activeJob.processed_count / activeJob.total_recipients) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-green-600 dark:text-green-400">{activeJob.success_count} sent</span>
                      {activeJob.fail_count > 0 && (
                        <span className="text-red-600 dark:text-red-400">{activeJob.fail_count} failed</span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCancelJob}
                      className="flex items-center gap-1 text-red-600 hover:text-red-700 border-red-300 hover:border-red-400"
                    >
                      <XMarkIcon className="h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSendConfirm(true)}
                    disabled={sendingToExisting || !emailSubject.trim() || !emailContent.trim() || recipientCount === 0}
                    className="flex items-center gap-2"
                  >
                    <PaperAirplaneIcon className="h-4 w-4" />
                    Send to {recipientCount} {selectionMode === 'all' ? 'Registrant' : 'Selected Registrant'}{recipientCount !== 1 ? 's' : ''}
                  </Button>
                  {(!emailSubject.trim() || !emailContent.trim()) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                      Configure the email subject and content above to enable this feature.
                    </p>
                  )}
                  {selectionMode === 'specific' && selectedIds.size === 0 && emailSubject.trim() && emailContent.trim() && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                      Select at least one registrant to send the email.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Send Modal */}
      <ConfirmModal
        isOpen={showSendConfirm}
        onClose={() => setShowSendConfirm(false)}
        onConfirm={handleSendToRegistrants}
        title="Send to Registrants"
        message={
          selectionMode === 'all'
            ? `Are you sure you want to send this email to all ${totalRegistrantCount} registrant${totalRegistrantCount !== 1 ? 's' : ''}? This action cannot be undone.`
            : `Are you sure you want to send this email to ${selectedIds.size} selected registrant${selectedIds.size !== 1 ? 's' : ''}? This action cannot be undone.`
        }
        confirmText="Send Emails"
        confirmVariant="primary"
      />

      {/* Test Send Modal */}
      <Modal
        isOpen={showTestSendModal}
        onClose={() => {
          setShowTestSendModal(false);
          setTestEmailAddress('');
        }}
        title="Send Test Email"
        size="md"
        footer={
          <div className="flex justify-end gap-3 px-6 py-4">
            <button
              onClick={() => {
                setShowTestSendModal(false);
                setTestEmailAddress('');
              }}
              disabled={sendingTest}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleTestSend}
              disabled={sendingTest || !testEmailAddress.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {sendingTest ? (
                <>
                  <LoadingSpinner size="xs" />
                  Sending...
                </>
              ) : (
                <>
                  <PaperAirplaneIcon className="h-4 w-4" />
                  Send Test
                </>
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Send a test email to verify how the registrant email will look.
            Template variables will be replaced with sample values.
          </p>
          <Input
            label="Email Address"
            type="email"
            value={testEmailAddress}
            onChange={(e) => setTestEmailAddress(e.target.value)}
            placeholder="your@email.com"
            disabled={sendingTest}
            description="The test email will be sent to this address with [TEST] prefix in the subject"
          />
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Preview:</p>
            <p className="text-sm text-gray-900 dark:text-white">
              <strong>Subject:</strong> [TEST] {previewSubject || '(No subject)'}
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// XOR email encoding (matches Customer.io and calendar function)
function encodeEmail(email: string): string {
  if (!email) return '';
  const passphrase = 'HideMe';
  const emailLower = email.toLowerCase();
  const bytes: number[] = [];

  for (let i = 0; i < emailLower.length; i++) {
    const emailCharCode = emailLower.charCodeAt(i);
    const passCharCode = passphrase.charCodeAt(i % passphrase.length);
    bytes.push(emailCharCode ^ passCharCode);
  }

  // Base64 encode (URL-safe)
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return base64;
}

function getJobStatusBadge(status: string) {
  switch (status) {
    case 'completed':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"><CheckCircleIcon className="h-3 w-3" />Completed</span>;
    case 'failed':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"><ExclamationCircleIcon className="h-3 w-3" />Failed</span>;
    case 'cancelled':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"><XMarkIcon className="h-3 w-3" />Cancelled</span>;
    case 'processing':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 animate-pulse"><ArrowPathIcon className="h-3 w-3" />Processing</span>;
    default:
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"><ClockIcon className="h-3 w-3" />Pending</span>;
  }
}

function getEmailStatusBadge(log: { bounced_at?: string; opened_at?: string; delivered_at?: string }) {
  if (log.bounced_at) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"><ExclamationCircleIcon className="h-3 w-3" />Bounced</span>;
  }
  if (log.opened_at) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"><EnvelopeOpenIcon className="h-3 w-3" />Opened</span>;
  }
  if (log.delivered_at) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircleIcon className="h-3 w-3" />Delivered</span>;
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"><EnvelopeIcon className="h-3 w-3" />Sent</span>;
}

export function EventCommunicationsTab({ eventId, eventUuid, eventTitle }: EventCommunicationsTabProps) {
  const { user } = useAuthContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('email');

  // Send to existing registrants state
  const [sendingToExisting, setSendingToExisting] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [registrantCount, setRegistrantCount] = useState<number>(0);
  const [loadingCount, setLoadingCount] = useState(false);

  // Batch job state
  const [activeJob, setActiveJob] = useState<EmailBatchJob | null>(null);
  const [jobHistory, setJobHistory] = useState<EmailBatchJob[]>([]);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [jobEmailLogs, setJobEmailLogs] = useState<any[]>([]);

  // Settings state
  const [settings, setSettings] = useState<CommunicationSettings>({
    event_id: eventId,
    // Registration email
    registration_email_enabled: false,
    registration_email_template_id: null,
    registration_email_from_key: 'events',
    registration_email_reply_to: null,
    registration_email_cc: null,
    registration_email_subject: null,
    registration_email_content: null,
    // Reminder email
    reminder_email_enabled: false,
    reminder_email_template_id: null,
    reminder_email_from_key: 'events',
    reminder_email_reply_to: null,
    reminder_email_cc: null,
    reminder_email_subject: null,
    reminder_email_content: null,
    reminder_email_sent_at: null,
    // Speaker submitted email
    speaker_submitted_email_enabled: false,
    speaker_submitted_email_template_id: null,
    speaker_submitted_email_from_key: 'events',
    speaker_submitted_email_reply_to: null,
    speaker_submitted_email_cc: null,
    speaker_submitted_email_subject: null,
    speaker_submitted_email_content: null,
    // Speaker approved email
    speaker_approved_email_enabled: false,
    speaker_approved_email_template_id: null,
    speaker_approved_email_from_key: 'events',
    speaker_approved_email_reply_to: null,
    speaker_approved_email_cc: null,
    speaker_approved_email_subject: null,
    speaker_approved_email_content: null,
    // Speaker rejected email
    speaker_rejected_email_enabled: false,
    speaker_rejected_email_template_id: null,
    speaker_rejected_email_from_key: 'events',
    speaker_rejected_email_reply_to: null,
    speaker_rejected_email_cc: null,
    speaker_rejected_email_subject: null,
    speaker_rejected_email_content: null,
    // Speaker reserve email
    speaker_reserve_email_enabled: false,
    speaker_reserve_email_template_id: null,
    speaker_reserve_email_from_key: 'events',
    speaker_reserve_email_reply_to: null,
    speaker_reserve_email_cc: null,
    speaker_reserve_email_subject: null,
    speaker_reserve_email_content: null,
    // Speaker confirmed email
    speaker_confirmed_email_enabled: false,
    speaker_confirmed_email_template_id: null,
    speaker_confirmed_email_from_key: 'events',
    speaker_confirmed_email_reply_to: null,
    speaker_confirmed_email_cc: null,
    speaker_confirmed_email_subject: null,
    speaker_confirmed_email_content: null,
    // Post-event attendee email
    post_event_attendee_email_enabled: false,
    post_event_attendee_email_template_id: null,
    post_event_attendee_email_from_key: 'events',
    post_event_attendee_email_reply_to: null,
    post_event_attendee_email_cc: null,
    post_event_attendee_email_subject: null,
    post_event_attendee_email_content: null,
    // Post-event non-attendee email
    post_event_non_attendee_email_enabled: false,
    post_event_non_attendee_email_template_id: null,
    post_event_non_attendee_email_from_key: 'events',
    post_event_non_attendee_email_reply_to: null,
    post_event_non_attendee_email_cc: null,
    post_event_non_attendee_email_subject: null,
    post_event_non_attendee_email_content: null,
    // Competition entry email (auto-responder)
    competition_entry_email_enabled: false,
    competition_entry_email_template_id: null,
    competition_entry_email_from_key: 'events',
    competition_entry_email_reply_to: null,
    competition_entry_email_cc: null,
    competition_entry_email_subject: null,
    competition_entry_email_content: null,
    // Competition non-winner email (manual batch)
    competition_non_winner_email_enabled: false,
    competition_non_winner_email_template_id: null,
    competition_non_winner_email_from_key: 'events',
    competition_non_winner_email_reply_to: null,
    competition_non_winner_email_cc: null,
    competition_non_winner_email_subject: null,
    competition_non_winner_email_content: null,
    // Competition winner email (manual per-winner send)
    competition_winner_email_template_id: null,
    competition_winner_email_from_key: 'events',
    competition_winner_email_reply_to: null,
    competition_winner_email_subject: null,
    competition_winner_email_content: null,
    // Competition winner follow-up email
    competition_winner_followup_email_template_id: null,
    competition_winner_followup_email_content: null,
    // Competition winner accepted colleague email
    competition_winner_accepted_email_template_id: null,
    competition_winner_accepted_email_subject: null,
    competition_winner_accepted_email_content: null,
    // Registrant email
    registrant_email_enabled: false,
    registrant_email_template_id: null,
    registrant_email_from_key: 'events',
    registrant_email_reply_to: null,
    registrant_email_cc: null,
    registrant_email_subject: null,
    registrant_email_content: null,
  });

  // Templates state
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Email content override state (for registration email)
  const [emailSubject, setEmailSubject] = useState('');
  const [emailContent, setEmailContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // Reminder email content state
  const [reminderSubject, setReminderSubject] = useState('');
  const [reminderContent, setReminderContent] = useState('');
  const [showReminderPreview, setShowReminderPreview] = useState(false);

  // Speaker email content state
  const [speakerSubmittedSubject, setSpeakerSubmittedSubject] = useState('');
  const [speakerSubmittedContent, setSpeakerSubmittedContent] = useState('');
  const [speakerApprovedSubject, setSpeakerApprovedSubject] = useState('');
  const [speakerApprovedContent, setSpeakerApprovedContent] = useState('');
  const [speakerRejectedSubject, setSpeakerRejectedSubject] = useState('');
  const [speakerRejectedContent, setSpeakerRejectedContent] = useState('');
  const [speakerReserveSubject, setSpeakerReserveSubject] = useState('');
  const [speakerReserveContent, setSpeakerReserveContent] = useState('');
  const [speakerConfirmedSubject, setSpeakerConfirmedSubject] = useState('');
  const [speakerConfirmedContent, setSpeakerConfirmedContent] = useState('');

  // Post-event email content state
  const [postEventAttendeeSubject, setPostEventAttendeeSubject] = useState('');
  const [postEventAttendeeContent, setPostEventAttendeeContent] = useState('');
  const [postEventNonAttendeeSubject, setPostEventNonAttendeeSubject] = useState('');
  const [postEventNonAttendeeContent, setPostEventNonAttendeeContent] = useState('');

  // Competition email content state
  const [competitionEntrySubject, setCompetitionEntrySubject] = useState('');
  const [competitionEntryContent, setCompetitionEntryContent] = useState('');
  const [competitionNonWinnerSubject, setCompetitionNonWinnerSubject] = useState('');
  const [competitionNonWinnerContent, setCompetitionNonWinnerContent] = useState('');
  const [showCompetitionEntryPreview, setShowCompetitionEntryPreview] = useState(false);

  // Competition winner email content state
  const [competitionWinnerSubject, setCompetitionWinnerSubject] = useState('');
  const [competitionWinnerContent, setCompetitionWinnerContent] = useState('');
  const [competitionWinnerFollowupContent, setCompetitionWinnerFollowupContent] = useState('');
  const [competitionWinnerAcceptedSubject, setCompetitionWinnerAcceptedSubject] = useState('');
  const [competitionWinnerAcceptedContent, setCompetitionWinnerAcceptedContent] = useState('');
  const [showWinnerPreview, setShowWinnerPreview] = useState(false);
  const [showWinnerFollowupPreview, setShowWinnerFollowupPreview] = useState(false);
  const [showWinnerAcceptedPreview, setShowWinnerAcceptedPreview] = useState(false);

  // Registrant email content state
  const [registrantEmailSubject, setRegistrantEmailSubject] = useState('');
  const [registrantEmailContent, setRegistrantEmailContent] = useState('');

  // Event details for template variables
  const [eventDetails, setEventDetails] = useState<EventDetails | null>(null);

  // Test send modal state
  const [showTestSendModal, setShowTestSendModal] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  // From addresses
  const fromAddresses = EmailService.getFromAddresses();

  // Build from address options
  const fromOptions = useMemo(() => {
    const options = [];
    if (fromAddresses.events) {
      options.push({ label: `Events (${fromAddresses.events})`, value: 'events' });
    }
    if (fromAddresses.partners) {
      options.push({ label: `Partners (${fromAddresses.partners})`, value: 'partners' });
    }
    if (fromAddresses.members) {
      options.push({ label: `Members (${fromAddresses.members})`, value: 'members' });
    }
    if (fromAddresses.default) {
      options.push({ label: `Default (${fromAddresses.default})`, value: 'default' });
    }
    if (fromAddresses.admin) {
      options.push({ label: `Admin (${fromAddresses.admin})`, value: 'admin' });
    }
    return options;
  }, [fromAddresses]);

  // Build template context for preview
  const buildPreviewContext = (email: string = 'test@example.com', firstName: string = 'John', lastName: string = 'Doe'): TemplateContext & { calendar: Record<string, string> } => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    const calendarBaseUrl = `${supabaseUrl}/functions/v1/calendar`;
    const emailEncoded = encodeEmail(email);

    return {
      customer: {
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`.trim() || 'John Doe',
        email: email,
      },
      event: {
        name: eventDetails?.event_title || eventTitle,
        city: eventDetails?.event_city || '',
        country: eventDetails?.event_country_code || '',
        start_date: eventDetails?.event_start ? new Date(eventDetails.event_start).toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) : '',
        end_date: eventDetails?.event_end ? new Date(eventDetails.event_end).toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) : '',
      },
      calendar: {
        google: `${calendarBaseUrl}/${eventId}/google/${emailEncoded}`,
        outlook: `${calendarBaseUrl}/${eventId}/outlook/${emailEncoded}`,
        apple: `${calendarBaseUrl}/${eventId}/apple/${emailEncoded}`,
        ics: `${calendarBaseUrl}/${eventId}/ics/${emailEncoded}`,
      },
    };
  };

  // Extended replace function that also handles calendar variables
  const replaceAllVariables = (text: string, context: TemplateContext & { calendar?: Record<string, string> }): string => {
    // First use the standard replaceVariables for customer/event/sponsor
    let result = replaceVariables(text, context);

    // Then handle calendar variables
    if (context.calendar) {
      result = result.replace(/\{\{calendar\.([^}]+)\}\}/g, (match, field) => {
        return context.calendar?.[field] || match;
      });
    }

    // Also handle event.link and event.location which aren't in standard context
    if (eventDetails?.event_link) {
      result = result.replace(/\{\{event\.link\}\}/g, eventDetails.event_link);
    }
    if (eventDetails?.event_location) {
      result = result.replace(/\{\{event\.location\}\}/g, eventDetails.event_location);
    }

    return result;
  };

  // Check if content has template variables
  const hasTemplateVariables = useMemo(() => {
    const subjectVars = findAllVariables(emailSubject);
    const contentVars = findAllVariables(emailContent);
    const calendarVarsInSubject = (emailSubject.match(/\{\{calendar\.[^}]+\}\}/g) || []).length;
    const calendarVarsInContent = (emailContent.match(/\{\{calendar\.[^}]+\}\}/g) || []).length;
    return subjectVars.length > 0 || contentVars.length > 0 || calendarVarsInSubject > 0 || calendarVarsInContent > 0;
  }, [emailSubject, emailContent]);

  // Generate preview content
  const previewContext = useMemo(() => buildPreviewContext(), [eventDetails, eventId, eventTitle]);

  const previewSubject = useMemo(() => {
    return replaceAllVariables(emailSubject, previewContext);
  }, [emailSubject, previewContext]);

  const previewContent = useMemo(() => {
    return replaceAllVariables(emailContent, previewContext);
  }, [emailContent, previewContext]);

  // Reminder preview
  const reminderPreviewSubject = useMemo(() => {
    return replaceAllVariables(reminderSubject, previewContext);
  }, [reminderSubject, previewContext]);

  const reminderPreviewContent = useMemo(() => {
    return replaceAllVariables(reminderContent, previewContext);
  }, [reminderContent, previewContext]);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    loadRegistrantCount();
    loadEventDetails();
    loadJobHistory();

    // Check for active jobs and resume polling
    const checkActiveJob = async () => {
      const { data } = await supabase
        .from('email_batch_jobs')
        .select('*')
        .eq('event_id', eventId)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setActiveJob(data);
        setSendingToExisting(true);
        startJobPolling(data.id);
      }
    };
    checkActiveJob();
  }, [eventId]);

  // Load templates when from key changes
  useEffect(() => {
    loadTemplates();
  }, [settings.registration_email_from_key, user?.id]);

  const loadEventDetails = async () => {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('event_title, event_city, event_country_code, event_start, event_end, event_location, event_link')
        .eq('event_id', eventId)
        .single();

      if (error) throw error;
      setEventDetails(data);
    } catch (error) {
      console.error('Error loading event details:', error);
    }
  };

  const loadRegistrantCount = async () => {
    setLoadingCount(true);
    try {
      const { count, error } = await supabase
        .from('event_registrations')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .eq('status', 'confirmed');

      if (error) throw error;
      setRegistrantCount(count || 0);
    } catch (error) {
      console.error('Error loading registrant count:', error);
    } finally {
      setLoadingCount(false);
    }
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('event_communication_settings')
        .select('*')
        .eq('event_id', eventId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettings({
          id: data.id,
          event_id: data.event_id,
          // Registration email
          registration_email_enabled: data.registration_email_enabled || false,
          registration_email_template_id: data.registration_email_template_id,
          registration_email_from_key: data.registration_email_from_key || 'events',
          registration_email_reply_to: data.registration_email_reply_to,
          registration_email_cc: data.registration_email_cc,
          registration_email_subject: data.registration_email_subject,
          registration_email_content: data.registration_email_content,
          // Reminder email
          reminder_email_enabled: data.reminder_email_enabled || false,
          reminder_email_template_id: data.reminder_email_template_id,
          reminder_email_from_key: data.reminder_email_from_key || 'events',
          reminder_email_reply_to: data.reminder_email_reply_to,
          reminder_email_cc: data.reminder_email_cc,
          reminder_email_subject: data.reminder_email_subject,
          reminder_email_content: data.reminder_email_content,
          reminder_email_sent_at: data.reminder_email_sent_at,
          // Speaker submitted email
          speaker_submitted_email_enabled: data.speaker_submitted_email_enabled || false,
          speaker_submitted_email_template_id: data.speaker_submitted_email_template_id,
          speaker_submitted_email_from_key: data.speaker_submitted_email_from_key || 'events',
          speaker_submitted_email_reply_to: data.speaker_submitted_email_reply_to,
          speaker_submitted_email_cc: data.speaker_submitted_email_cc,
          speaker_submitted_email_subject: data.speaker_submitted_email_subject,
          speaker_submitted_email_content: data.speaker_submitted_email_content,
          // Speaker approved email
          speaker_approved_email_enabled: data.speaker_approved_email_enabled || false,
          speaker_approved_email_template_id: data.speaker_approved_email_template_id,
          speaker_approved_email_from_key: data.speaker_approved_email_from_key || 'events',
          speaker_approved_email_reply_to: data.speaker_approved_email_reply_to,
          speaker_approved_email_cc: data.speaker_approved_email_cc,
          speaker_approved_email_subject: data.speaker_approved_email_subject,
          speaker_approved_email_content: data.speaker_approved_email_content,
          // Speaker rejected email
          speaker_rejected_email_enabled: data.speaker_rejected_email_enabled || false,
          speaker_rejected_email_template_id: data.speaker_rejected_email_template_id,
          speaker_rejected_email_from_key: data.speaker_rejected_email_from_key || 'events',
          speaker_rejected_email_reply_to: data.speaker_rejected_email_reply_to,
          speaker_rejected_email_cc: data.speaker_rejected_email_cc,
          speaker_rejected_email_subject: data.speaker_rejected_email_subject,
          speaker_rejected_email_content: data.speaker_rejected_email_content,
          // Speaker reserve email
          speaker_reserve_email_enabled: data.speaker_reserve_email_enabled || false,
          speaker_reserve_email_template_id: data.speaker_reserve_email_template_id,
          speaker_reserve_email_from_key: data.speaker_reserve_email_from_key || 'events',
          speaker_reserve_email_reply_to: data.speaker_reserve_email_reply_to,
          speaker_reserve_email_cc: data.speaker_reserve_email_cc,
          speaker_reserve_email_subject: data.speaker_reserve_email_subject,
          speaker_reserve_email_content: data.speaker_reserve_email_content,
          // Speaker confirmed email
          speaker_confirmed_email_enabled: data.speaker_confirmed_email_enabled || false,
          speaker_confirmed_email_template_id: data.speaker_confirmed_email_template_id,
          speaker_confirmed_email_from_key: data.speaker_confirmed_email_from_key || 'events',
          speaker_confirmed_email_reply_to: data.speaker_confirmed_email_reply_to,
          speaker_confirmed_email_cc: data.speaker_confirmed_email_cc,
          speaker_confirmed_email_subject: data.speaker_confirmed_email_subject,
          speaker_confirmed_email_content: data.speaker_confirmed_email_content,
          // Post-event attendee email
          post_event_attendee_email_enabled: data.post_event_attendee_email_enabled || false,
          post_event_attendee_email_template_id: data.post_event_attendee_email_template_id,
          post_event_attendee_email_from_key: data.post_event_attendee_email_from_key || 'events',
          post_event_attendee_email_reply_to: data.post_event_attendee_email_reply_to,
          post_event_attendee_email_cc: data.post_event_attendee_email_cc,
          post_event_attendee_email_subject: data.post_event_attendee_email_subject,
          post_event_attendee_email_content: data.post_event_attendee_email_content,
          // Post-event non-attendee email
          post_event_non_attendee_email_enabled: data.post_event_non_attendee_email_enabled || false,
          post_event_non_attendee_email_template_id: data.post_event_non_attendee_email_template_id,
          post_event_non_attendee_email_from_key: data.post_event_non_attendee_email_from_key || 'events',
          post_event_non_attendee_email_reply_to: data.post_event_non_attendee_email_reply_to,
          post_event_non_attendee_email_cc: data.post_event_non_attendee_email_cc,
          post_event_non_attendee_email_subject: data.post_event_non_attendee_email_subject,
          post_event_non_attendee_email_content: data.post_event_non_attendee_email_content,
          // Competition entry email
          competition_entry_email_enabled: data.competition_entry_email_enabled || false,
          competition_entry_email_template_id: data.competition_entry_email_template_id,
          competition_entry_email_from_key: data.competition_entry_email_from_key || 'events',
          competition_entry_email_reply_to: data.competition_entry_email_reply_to,
          competition_entry_email_cc: data.competition_entry_email_cc,
          competition_entry_email_subject: data.competition_entry_email_subject,
          competition_entry_email_content: data.competition_entry_email_content,
          // Competition non-winner email
          competition_non_winner_email_enabled: data.competition_non_winner_email_enabled || false,
          competition_non_winner_email_template_id: data.competition_non_winner_email_template_id,
          competition_non_winner_email_from_key: data.competition_non_winner_email_from_key || 'events',
          competition_non_winner_email_reply_to: data.competition_non_winner_email_reply_to,
          competition_non_winner_email_cc: data.competition_non_winner_email_cc,
          competition_non_winner_email_subject: data.competition_non_winner_email_subject,
          competition_non_winner_email_content: data.competition_non_winner_email_content,
          // Competition winner email
          competition_winner_email_template_id: data.competition_winner_email_template_id,
          competition_winner_email_from_key: data.competition_winner_email_from_key || 'events',
          competition_winner_email_reply_to: data.competition_winner_email_reply_to,
          competition_winner_email_subject: data.competition_winner_email_subject,
          competition_winner_email_content: data.competition_winner_email_content,
          // Competition winner follow-up email
          competition_winner_followup_email_template_id: data.competition_winner_followup_email_template_id,
          competition_winner_followup_email_content: data.competition_winner_followup_email_content,
          // Competition winner accepted email
          competition_winner_accepted_email_template_id: data.competition_winner_accepted_email_template_id,
          competition_winner_accepted_email_subject: data.competition_winner_accepted_email_subject,
          competition_winner_accepted_email_content: data.competition_winner_accepted_email_content,
          // Registrant email
          registrant_email_enabled: data.registrant_email_enabled || false,
          registrant_email_template_id: data.registrant_email_template_id,
          registrant_email_from_key: data.registrant_email_from_key || 'events',
          registrant_email_reply_to: data.registrant_email_reply_to,
          registrant_email_cc: data.registrant_email_cc,
          registrant_email_subject: data.registrant_email_subject,
          registrant_email_content: data.registrant_email_content,
        });

        // Load registration email content - prefer inline content, fall back to template
        if (data.registration_email_subject || data.registration_email_content) {
          setEmailSubject(data.registration_email_subject || '');
          setEmailContent(data.registration_email_content || '');
        } else if (data.registration_email_template_id) {
          const template = await EmailTemplateService.getById(data.registration_email_template_id);
          if (template) {
            setEmailSubject(template.subject);
            setEmailContent(template.content_html);
          }
        }

        // Load reminder email content - prefer inline content, fall back to template
        if (data.reminder_email_subject || data.reminder_email_content) {
          setReminderSubject(data.reminder_email_subject || '');
          setReminderContent(data.reminder_email_content || '');
        } else if (data.reminder_email_template_id) {
          const template = await EmailTemplateService.getById(data.reminder_email_template_id);
          if (template) {
            setReminderSubject(template.subject);
            setReminderContent(template.content_html);
          }
        }

        // Load speaker email content - prefer inline content, fall back to template
        if (data.speaker_submitted_email_subject || data.speaker_submitted_email_content) {
          setSpeakerSubmittedSubject(data.speaker_submitted_email_subject || '');
          setSpeakerSubmittedContent(data.speaker_submitted_email_content || '');
        } else if (data.speaker_submitted_email_template_id) {
          const template = await EmailTemplateService.getById(data.speaker_submitted_email_template_id);
          if (template) {
            setSpeakerSubmittedSubject(template.subject);
            setSpeakerSubmittedContent(template.content_html);
          }
        }
        if (data.speaker_approved_email_subject || data.speaker_approved_email_content) {
          setSpeakerApprovedSubject(data.speaker_approved_email_subject || '');
          setSpeakerApprovedContent(data.speaker_approved_email_content || '');
        } else if (data.speaker_approved_email_template_id) {
          const template = await EmailTemplateService.getById(data.speaker_approved_email_template_id);
          if (template) {
            setSpeakerApprovedSubject(template.subject);
            setSpeakerApprovedContent(template.content_html);
          }
        }
        if (data.speaker_rejected_email_subject || data.speaker_rejected_email_content) {
          setSpeakerRejectedSubject(data.speaker_rejected_email_subject || '');
          setSpeakerRejectedContent(data.speaker_rejected_email_content || '');
        } else if (data.speaker_rejected_email_template_id) {
          const template = await EmailTemplateService.getById(data.speaker_rejected_email_template_id);
          if (template) {
            setSpeakerRejectedSubject(template.subject);
            setSpeakerRejectedContent(template.content_html);
          }
        }
        if (data.speaker_reserve_email_subject || data.speaker_reserve_email_content) {
          setSpeakerReserveSubject(data.speaker_reserve_email_subject || '');
          setSpeakerReserveContent(data.speaker_reserve_email_content || '');
        } else if (data.speaker_reserve_email_template_id) {
          const template = await EmailTemplateService.getById(data.speaker_reserve_email_template_id);
          if (template) {
            setSpeakerReserveSubject(template.subject);
            setSpeakerReserveContent(template.content_html);
          }
        }
        if (data.speaker_confirmed_email_subject || data.speaker_confirmed_email_content) {
          setSpeakerConfirmedSubject(data.speaker_confirmed_email_subject || '');
          setSpeakerConfirmedContent(data.speaker_confirmed_email_content || '');
        } else if (data.speaker_confirmed_email_template_id) {
          const template = await EmailTemplateService.getById(data.speaker_confirmed_email_template_id);
          if (template) {
            setSpeakerConfirmedSubject(template.subject);
            setSpeakerConfirmedContent(template.content_html);
          }
        }

        // Load post-event attendee email content
        if (data.post_event_attendee_email_subject || data.post_event_attendee_email_content) {
          setPostEventAttendeeSubject(data.post_event_attendee_email_subject || '');
          setPostEventAttendeeContent(data.post_event_attendee_email_content || '');
        } else if (data.post_event_attendee_email_template_id) {
          const template = await EmailTemplateService.getById(data.post_event_attendee_email_template_id);
          if (template) {
            setPostEventAttendeeSubject(template.subject);
            setPostEventAttendeeContent(template.content_html);
          }
        }

        // Load post-event non-attendee email content
        if (data.post_event_non_attendee_email_subject || data.post_event_non_attendee_email_content) {
          setPostEventNonAttendeeSubject(data.post_event_non_attendee_email_subject || '');
          setPostEventNonAttendeeContent(data.post_event_non_attendee_email_content || '');
        } else if (data.post_event_non_attendee_email_template_id) {
          const template = await EmailTemplateService.getById(data.post_event_non_attendee_email_template_id);
          if (template) {
            setPostEventNonAttendeeSubject(template.subject);
            setPostEventNonAttendeeContent(template.content_html);
          }
        }

        // Load competition entry email content
        if (data.competition_entry_email_subject || data.competition_entry_email_content) {
          setCompetitionEntrySubject(data.competition_entry_email_subject || '');
          setCompetitionEntryContent(data.competition_entry_email_content || '');
        } else if (data.competition_entry_email_template_id) {
          const template = await EmailTemplateService.getById(data.competition_entry_email_template_id);
          if (template) {
            setCompetitionEntrySubject(template.subject);
            setCompetitionEntryContent(template.content_html);
          }
        }

        // Load competition non-winner email content
        if (data.competition_non_winner_email_subject || data.competition_non_winner_email_content) {
          setCompetitionNonWinnerSubject(data.competition_non_winner_email_subject || '');
          setCompetitionNonWinnerContent(data.competition_non_winner_email_content || '');
        } else if (data.competition_non_winner_email_template_id) {
          const template = await EmailTemplateService.getById(data.competition_non_winner_email_template_id);
          if (template) {
            setCompetitionNonWinnerSubject(template.subject);
            setCompetitionNonWinnerContent(template.content_html);
          }
        }

        // Load competition winner email content
        if (data.competition_winner_email_subject || data.competition_winner_email_content) {
          setCompetitionWinnerSubject(data.competition_winner_email_subject || '');
          setCompetitionWinnerContent(data.competition_winner_email_content || '');
        } else if (data.competition_winner_email_template_id) {
          const template = await EmailTemplateService.getById(data.competition_winner_email_template_id);
          if (template) {
            setCompetitionWinnerSubject(template.subject);
            setCompetitionWinnerContent(template.content_html);
          }
        }

        // Load competition winner follow-up email content
        if (data.competition_winner_followup_email_content) {
          setCompetitionWinnerFollowupContent(data.competition_winner_followup_email_content || '');
        } else if (data.competition_winner_followup_email_template_id) {
          const template = await EmailTemplateService.getById(data.competition_winner_followup_email_template_id);
          if (template) {
            setCompetitionWinnerFollowupContent(template.content_html);
          }
        }

        // Load competition winner accepted email content
        if (data.competition_winner_accepted_email_subject || data.competition_winner_accepted_email_content) {
          setCompetitionWinnerAcceptedSubject(data.competition_winner_accepted_email_subject || '');
          setCompetitionWinnerAcceptedContent(data.competition_winner_accepted_email_content || '');
        } else if (data.competition_winner_accepted_email_template_id) {
          const template = await EmailTemplateService.getById(data.competition_winner_accepted_email_template_id);
          if (template) {
            setCompetitionWinnerAcceptedSubject(template.subject);
            setCompetitionWinnerAcceptedContent(template.content_html);
          }
        }

        // Load registrant email content
        if (data.registrant_email_subject || data.registrant_email_content) {
          setRegistrantEmailSubject(data.registrant_email_subject || '');
          setRegistrantEmailContent(data.registrant_email_content || '');
        } else if (data.registrant_email_template_id) {
          const template = await EmailTemplateService.getById(data.registrant_email_template_id);
          if (template) {
            setRegistrantEmailSubject(template.subject);
            setRegistrantEmailContent(template.content_html);
          }
        }
      }
    } catch (error) {
      console.error('Error loading communication settings:', error);
      toast.error('Failed to load communication settings');
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    if (!user?.id) return;

    setLoadingTemplates(true);
    try {
      const data = await EmailTemplateService.getTemplatesForAdmin(
        user.id,
        settings.registration_email_from_key
      );
      // Filter to member_email templates (for registrant communications)
      const registrationTemplates = data.filter(
        t => t.template_type === 'member_email'
      );
      setTemplates(registrationTemplates);
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleTemplateSelect = async (templateId: string) => {
    setSettings(prev => ({
      ...prev,
      registration_email_template_id: templateId || null
    }));

    if (templateId) {
      const template = templates.find(t => t.id === templateId);
      if (template) {
        setEmailSubject(template.subject);
        setEmailContent(template.content_html);
      }
    } else {
      setEmailSubject('');
      setEmailContent('');
    }
  };

  const handleReminderTemplateSelect = async (templateId: string) => {
    setSettings(prev => ({
      ...prev,
      reminder_email_template_id: templateId || null
    }));

    if (templateId) {
      const template = templates.find(t => t.id === templateId);
      if (template) {
        setReminderSubject(template.subject);
        setReminderContent(template.content_html);
      }
    } else {
      setReminderSubject('');
      setReminderContent('');
    }
  };

  const handleResetReminderSentAt = async () => {
    if (!settings.id) return;
    try {
      const { error } = await supabase
        .from('event_communication_settings')
        .update({ reminder_email_sent_at: null })
        .eq('id', settings.id);
      if (error) throw error;
      setSettings(prev => ({ ...prev, reminder_email_sent_at: null }));
      toast.success('Reminder reset — it will be sent again before the next event start');
    } catch (error) {
      console.error('Error resetting reminder:', error);
      toast.error('Failed to reset reminder');
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const settingsData = {
        event_id: eventId,
        // Registration email
        registration_email_enabled: settings.registration_email_enabled,
        registration_email_template_id: settings.registration_email_template_id || null,
        registration_email_from_key: settings.registration_email_from_key,
        registration_email_reply_to: settings.registration_email_reply_to || null,
        registration_email_cc: settings.registration_email_cc || null,
        registration_email_subject: emailSubject || null,
        registration_email_content: emailContent || null,
        // Reminder email
        reminder_email_enabled: settings.reminder_email_enabled,
        reminder_email_template_id: settings.reminder_email_template_id || null,
        reminder_email_from_key: settings.reminder_email_from_key,
        reminder_email_reply_to: settings.reminder_email_reply_to || null,
        reminder_email_cc: settings.reminder_email_cc || null,
        reminder_email_subject: reminderSubject || null,
        reminder_email_content: reminderContent || null,
        // Speaker submitted email
        speaker_submitted_email_enabled: settings.speaker_submitted_email_enabled,
        speaker_submitted_email_template_id: settings.speaker_submitted_email_template_id || null,
        speaker_submitted_email_from_key: settings.speaker_submitted_email_from_key,
        speaker_submitted_email_reply_to: settings.speaker_submitted_email_reply_to || null,
        speaker_submitted_email_cc: settings.speaker_submitted_email_cc || null,
        speaker_submitted_email_subject: speakerSubmittedSubject || null,
        speaker_submitted_email_content: speakerSubmittedContent || null,
        // Speaker approved email
        speaker_approved_email_enabled: settings.speaker_approved_email_enabled,
        speaker_approved_email_template_id: settings.speaker_approved_email_template_id || null,
        speaker_approved_email_from_key: settings.speaker_approved_email_from_key,
        speaker_approved_email_reply_to: settings.speaker_approved_email_reply_to || null,
        speaker_approved_email_cc: settings.speaker_approved_email_cc || null,
        speaker_approved_email_subject: speakerApprovedSubject || null,
        speaker_approved_email_content: speakerApprovedContent || null,
        // Speaker rejected email
        speaker_rejected_email_enabled: settings.speaker_rejected_email_enabled,
        speaker_rejected_email_template_id: settings.speaker_rejected_email_template_id || null,
        speaker_rejected_email_from_key: settings.speaker_rejected_email_from_key,
        speaker_rejected_email_reply_to: settings.speaker_rejected_email_reply_to || null,
        speaker_rejected_email_cc: settings.speaker_rejected_email_cc || null,
        speaker_rejected_email_subject: speakerRejectedSubject || null,
        speaker_rejected_email_content: speakerRejectedContent || null,
        // Speaker reserve email
        speaker_reserve_email_enabled: settings.speaker_reserve_email_enabled,
        speaker_reserve_email_template_id: settings.speaker_reserve_email_template_id || null,
        speaker_reserve_email_from_key: settings.speaker_reserve_email_from_key,
        speaker_reserve_email_reply_to: settings.speaker_reserve_email_reply_to || null,
        speaker_reserve_email_cc: settings.speaker_reserve_email_cc || null,
        speaker_reserve_email_subject: speakerReserveSubject || null,
        speaker_reserve_email_content: speakerReserveContent || null,
        // Speaker confirmed email
        speaker_confirmed_email_enabled: settings.speaker_confirmed_email_enabled,
        speaker_confirmed_email_template_id: settings.speaker_confirmed_email_template_id || null,
        speaker_confirmed_email_from_key: settings.speaker_confirmed_email_from_key,
        speaker_confirmed_email_reply_to: settings.speaker_confirmed_email_reply_to || null,
        speaker_confirmed_email_cc: settings.speaker_confirmed_email_cc || null,
        speaker_confirmed_email_subject: speakerConfirmedSubject || null,
        speaker_confirmed_email_content: speakerConfirmedContent || null,
        // Post-event attendee email
        post_event_attendee_email_enabled: settings.post_event_attendee_email_enabled,
        post_event_attendee_email_template_id: settings.post_event_attendee_email_template_id || null,
        post_event_attendee_email_from_key: settings.post_event_attendee_email_from_key,
        post_event_attendee_email_reply_to: settings.post_event_attendee_email_reply_to || null,
        post_event_attendee_email_cc: settings.post_event_attendee_email_cc || null,
        post_event_attendee_email_subject: postEventAttendeeSubject || null,
        post_event_attendee_email_content: postEventAttendeeContent || null,
        // Post-event non-attendee email
        post_event_non_attendee_email_enabled: settings.post_event_non_attendee_email_enabled,
        post_event_non_attendee_email_template_id: settings.post_event_non_attendee_email_template_id || null,
        post_event_non_attendee_email_from_key: settings.post_event_non_attendee_email_from_key,
        post_event_non_attendee_email_reply_to: settings.post_event_non_attendee_email_reply_to || null,
        post_event_non_attendee_email_cc: settings.post_event_non_attendee_email_cc || null,
        post_event_non_attendee_email_subject: postEventNonAttendeeSubject || null,
        post_event_non_attendee_email_content: postEventNonAttendeeContent || null,
        // Competition entry email
        competition_entry_email_enabled: settings.competition_entry_email_enabled,
        competition_entry_email_template_id: settings.competition_entry_email_template_id || null,
        competition_entry_email_from_key: settings.competition_entry_email_from_key,
        competition_entry_email_reply_to: settings.competition_entry_email_reply_to || null,
        competition_entry_email_cc: settings.competition_entry_email_cc || null,
        competition_entry_email_subject: competitionEntrySubject || null,
        competition_entry_email_content: competitionEntryContent || null,
        // Competition non-winner email
        competition_non_winner_email_enabled: settings.competition_non_winner_email_enabled,
        competition_non_winner_email_template_id: settings.competition_non_winner_email_template_id || null,
        competition_non_winner_email_from_key: settings.competition_non_winner_email_from_key,
        competition_non_winner_email_reply_to: settings.competition_non_winner_email_reply_to || null,
        competition_non_winner_email_cc: settings.competition_non_winner_email_cc || null,
        competition_non_winner_email_subject: competitionNonWinnerSubject || null,
        competition_non_winner_email_content: competitionNonWinnerContent || null,
        // Competition winner email
        competition_winner_email_template_id: settings.competition_winner_email_template_id || null,
        competition_winner_email_from_key: settings.competition_winner_email_from_key,
        competition_winner_email_reply_to: settings.competition_winner_email_reply_to || null,
        competition_winner_email_subject: competitionWinnerSubject || null,
        competition_winner_email_content: competitionWinnerContent || null,
        // Competition winner follow-up email
        competition_winner_followup_email_template_id: settings.competition_winner_followup_email_template_id || null,
        competition_winner_followup_email_content: competitionWinnerFollowupContent || null,
        // Competition winner accepted email
        competition_winner_accepted_email_template_id: settings.competition_winner_accepted_email_template_id || null,
        competition_winner_accepted_email_subject: competitionWinnerAcceptedSubject || null,
        competition_winner_accepted_email_content: competitionWinnerAcceptedContent || null,
        // Registrant email
        registrant_email_enabled: settings.registrant_email_enabled,
        registrant_email_template_id: settings.registrant_email_template_id || null,
        registrant_email_from_key: settings.registrant_email_from_key,
        registrant_email_reply_to: settings.registrant_email_reply_to || null,
        registrant_email_cc: settings.registrant_email_cc || null,
        registrant_email_subject: registrantEmailSubject || null,
        registrant_email_content: registrantEmailContent || null,
        updated_at: new Date().toISOString(),
      };

      if (settings.id) {
        // Update existing
        const { error } = await supabase
          .from('event_communication_settings')
          .update(settingsData)
          .eq('id', settings.id);

        if (error) throw error;
      } else {
        // Insert new
        const { data, error } = await supabase
          .from('event_communication_settings')
          .insert(settingsData)
          .select('id')
          .single();

        if (error) throw error;
        setSettings(prev => ({ ...prev, id: data.id }));
      }

      toast.success('Communication settings saved');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestSend = async () => {
    if (!testEmailAddress.trim()) {
      toast.error('Please enter an email address');
      return;
    }

    if (!emailSubject.trim() || !emailContent.trim()) {
      toast.error('Please configure the email subject and content first');
      return;
    }

    setSendingTest(true);
    try {
      // Build context for the test recipient
      const context = buildPreviewContext(testEmailAddress, 'Test', 'User');

      // Replace variables
      const processedSubject = replaceAllVariables(emailSubject, context);
      const processedHtml = replaceAllVariables(emailContent, context);

      // Get from address
      const fromKey = settings.registration_email_from_key || 'events';
      const fromAddress = fromAddresses[fromKey as keyof typeof fromAddresses] || fromAddresses.events;

      // Send test email
      const result = await EmailService.sendEmail({
        to: [testEmailAddress],
        cc: settings.registration_email_cc || undefined,
        from: fromAddress || '',
        subject: `[TEST] ${processedSubject}`,
        html: processedHtml,
        replyTo: settings.registration_email_reply_to || undefined,
      });

      if (result.success) {
        toast.success(`Test email sent to ${testEmailAddress}`);
        setShowTestSendModal(false);
        setTestEmailAddress('');
      } else {
        toast.error(result.error || 'Failed to send test email');
      }
    } catch (error) {
      console.error('Error sending test email:', error);
      toast.error('Failed to send test email');
    } finally {
      setSendingTest(false);
    }
  };

  const handleSendToExisting = async () => {
    if (!emailSubject.trim() || !emailContent.trim()) {
      toast.error('Please configure the email subject and content first');
      return;
    }

    setSendingToExisting(true);
    setShowSendConfirm(false);

    try {
      // Get from address
      const fromKey = settings.registration_email_from_key || 'events';
      const fromAddress = fromAddresses[fromKey as keyof typeof fromAddresses] || fromAddresses.events;

      // Create batch job
      const { data: job, error: jobError } = await supabase
        .from('email_batch_jobs')
        .insert({
          event_id: eventId,
          email_type: 'registration',
          subject_template: emailSubject,
          content_template: emailContent,
          from_address: fromAddress || '',
          reply_to: settings.registration_email_reply_to || null,
          cc: settings.registration_email_cc || null,
          config: {},
          created_by: user?.id,
        })
        .select('*')
        .single();

      if (jobError || !job) throw jobError || new Error('Failed to create job');

      setActiveJob(job);

      // Invoke edge function
      await supabase.functions.invoke('batch-send-email', {
        body: { jobId: job.id },
      });

      // Start polling for progress
      startJobPolling(job.id);

      toast.success('Email send started in the background');
    } catch (error) {
      console.error('Error starting batch send:', error);
      toast.error('Failed to start email send');
      setSendingToExisting(false);
    }
  };

  const startJobPolling = (jobId: string) => {
    const poll = setInterval(async () => {
      const { data: job } = await supabase
        .from('email_batch_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (!job) return;
      setActiveJob(job);

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        clearInterval(poll);
        setSendingToExisting(false);
        loadJobHistory();

        if (job.status === 'completed') {
          if (job.fail_count === 0) {
            toast.success(`Email sent to ${job.success_count} registrant${job.success_count !== 1 ? 's' : ''}`);
          } else {
            toast.warning(`Sent to ${job.success_count}, failed for ${job.fail_count} registrants`);
          }
        } else if (job.status === 'cancelled') {
          toast.info(`Send cancelled. ${job.success_count} sent, ${job.total_recipients - job.processed_count} remaining.`);
        } else {
          toast.error('Email send failed');
        }

        // Increment template usage
        if (job.success_count > 0 && settings.registration_email_template_id) {
          EmailTemplateService.incrementUsage(settings.registration_email_template_id).catch(console.error);
        }
      }
    }, 2000);

    // Cleanup on unmount
    return () => clearInterval(poll);
  };

  const handleCancelJob = async () => {
    if (!activeJob) return;
    await supabase
      .from('email_batch_jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', activeJob.id);
  };

  const handleResumeJob = async (jobId: string) => {
    setSendingToExisting(true);
    const { data: job } = await supabase
      .from('email_batch_jobs')
      .select('*')
      .eq('id', jobId)
      .single();
    if (job) {
      // Reset status to processing so edge function accepts it
      await supabase.from('email_batch_jobs').update({
        status: 'processing',
        updated_at: new Date().toISOString(),
      }).eq('id', jobId);
      setActiveJob({ ...job, status: 'processing' });
      await supabase.functions.invoke('batch-send-email', {
        body: { jobId },
      });
      startJobPolling(jobId);
    }
  };

  const loadJobHistory = async () => {
    const { data } = await supabase
      .from('email_batch_jobs')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setJobHistory(data);
  };

  const loadJobEmailLogs = async (jobId: string) => {
    if (expandedJobId === jobId) {
      setExpandedJobId(null);
      setJobEmailLogs([]);
      return;
    }
    const { data } = await supabase
      .from('email_logs')
      .select('id, recipient_email, status, delivered_at, opened_at, bounced_at, created_at')
      .eq('batch_job_id', jobId)
      .order('created_at', { ascending: true })
      .limit(100);
    setExpandedJobId(jobId);
    setJobEmailLogs(data || []);
  };

  const selectedTemplate = useMemo(() => {
    if (!settings.registration_email_template_id) return null;
    return templates.find(t => t.id === settings.registration_email_template_id);
  }, [settings.registration_email_template_id, templates]);

  if (loading) {
    return (
      <Card>
        <div className="p-6 flex items-center justify-center min-h-[200px]">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sub-tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveSubTab('email')}
            className={`
              flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm
              ${activeSubTab === 'email'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }
            `}
          >
            <EnvelopeIcon className="h-5 w-5" />
            Email
          </button>
          <button
            onClick={() => setActiveSubTab('push')}
            className={`
              flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm
              ${activeSubTab === 'push'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }
            `}
          >
            <BellIcon className="h-5 w-5" />
            Push Notifications
          </button>
          <button
            onClick={() => setActiveSubTab('slack')}
            className={`
              flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm
              ${activeSubTab === 'slack'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }
            `}
          >
            <SlackIcon className="h-5 w-5" />
            Slack
          </button>
          <button
            onClick={() => setActiveSubTab('sheets')}
            className={`
              flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm
              ${activeSubTab === 'sheets'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }
            `}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.385 3.52h-7.692v4.038h9.231V5.058c0-.835-.689-1.538-1.539-1.538zm-9.231 0H4.615c-.85 0-1.538.703-1.538 1.538v2.5h7.077V3.52zm-7.077 4.038v9.884h7.077v-9.884H3.077zm7.077 0v9.884h9.231v-9.884h-9.231zm9.231 11.423h-7.692v1.5c0 .834.689 1.538 1.539 1.538h6.153c.85 0 1.538-.704 1.538-1.538v-1.5h-1.538zm-9.231 0H3.077v1.5c0 .834.688 1.538 1.538 1.538h5.539v-3.038z" />
            </svg>
            Google Sheets
          </button>
        </nav>
      </div>

      {/* Email Sub-tab */}
      {activeSubTab === 'email' && (
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/20">
                <EnvelopeIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Email Communications
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Configure automated emails for event registrants
                </p>
              </div>
            </div>

            <div className="space-y-6">
              {/* Registration Confirmation Email */}
              <div className={`border rounded-lg p-5 transition-colors ${
                settings.registration_email_enabled
                  ? 'border-primary-500 dark:border-primary-400'
                  : 'border-gray-200 dark:border-gray-700'
              }`}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                      Registration Confirmation Email
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      Automatically send a confirmation email when someone registers for this event
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.registration_email_enabled}
                      onChange={(e) => setSettings(prev => ({
                        ...prev,
                        registration_email_enabled: e.target.checked
                      }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                {settings.registration_email_enabled && (
                  <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    {/* From Address */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        From Address
                      </label>
                      <Select
                        value={settings.registration_email_from_key}
                        onChange={(e) => setSettings(prev => ({
                          ...prev,
                          registration_email_from_key: e.target.value,
                          registration_email_template_id: null // Reset template when from changes
                        }))}
                        data={fromOptions}
                      />
                    </div>

                    {/* Email Template */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Load Template
                      </label>
                      <select
                        value={settings.registration_email_template_id || ''}
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
                          No templates available. Create a member email template in Admin &gt; Emails.
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
                        onChange={(e) => setEmailSubject(e.target.value)}
                        placeholder="Enter email subject (use {{customer.first_name}}, {{event.name}}, etc.)"
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
                            onClick={() => setShowTestSendModal(true)}
                            disabled={!emailSubject.trim() || !emailContent.trim()}
                            className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                          >
                            <PaperAirplaneIcon className="h-4 w-4" />
                            Send Test
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
                      {!showPreview && hasTemplateVariables && (
                        <div className="mb-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                          <p className="text-xs text-blue-700 dark:text-blue-300">
                            This message contains template variables. Each recipient will receive a personalized version.
                            Use the "Variables" button in the toolbar to insert dynamic content.
                          </p>
                        </div>
                      )}

                      {showPreview ? (
                        /* Preview Mode */
                        <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                          <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Preview for: John Doe (test@example.com)
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
                            content={emailContent}
                            onChange={setEmailContent}
                            placeholder="Enter your message here... Use the Variables button in the toolbar to insert dynamic content like {{customer.first_name}}, {{event.name}}, {{calendar.google}}, etc."
                            templateVariables={{
                              enabled: true,
                              availableScopes: ['customer', 'event'],
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Reply-To Address */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Reply-To Address (optional)
                      </label>
                      <input
                        type="email"
                        value={settings.registration_email_reply_to || ''}
                        onChange={(e) => setSettings(prev => ({
                          ...prev,
                          registration_email_reply_to: e.target.value || null
                        }))}
                        placeholder="replies@example.com"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Where replies should be sent (if different from the From address)
                      </p>
                    </div>

                    {/* CC Address */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        CC Address (optional)
                      </label>
                      <input
                        type="email"
                        value={settings.registration_email_cc || ''}
                        onChange={(e) => setSettings(prev => ({
                          ...prev,
                          registration_email_cc: e.target.value || null
                        }))}
                        placeholder="team@example.com"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Send a copy of every email to this address
                      </p>
                    </div>

                    {/* Send to Existing Registrants */}
                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50">
                      <div className="flex items-center gap-2 mb-2">
                        <UsersIcon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                        <h5 className="text-sm font-medium text-gray-900 dark:text-white">
                          Send to Existing Registrants
                        </h5>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                        Send this email to all {loadingCount ? '...' : registrantCount} people who have already registered for this event.
                      </p>

                      {activeJob && (activeJob.status === 'pending' || activeJob.status === 'processing') && activeJob.email_type === 'registration' ? (
                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                              <span>Sending {activeJob.processed_count}/{activeJob.total_recipients}...</span>
                              <span>{activeJob.total_recipients > 0 ? Math.round((activeJob.processed_count / activeJob.total_recipients) * 100) : 0}%</span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                              <div
                                className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                                style={{ width: `${activeJob.total_recipients > 0 ? (activeJob.processed_count / activeJob.total_recipients) * 100 : 0}%` }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-xs">
                              <span className="text-green-600 dark:text-green-400">{activeJob.success_count} sent</span>
                              {activeJob.fail_count > 0 && (
                                <span className="text-red-600 dark:text-red-400">{activeJob.fail_count} failed</span>
                              )}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleCancelJob}
                              className="flex items-center gap-1 text-red-600 hover:text-red-700 border-red-300 hover:border-red-400"
                            >
                              <XMarkIcon className="h-3.5 w-3.5" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowSendConfirm(true)}
                            disabled={sendingToExisting || !emailSubject.trim() || !emailContent.trim() || registrantCount === 0}
                            className="flex items-center gap-2"
                          >
                            <PaperAirplaneIcon className="h-4 w-4" />
                            Send to {registrantCount} Registrant{registrantCount !== 1 ? 's' : ''}
                          </Button>
                          {(!emailSubject.trim() || !emailContent.trim()) && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                              Configure the email subject and content above to enable this feature.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Reminder Email (1 Hour Before Event) */}
              <div className={`border rounded-lg p-5 transition-colors ${
                settings.reminder_email_enabled
                  ? 'border-orange-500 dark:border-orange-400'
                  : 'border-gray-200 dark:border-gray-700'
              }`}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                      Reminder Email
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      Automatically send a reminder email ~1 hour before the event starts
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.reminder_email_enabled}
                      onChange={(e) => setSettings(prev => ({
                        ...prev,
                        reminder_email_enabled: e.target.checked
                      }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 dark:peer-focus:ring-orange-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-orange-500"></div>
                  </label>
                </div>

                {settings.reminder_email_enabled && (
                  <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    {/* Status indicator */}
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
                      settings.reminder_email_sent_at
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                        : eventDetails?.event_start && new Date(eventDetails.event_start) <= new Date()
                          ? 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                          : 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300'
                    }`}>
                      <ClockIcon className="h-4 w-4 flex-shrink-0" />
                      {settings.reminder_email_sent_at ? (
                        <div className="flex items-center justify-between w-full">
                          <span>Reminder sent at {new Date(settings.reminder_email_sent_at).toLocaleString()}</span>
                          <button
                            type="button"
                            onClick={handleResetReminderSentAt}
                            className="text-xs font-medium text-orange-600 hover:text-orange-700 dark:text-orange-400 flex items-center gap-1"
                          >
                            <ArrowPathIcon className="h-3.5 w-3.5" />
                            Reset
                          </button>
                        </div>
                      ) : eventDetails?.event_start && new Date(eventDetails.event_start) <= new Date() ? (
                        <span>Event has already started</span>
                      ) : (
                        <span>Will send automatically ~1 hour before event starts</span>
                      )}
                    </div>

                    {/* From Address */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        From Address
                      </label>
                      <Select
                        value={settings.reminder_email_from_key}
                        onChange={(e) => setSettings(prev => ({
                          ...prev,
                          reminder_email_from_key: e.target.value,
                          reminder_email_template_id: null
                        }))}
                        data={fromOptions}
                      />
                    </div>

                    {/* Email Template */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Load Template
                      </label>
                      <select
                        value={settings.reminder_email_template_id || ''}
                        onChange={(e) => handleReminderTemplateSelect(e.target.value)}
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
                    </div>

                    {/* Subject */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Subject
                      </label>
                      <input
                        type="text"
                        value={reminderSubject}
                        onChange={(e) => setReminderSubject(e.target.value)}
                        placeholder="Enter email subject (use {{customer.first_name}}, {{event.name}}, etc.)"
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
                            onClick={() => setShowReminderPreview(!showReminderPreview)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5 ${
                              showReminderPreview
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                                : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                            }`}
                          >
                            {showReminderPreview ? (
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

                      {showReminderPreview ? (
                        <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                          <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Preview for: John Doe (test@example.com)
                            </p>
                            <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                              Subject: {reminderPreviewSubject || '(No subject)'}
                            </p>
                          </div>
                          <div
                            className="p-4 prose prose-sm dark:prose-invert max-w-none overflow-y-auto bg-white dark:bg-gray-900"
                            style={{ minHeight: '300px', maxHeight: '500px' }}
                            dangerouslySetInnerHTML={{ __html: reminderPreviewContent || '<p class="text-gray-400">(No content)</p>' }}
                          />
                        </div>
                      ) : (
                        <div style={{ minHeight: '300px' }}>
                          <RichTextEditor
                            content={reminderContent}
                            onChange={setReminderContent}
                            placeholder="Enter your reminder message here... Use the Variables button in the toolbar to insert dynamic content like {{customer.first_name}}, {{event.name}}, {{calendar.google}}, etc."
                            templateVariables={{
                              enabled: true,
                              availableScopes: ['customer', 'event'],
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Reply-To Address */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Reply-To Address (optional)
                      </label>
                      <input
                        type="email"
                        value={settings.reminder_email_reply_to || ''}
                        onChange={(e) => setSettings(prev => ({
                          ...prev,
                          reminder_email_reply_to: e.target.value || null
                        }))}
                        placeholder="replies@example.com"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </div>

                    {/* CC Address */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        CC Address (optional)
                      </label>
                      <input
                        type="email"
                        value={settings.reminder_email_cc || ''}
                        onChange={(e) => setSettings(prev => ({
                          ...prev,
                          reminder_email_cc: e.target.value || null
                        }))}
                        placeholder="team@example.com"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Post-Event Emails Section */}
              <div className="mt-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/20">
                    <CheckCircleIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                      Post-Event Emails
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Send follow-up emails after the event to attendees and non-attendees
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  <PostEventEmailConfig
                    title="Post-Event Attendee Email"
                    description="Send a follow-up email to people who attended the event (checked in)"
                    emailType="post_event_attendee"
                    recipientLabel="Attendees"
                    enabled={settings.post_event_attendee_email_enabled}
                    templateId={settings.post_event_attendee_email_template_id}
                    fromKey={settings.post_event_attendee_email_from_key}
                    replyTo={settings.post_event_attendee_email_reply_to}
                    cc={settings.post_event_attendee_email_cc}
                    emailSubject={postEventAttendeeSubject}
                    emailContent={postEventAttendeeContent}
                    onEnabledChange={(enabled) => setSettings(prev => ({ ...prev, post_event_attendee_email_enabled: enabled }))}
                    onTemplateIdChange={(templateId) => setSettings(prev => ({ ...prev, post_event_attendee_email_template_id: templateId }))}
                    onFromKeyChange={(fromKey) => setSettings(prev => ({ ...prev, post_event_attendee_email_from_key: fromKey }))}
                    onReplyToChange={(replyTo) => setSettings(prev => ({ ...prev, post_event_attendee_email_reply_to: replyTo }))}
                    onCcChange={(cc) => setSettings(prev => ({ ...prev, post_event_attendee_email_cc: cc }))}
                    onEmailSubjectChange={setPostEventAttendeeSubject}
                    onEmailContentChange={setPostEventAttendeeContent}
                    userId={user?.id || ''}
                    eventId={eventId}
                    eventDetails={eventDetails}
                    fromAddresses={fromAddresses}
                    fromOptions={fromOptions}
                  />

                  <PostEventEmailConfig
                    title="Post-Event Non-Attendee Email"
                    description="Send a follow-up email to people who registered but did NOT attend"
                    emailType="post_event_non_attendee"
                    recipientLabel="Non-Attendees"
                    enabled={settings.post_event_non_attendee_email_enabled}
                    templateId={settings.post_event_non_attendee_email_template_id}
                    fromKey={settings.post_event_non_attendee_email_from_key}
                    replyTo={settings.post_event_non_attendee_email_reply_to}
                    cc={settings.post_event_non_attendee_email_cc}
                    emailSubject={postEventNonAttendeeSubject}
                    emailContent={postEventNonAttendeeContent}
                    onEnabledChange={(enabled) => setSettings(prev => ({ ...prev, post_event_non_attendee_email_enabled: enabled }))}
                    onTemplateIdChange={(templateId) => setSettings(prev => ({ ...prev, post_event_non_attendee_email_template_id: templateId }))}
                    onFromKeyChange={(fromKey) => setSettings(prev => ({ ...prev, post_event_non_attendee_email_from_key: fromKey }))}
                    onReplyToChange={(replyTo) => setSettings(prev => ({ ...prev, post_event_non_attendee_email_reply_to: replyTo }))}
                    onCcChange={(cc) => setSettings(prev => ({ ...prev, post_event_non_attendee_email_cc: cc }))}
                    onEmailSubjectChange={setPostEventNonAttendeeSubject}
                    onEmailContentChange={setPostEventNonAttendeeContent}
                    userId={user?.id || ''}
                    eventId={eventId}
                    eventDetails={eventDetails}
                    fromAddresses={fromAddresses}
                    fromOptions={fromOptions}
                  />
                </div>
              </div>

              {/* Registrant Email Section */}
              <div className="mt-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/20">
                    <EnvelopeIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                      Registrant Email
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Send an ad-hoc email to all or selected event registrants
                    </p>
                  </div>
                </div>

                <RegistrantEmailConfig
                  enabled={settings.registrant_email_enabled}
                  templateId={settings.registrant_email_template_id}
                  fromKey={settings.registrant_email_from_key}
                  replyTo={settings.registrant_email_reply_to}
                  cc={settings.registrant_email_cc}
                  emailSubject={registrantEmailSubject}
                  emailContent={registrantEmailContent}
                  onEnabledChange={(enabled) => setSettings(prev => ({ ...prev, registrant_email_enabled: enabled }))}
                  onTemplateIdChange={(templateId) => setSettings(prev => ({ ...prev, registrant_email_template_id: templateId }))}
                  onFromKeyChange={(fromKey) => setSettings(prev => ({ ...prev, registrant_email_from_key: fromKey }))}
                  onReplyToChange={(replyTo) => setSettings(prev => ({ ...prev, registrant_email_reply_to: replyTo }))}
                  onCcChange={(cc) => setSettings(prev => ({ ...prev, registrant_email_cc: cc }))}
                  onEmailSubjectChange={setRegistrantEmailSubject}
                  onEmailContentChange={setRegistrantEmailContent}
                  userId={user?.id || ''}
                  eventId={eventId}
                  eventDetails={eventDetails}
                  fromAddresses={fromAddresses}
                  fromOptions={fromOptions}
                />
              </div>

              {/* Competition Emails Section */}
              <div className="mt-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/20">
                    <svg className="h-4 w-4 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7" />
                      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7" />
                      <path d="M4 22h16" />
                      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
                      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
                      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                      Competition Emails
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Automated and manual emails for competition entrants
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  {/* Competition Winner Notification Email */}
                  <div className="border rounded-lg p-5 border-gray-200 dark:border-gray-700">
                    <div>
                      <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                        Winner Notification Email
                      </h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Template used when emailing selected winners from the Competitions page
                      </p>
                    </div>

                    <div className="space-y-4 pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
                      {/* From Address */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          From Address
                        </label>
                        <Select
                          value={settings.competition_winner_email_from_key}
                          onChange={(e) => setSettings(prev => ({
                            ...prev,
                            competition_winner_email_from_key: e.target.value,
                            competition_winner_email_template_id: null
                          }))}
                          data={fromOptions}
                        />
                      </div>

                      {/* Email Template */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Load Template
                        </label>
                        <select
                          value={settings.competition_winner_email_template_id || ''}
                          onChange={(e) => {
                            const templateId = e.target.value;
                            setSettings(prev => ({ ...prev, competition_winner_email_template_id: templateId || null }));
                            if (templateId) {
                              const template = templates.find(t => t.id === templateId);
                              if (template) {
                                setCompetitionWinnerSubject(template.subject);
                                setCompetitionWinnerContent(template.content_html);
                              }
                            } else {
                              setCompetitionWinnerSubject('');
                              setCompetitionWinnerContent('');
                            }
                          }}
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
                      </div>

                      {/* Subject */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Subject
                        </label>
                        <input
                          type="text"
                          value={competitionWinnerSubject}
                          onChange={(e) => setCompetitionWinnerSubject(e.target.value)}
                          placeholder="e.g. You've won a free ticket to {{event.name}}"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        />
                      </div>

                      {/* Message Editor / Preview */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Message
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowWinnerPreview(!showWinnerPreview)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5 ${
                              showWinnerPreview
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                                : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                            }`}
                          >
                            {showWinnerPreview ? (
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

                        <div className="mb-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            Available variables: {'{{customer.first_name}}'}, {'{{customer.last_name}}'}, {'{{event.name}}'}, {'{{event.date}}'}, {'{{competition.title}}'}
                          </p>
                        </div>

                        {showWinnerPreview ? (
                          <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                            <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                Preview for: John Doe (winner@example.com)
                              </p>
                              <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                                Subject: {replaceAllVariables(competitionWinnerSubject, previewContext) || '(No subject)'}
                              </p>
                            </div>
                            <div
                              className="p-4 prose prose-sm dark:prose-invert max-w-none overflow-y-auto bg-white dark:bg-gray-900"
                              style={{ minHeight: '250px', maxHeight: '400px' }}
                              dangerouslySetInnerHTML={{ __html: replaceAllVariables(competitionWinnerContent, previewContext) || '<p class="text-gray-400">(No content)</p>' }}
                            />
                          </div>
                        ) : (
                          <div style={{ minHeight: '250px' }}>
                            <RichTextEditor
                              content={competitionWinnerContent}
                              onChange={setCompetitionWinnerContent}
                              placeholder="Enter your winner notification message..."
                              templateVariables={{
                                enabled: true,
                                availableScopes: ['customer', 'event'],
                              }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Reply-To */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Reply-To Address (optional)
                        </label>
                        <input
                          type="email"
                          value={settings.competition_winner_email_reply_to || ''}
                          onChange={(e) => setSettings(prev => ({
                            ...prev,
                            competition_winner_email_reply_to: e.target.value || null
                          }))}
                          placeholder="replies@example.com"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Competition Winner Follow-up Email */}
                  <div className="border rounded-lg p-5 border-gray-200 dark:border-gray-700">
                    <div>
                      <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                        Winner Follow-up Email
                      </h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Template for re-sending to notified winners who haven&apos;t replied. Subject uses &quot;Re: &quot; + winner notification subject.
                      </p>
                    </div>

                    <div className="space-y-4 pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
                      {/* Email Template */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Load Template
                        </label>
                        <select
                          value={settings.competition_winner_followup_email_template_id || ''}
                          onChange={(e) => {
                            const templateId = e.target.value;
                            setSettings(prev => ({ ...prev, competition_winner_followup_email_template_id: templateId || null }));
                            if (templateId) {
                              const template = templates.find(t => t.id === templateId);
                              if (template) {
                                setCompetitionWinnerFollowupContent(template.content_html);
                              }
                            } else {
                              setCompetitionWinnerFollowupContent('');
                            }
                          }}
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
                      </div>

                      {/* Subject (derived, read-only) */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Subject <span className="text-xs text-gray-400">(auto-derived from winner notification subject)</span>
                        </label>
                        <input
                          type="text"
                          value={competitionWinnerSubject ? `Re: ${competitionWinnerSubject}` : ''}
                          disabled
                          placeholder="Configure the winner notification subject above first"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                        />
                      </div>

                      {/* Message Editor / Preview */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Message
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowWinnerFollowupPreview(!showWinnerFollowupPreview)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5 ${
                              showWinnerFollowupPreview
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                                : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                            }`}
                          >
                            {showWinnerFollowupPreview ? (
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

                        <div className="mb-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            Available variables: {'{{customer.first_name}}'}, {'{{customer.last_name}}'}, {'{{event.name}}'}, {'{{event.date}}'}
                          </p>
                        </div>

                        {showWinnerFollowupPreview ? (
                          <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                            <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                Preview for: John Doe (winner@example.com)
                              </p>
                              <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                                Subject: Re: {replaceAllVariables(competitionWinnerSubject, previewContext) || '(No subject)'}
                              </p>
                            </div>
                            <div
                              className="p-4 prose prose-sm dark:prose-invert max-w-none overflow-y-auto bg-white dark:bg-gray-900"
                              style={{ minHeight: '150px', maxHeight: '400px' }}
                              dangerouslySetInnerHTML={{ __html: replaceAllVariables(competitionWinnerFollowupContent, previewContext) || '<p class="text-gray-400">(No content)</p>' }}
                            />
                          </div>
                        ) : (
                          <div style={{ minHeight: '150px' }}>
                            <RichTextEditor
                              content={competitionWinnerFollowupContent}
                              onChange={setCompetitionWinnerFollowupContent}
                              placeholder="Enter your follow-up message for winners who haven't responded..."
                              templateVariables={{
                                enabled: true,
                                availableScopes: ['customer', 'event'],
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Competition Winner Accepted Colleague Email */}
                  <div className="border rounded-lg p-5 border-gray-200 dark:border-gray-700">
                    <div>
                      <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                        Winner Accepted &mdash; Colleague Invite
                      </h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Template for inviting accepted winners to bring a colleague
                      </p>
                    </div>

                    <div className="space-y-4 pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
                      {/* Email Template */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Load Template
                        </label>
                        <select
                          value={settings.competition_winner_accepted_email_template_id || ''}
                          onChange={(e) => {
                            const templateId = e.target.value;
                            setSettings(prev => ({ ...prev, competition_winner_accepted_email_template_id: templateId || null }));
                            if (templateId) {
                              const template = templates.find(t => t.id === templateId);
                              if (template) {
                                setCompetitionWinnerAcceptedSubject(template.subject);
                                setCompetitionWinnerAcceptedContent(template.content_html);
                              }
                            } else {
                              setCompetitionWinnerAcceptedSubject('');
                              setCompetitionWinnerAcceptedContent('');
                            }
                          }}
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
                      </div>

                      {/* Subject */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Subject
                        </label>
                        <input
                          type="text"
                          value={competitionWinnerAcceptedSubject}
                          onChange={(e) => setCompetitionWinnerAcceptedSubject(e.target.value)}
                          placeholder="e.g. Free tickets to {{event.name}}"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        />
                      </div>

                      {/* Message Editor / Preview */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Message
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowWinnerAcceptedPreview(!showWinnerAcceptedPreview)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5 ${
                              showWinnerAcceptedPreview
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                                : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                            }`}
                          >
                            {showWinnerAcceptedPreview ? (
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

                        <div className="mb-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            Available variables: {'{{customer.first_name}}'}, {'{{customer.last_name}}'}, {'{{event.name}}'}, {'{{event.date}}'}
                          </p>
                        </div>

                        {showWinnerAcceptedPreview ? (
                          <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                            <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                Preview for: John Doe (winner@example.com)
                              </p>
                              <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                                Subject: {replaceAllVariables(competitionWinnerAcceptedSubject, previewContext) || '(No subject)'}
                              </p>
                            </div>
                            <div
                              className="p-4 prose prose-sm dark:prose-invert max-w-none overflow-y-auto bg-white dark:bg-gray-900"
                              style={{ minHeight: '150px', maxHeight: '400px' }}
                              dangerouslySetInnerHTML={{ __html: replaceAllVariables(competitionWinnerAcceptedContent, previewContext) || '<p class="text-gray-400">(No content)</p>' }}
                            />
                          </div>
                        ) : (
                          <div style={{ minHeight: '150px' }}>
                            <RichTextEditor
                              content={competitionWinnerAcceptedContent}
                              onChange={setCompetitionWinnerAcceptedContent}
                              placeholder="Enter your colleague invite message for accepted winners..."
                              templateVariables={{
                                enabled: true,
                                availableScopes: ['customer', 'event'],
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Competition Entry Confirmation (Auto-Responder) */}
                  <div className={`border rounded-lg p-5 transition-colors ${
                    settings.competition_entry_email_enabled
                      ? 'border-amber-500 dark:border-amber-400'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}>
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                          Competition Entry Confirmation
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          Automatically send a confirmation email when someone enters a competition
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.competition_entry_email_enabled}
                          onChange={(e) => setSettings(prev => ({
                            ...prev,
                            competition_entry_email_enabled: e.target.checked
                          }))}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 dark:peer-focus:ring-amber-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-amber-500"></div>
                      </label>
                    </div>

                    {settings.competition_entry_email_enabled && (
                      <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                        {/* From Address */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            From Address
                          </label>
                          <Select
                            value={settings.competition_entry_email_from_key}
                            onChange={(e) => setSettings(prev => ({
                              ...prev,
                              competition_entry_email_from_key: e.target.value,
                              competition_entry_email_template_id: null
                            }))}
                            data={fromOptions}
                          />
                        </div>

                        {/* Email Template */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Load Template
                          </label>
                          <select
                            value={settings.competition_entry_email_template_id || ''}
                            onChange={(e) => {
                              const templateId = e.target.value;
                              setSettings(prev => ({ ...prev, competition_entry_email_template_id: templateId || null }));
                              if (templateId) {
                                const template = templates.find(t => t.id === templateId);
                                if (template) {
                                  setCompetitionEntrySubject(template.subject);
                                  setCompetitionEntryContent(template.content_html);
                                }
                              } else {
                                setCompetitionEntrySubject('');
                                setCompetitionEntryContent('');
                              }
                            }}
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
                        </div>

                        {/* Subject */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Subject
                          </label>
                          <input
                            type="text"
                            value={competitionEntrySubject}
                            onChange={(e) => setCompetitionEntrySubject(e.target.value)}
                            placeholder="Enter email subject (use {{customer.first_name}}, {{event.name}}, {{competition.title}}, etc.)"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          />
                        </div>

                        {/* Message Editor / Preview Toggle */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                              Message
                            </label>
                            <button
                              type="button"
                              onClick={() => setShowCompetitionEntryPreview(!showCompetitionEntryPreview)}
                              className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5 ${
                                showCompetitionEntryPreview
                                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                                  : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                            >
                              {showCompetitionEntryPreview ? (
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

                          <div className="mb-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                            <p className="text-xs text-amber-700 dark:text-amber-300">
                              Available variables: {'{{customer.first_name}}'}, {'{{customer.last_name}}'}, {'{{event.name}}'}, {'{{event.city}}'}, {'{{competition.title}}'}
                            </p>
                          </div>

                          {showCompetitionEntryPreview ? (
                            <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                              <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  Preview for: John Doe (test@example.com)
                                </p>
                                <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                                  Subject: {replaceAllVariables(competitionEntrySubject, previewContext) || '(No subject)'}
                                </p>
                              </div>
                              <div
                                className="p-4 prose prose-sm dark:prose-invert max-w-none overflow-y-auto bg-white dark:bg-gray-900"
                                style={{ minHeight: '250px', maxHeight: '400px' }}
                                dangerouslySetInnerHTML={{ __html: replaceAllVariables(competitionEntryContent, previewContext) || '<p class="text-gray-400">(No content)</p>' }}
                              />
                            </div>
                          ) : (
                            <div style={{ minHeight: '250px' }}>
                              <RichTextEditor
                                content={competitionEntryContent}
                                onChange={setCompetitionEntryContent}
                                placeholder="Enter your message here... Use template variables like {{customer.first_name}}, {{event.name}}, {{competition.title}}, etc."
                                templateVariables={{
                                  enabled: true,
                                  availableScopes: ['customer', 'event'],
                                }}
                              />
                            </div>
                          )}
                        </div>

                        {/* Reply-To Address */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Reply-To Address (optional)
                          </label>
                          <input
                            type="email"
                            value={settings.competition_entry_email_reply_to || ''}
                            onChange={(e) => setSettings(prev => ({
                              ...prev,
                              competition_entry_email_reply_to: e.target.value || null
                            }))}
                            placeholder="replies@example.com"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          />
                        </div>

                        {/* CC Address */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            CC Address (optional)
                          </label>
                          <input
                            type="email"
                            value={settings.competition_entry_email_cc || ''}
                            onChange={(e) => setSettings(prev => ({
                              ...prev,
                              competition_entry_email_cc: e.target.value || null
                            }))}
                            placeholder="team@example.com"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Competition Non-Winner Email (Manual Batch) */}
                  <PostEventEmailConfig
                    title="Competition Non-Winner Email"
                    description="Send an email to competition entrants who were not selected as winners"
                    emailType="competition_non_winner"
                    recipientLabel="Non-Winners"
                    enabled={settings.competition_non_winner_email_enabled}
                    templateId={settings.competition_non_winner_email_template_id}
                    fromKey={settings.competition_non_winner_email_from_key}
                    replyTo={settings.competition_non_winner_email_reply_to}
                    cc={settings.competition_non_winner_email_cc}
                    emailSubject={competitionNonWinnerSubject}
                    emailContent={competitionNonWinnerContent}
                    onEnabledChange={(enabled) => setSettings(prev => ({ ...prev, competition_non_winner_email_enabled: enabled }))}
                    onTemplateIdChange={(templateId) => setSettings(prev => ({ ...prev, competition_non_winner_email_template_id: templateId }))}
                    onFromKeyChange={(fromKey) => setSettings(prev => ({ ...prev, competition_non_winner_email_from_key: fromKey }))}
                    onReplyToChange={(replyTo) => setSettings(prev => ({ ...prev, competition_non_winner_email_reply_to: replyTo }))}
                    onCcChange={(cc) => setSettings(prev => ({ ...prev, competition_non_winner_email_cc: cc }))}
                    onEmailSubjectChange={setCompetitionNonWinnerSubject}
                    onEmailContentChange={setCompetitionNonWinnerContent}
                    userId={user?.id || ''}
                    eventId={eventId}
                    eventDetails={eventDetails}
                    fromAddresses={fromAddresses}
                    fromOptions={fromOptions}
                  />
                </div>
              </div>

              {/* Speaker Email Automations Section */}
              <div className="mt-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/20">
                    <MicrophoneIcon className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                      Speaker Email Automations
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Automatically send emails when speaker applications are submitted, approved, or rejected
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  {/* Speaker Application Submitted */}
                  <SpeakerEmailConfig
                    title="Speaker Application Submitted"
                    description="Send an email when someone submits a speaker application (status set to pending)"
                    speakerStatus="pending"
                    enabled={settings.speaker_submitted_email_enabled}
                    templateId={settings.speaker_submitted_email_template_id}
                    fromKey={settings.speaker_submitted_email_from_key}
                    replyTo={settings.speaker_submitted_email_reply_to}
                    cc={settings.speaker_submitted_email_cc}
                    emailSubject={speakerSubmittedSubject}
                    emailContent={speakerSubmittedContent}
                    onEnabledChange={(enabled) => setSettings(prev => ({ ...prev, speaker_submitted_email_enabled: enabled }))}
                    onTemplateIdChange={(templateId) => setSettings(prev => ({ ...prev, speaker_submitted_email_template_id: templateId }))}
                    onFromKeyChange={(fromKey) => {
                      setSettings(prev => ({ ...prev, speaker_submitted_email_from_key: fromKey, speaker_submitted_email_template_id: null }));
                      setSpeakerSubmittedSubject('');
                      setSpeakerSubmittedContent('');
                    }}
                    onReplyToChange={(replyTo) => setSettings(prev => ({ ...prev, speaker_submitted_email_reply_to: replyTo }))}
                    onCcChange={(cc) => setSettings(prev => ({ ...prev, speaker_submitted_email_cc: cc }))}
                    onEmailSubjectChange={setSpeakerSubmittedSubject}
                    onEmailContentChange={setSpeakerSubmittedContent}
                    userId={user?.id || ''}
                    eventId={eventId}
                    eventUuid={eventUuid}
                    eventDetails={eventDetails}
                    fromAddresses={fromAddresses}
                    fromOptions={fromOptions}
                  />

                  {/* Speaker Approved */}
                  <SpeakerEmailConfig
                    title="Speaker Approved"
                    description="Send an email when a speaker application is approved"
                    speakerStatus="approved"
                    enabled={settings.speaker_approved_email_enabled}
                    templateId={settings.speaker_approved_email_template_id}
                    fromKey={settings.speaker_approved_email_from_key}
                    replyTo={settings.speaker_approved_email_reply_to}
                    cc={settings.speaker_approved_email_cc}
                    emailSubject={speakerApprovedSubject}
                    emailContent={speakerApprovedContent}
                    onEnabledChange={(enabled) => setSettings(prev => ({ ...prev, speaker_approved_email_enabled: enabled }))}
                    onTemplateIdChange={(templateId) => setSettings(prev => ({ ...prev, speaker_approved_email_template_id: templateId }))}
                    onFromKeyChange={(fromKey) => {
                      setSettings(prev => ({ ...prev, speaker_approved_email_from_key: fromKey, speaker_approved_email_template_id: null }));
                      setSpeakerApprovedSubject('');
                      setSpeakerApprovedContent('');
                    }}
                    onReplyToChange={(replyTo) => setSettings(prev => ({ ...prev, speaker_approved_email_reply_to: replyTo }))}
                    onCcChange={(cc) => setSettings(prev => ({ ...prev, speaker_approved_email_cc: cc }))}
                    onEmailSubjectChange={setSpeakerApprovedSubject}
                    onEmailContentChange={setSpeakerApprovedContent}
                    userId={user?.id || ''}
                    eventId={eventId}
                    eventUuid={eventUuid}
                    eventDetails={eventDetails}
                    fromAddresses={fromAddresses}
                    fromOptions={fromOptions}
                  />

                  {/* Speaker Rejected */}
                  <SpeakerEmailConfig
                    title="Speaker Rejected"
                    description="Send an email when a speaker application is rejected"
                    speakerStatus="rejected"
                    enabled={settings.speaker_rejected_email_enabled}
                    templateId={settings.speaker_rejected_email_template_id}
                    fromKey={settings.speaker_rejected_email_from_key}
                    replyTo={settings.speaker_rejected_email_reply_to}
                    cc={settings.speaker_rejected_email_cc}
                    emailSubject={speakerRejectedSubject}
                    emailContent={speakerRejectedContent}
                    onEnabledChange={(enabled) => setSettings(prev => ({ ...prev, speaker_rejected_email_enabled: enabled }))}
                    onTemplateIdChange={(templateId) => setSettings(prev => ({ ...prev, speaker_rejected_email_template_id: templateId }))}
                    onFromKeyChange={(fromKey) => {
                      setSettings(prev => ({ ...prev, speaker_rejected_email_from_key: fromKey, speaker_rejected_email_template_id: null }));
                      setSpeakerRejectedSubject('');
                      setSpeakerRejectedContent('');
                    }}
                    onReplyToChange={(replyTo) => setSettings(prev => ({ ...prev, speaker_rejected_email_reply_to: replyTo }))}
                    onCcChange={(cc) => setSettings(prev => ({ ...prev, speaker_rejected_email_cc: cc }))}
                    onEmailSubjectChange={setSpeakerRejectedSubject}
                    onEmailContentChange={setSpeakerRejectedContent}
                    userId={user?.id || ''}
                    eventId={eventId}
                    eventUuid={eventUuid}
                    eventDetails={eventDetails}
                    fromAddresses={fromAddresses}
                    fromOptions={fromOptions}
                  />

                  {/* Speaker Reserve */}
                  <SpeakerEmailConfig
                    title="Speaker Added to Reserve List"
                    description="Send an email when a speaker is added to the reserve/waitlist"
                    speakerStatus="reserve"
                    enabled={settings.speaker_reserve_email_enabled}
                    templateId={settings.speaker_reserve_email_template_id}
                    fromKey={settings.speaker_reserve_email_from_key}
                    replyTo={settings.speaker_reserve_email_reply_to}
                    cc={settings.speaker_reserve_email_cc}
                    emailSubject={speakerReserveSubject}
                    emailContent={speakerReserveContent}
                    onEnabledChange={(enabled) => setSettings(prev => ({ ...prev, speaker_reserve_email_enabled: enabled }))}
                    onTemplateIdChange={(templateId) => setSettings(prev => ({ ...prev, speaker_reserve_email_template_id: templateId }))}
                    onFromKeyChange={(fromKey) => {
                      setSettings(prev => ({ ...prev, speaker_reserve_email_from_key: fromKey, speaker_reserve_email_template_id: null }));
                      setSpeakerReserveSubject('');
                      setSpeakerReserveContent('');
                    }}
                    onReplyToChange={(replyTo) => setSettings(prev => ({ ...prev, speaker_reserve_email_reply_to: replyTo }))}
                    onCcChange={(cc) => setSettings(prev => ({ ...prev, speaker_reserve_email_cc: cc }))}
                    onEmailSubjectChange={setSpeakerReserveSubject}
                    onEmailContentChange={setSpeakerReserveContent}
                    userId={user?.id || ''}
                    eventId={eventId}
                    eventUuid={eventUuid}
                    eventDetails={eventDetails}
                    fromAddresses={fromAddresses}
                    fromOptions={fromOptions}
                  />

                  {/* Speaker Confirmed */}
                  <SpeakerEmailConfig
                    title="Speaker Confirmed"
                    description="Send an email when a speaker's talk is confirmed. Use {{speaker.edit_link}} for the speaker portal link."
                    speakerStatus="confirmed"
                    enabled={settings.speaker_confirmed_email_enabled}
                    templateId={settings.speaker_confirmed_email_template_id}
                    fromKey={settings.speaker_confirmed_email_from_key}
                    replyTo={settings.speaker_confirmed_email_reply_to}
                    cc={settings.speaker_confirmed_email_cc}
                    emailSubject={speakerConfirmedSubject}
                    emailContent={speakerConfirmedContent}
                    onEnabledChange={(enabled) => setSettings(prev => ({ ...prev, speaker_confirmed_email_enabled: enabled }))}
                    onTemplateIdChange={(templateId) => setSettings(prev => ({ ...prev, speaker_confirmed_email_template_id: templateId }))}
                    onFromKeyChange={(fromKey) => {
                      setSettings(prev => ({ ...prev, speaker_confirmed_email_from_key: fromKey, speaker_confirmed_email_template_id: null }));
                      setSpeakerConfirmedSubject('');
                      setSpeakerConfirmedContent('');
                    }}
                    onReplyToChange={(replyTo) => setSettings(prev => ({ ...prev, speaker_confirmed_email_reply_to: replyTo }))}
                    onCcChange={(cc) => setSettings(prev => ({ ...prev, speaker_confirmed_email_cc: cc }))}
                    onEmailSubjectChange={setSpeakerConfirmedSubject}
                    onEmailContentChange={setSpeakerConfirmedContent}
                    userId={user?.id || ''}
                    eventId={eventId}
                    eventUuid={eventUuid}
                    eventDetails={eventDetails}
                    fromAddresses={fromAddresses}
                    fromOptions={fromOptions}
                  />
                </div>
              </div>

              {/* Email Send History */}
              {jobHistory.length > 0 && (
                <div className="mt-8">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                      <ClockIcon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div>
                      <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                        Email Send History
                      </h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Past batch email sends for this event
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">Date</th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">Type</th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">Subject</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">Recipients</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">Sent</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">Failed</th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
                          <th className="py-2 px-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {jobHistory.map((job) => (
                          <Fragment key={job.id}>
                            <tr
                              className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                              onClick={() => loadJobEmailLogs(job.id)}
                            >
                              <td className="py-2 px-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                {new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="py-2 px-3">
                                <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                                  job.email_type === 'registration'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                                    : job.email_type === 'reminder'
                                      ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
                                      : job.email_type === 'post_event_attendee'
                                        ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                        : job.email_type === 'post_event_non_attendee'
                                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                                          : job.email_type === 'competition_non_winner'
                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                                            : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                                }`}>
                                  {job.email_type === 'registration' ? 'Registration' : job.email_type === 'reminder' ? 'Reminder' : job.email_type === 'post_event_attendee' ? 'Post-Event (Attended)' : job.email_type === 'post_event_non_attendee' ? 'Post-Event (No-Show)' : job.email_type === 'competition_non_winner' ? 'Competition (Non-Winner)' : job.email_type.replace('speaker_', 'Speaker ')}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-gray-700 dark:text-gray-300 max-w-[200px] truncate">
                                {job.subject_template}
                              </td>
                              <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{job.total_recipients}</td>
                              <td className="py-2 px-3 text-right text-green-600 dark:text-green-400">{job.success_count}</td>
                              <td className="py-2 px-3 text-right text-red-600 dark:text-red-400">{job.fail_count || '-'}</td>
                              <td className="py-2 px-3">
                                {getJobStatusBadge(job.status)}
                              </td>
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-2">
                                  {(job.status === 'failed' || (job.status === 'processing' && new Date().getTime() - new Date(job.updated_at).getTime() > 60000)) && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleResumeJob(job.id); }}
                                      className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1"
                                    >
                                      <ArrowPathIcon className="h-3.5 w-3.5" />
                                      Resume
                                    </button>
                                  )}
                                  <ChevronDownIcon className={`h-4 w-4 text-gray-400 transition-transform ${expandedJobId === job.id ? 'rotate-180' : ''}`} />
                                </div>
                              </td>
                            </tr>
                            {/* Expanded email delivery log */}
                            {expandedJobId === job.id && (
                              <tr>
                                <td colSpan={8} className="p-0">
                                  <div className="bg-gray-50 dark:bg-gray-800/50 border-y border-gray-200 dark:border-gray-700 p-4">
                                    {jobEmailLogs.length === 0 ? (
                                      <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">No email logs found for this job.</p>
                                    ) : (
                                      <div className="max-h-64 overflow-y-auto">
                                        <table className="w-full text-xs">
                                          <thead>
                                            <tr className="border-b border-gray-200 dark:border-gray-700">
                                              <th className="text-left py-1.5 px-2 font-medium text-gray-500 dark:text-gray-400">Recipient</th>
                                              <th className="text-left py-1.5 px-2 font-medium text-gray-500 dark:text-gray-400">Status</th>
                                              <th className="text-left py-1.5 px-2 font-medium text-gray-500 dark:text-gray-400">Delivered</th>
                                              <th className="text-left py-1.5 px-2 font-medium text-gray-500 dark:text-gray-400">Opened</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {jobEmailLogs.map((log: any) => (
                                              <tr key={log.id} className="border-b border-gray-100 dark:border-gray-800">
                                                <td className="py-1.5 px-2 text-gray-700 dark:text-gray-300">{log.recipient_email}</td>
                                                <td className="py-1.5 px-2">{getEmailStatusBadge(log)}</td>
                                                <td className="py-1.5 px-2 text-gray-500 dark:text-gray-400">
                                                  {log.delivered_at ? new Date(log.delivered_at).toLocaleTimeString() : '-'}
                                                </td>
                                                <td className="py-1.5 px-2 text-gray-500 dark:text-gray-400">
                                                  {log.opened_at ? new Date(log.opened_at).toLocaleTimeString() : '-'}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Save Button */}
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  onClick={handleSaveSettings}
                  disabled={saving}
                  className="flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <LoadingSpinner size="xs" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircleIcon className="h-4 w-4" />
                      Save Settings
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Confirm Send Modal */}
            <ConfirmModal
              isOpen={showSendConfirm}
              onClose={() => setShowSendConfirm(false)}
              onConfirm={handleSendToExisting}
              title="Send to Existing Registrants"
              message={`Are you sure you want to send the registration email to all ${registrantCount} existing registrants? This action cannot be undone.`}
              confirmText="Send Emails"
              confirmVariant="primary"
            />

            {/* Test Send Modal */}
            <Modal
              isOpen={showTestSendModal}
              onClose={() => {
                setShowTestSendModal(false);
                setTestEmailAddress('');
              }}
              title="Send Test Email"
              size="md"
              footer={
                <div className="flex justify-end gap-3 px-6 py-4">
                  <button
                    onClick={() => {
                      setShowTestSendModal(false);
                      setTestEmailAddress('');
                    }}
                    disabled={sendingTest}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleTestSend}
                    disabled={sendingTest || !testEmailAddress.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {sendingTest ? (
                      <>
                        <LoadingSpinner size="xs" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <PaperAirplaneIcon className="h-4 w-4" />
                        Send Test
                      </>
                    )}
                  </button>
                </div>
              }
            >
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Send a test email to verify how the registration confirmation will look.
                  Template variables will be replaced with sample values.
                </p>
                <Input
                  label="Email Address"
                  type="email"
                  value={testEmailAddress}
                  onChange={(e) => setTestEmailAddress(e.target.value)}
                  placeholder="your@email.com"
                  disabled={sendingTest}
                  description="The test email will be sent to this address with [TEST] prefix in the subject"
                />
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Preview:</p>
                  <p className="text-sm text-gray-900 dark:text-white">
                    <strong>Subject:</strong> [TEST] {previewSubject || '(No subject)'}
                  </p>
                </div>
              </div>
            </Modal>
          </div>
        </Card>
      )}

      {/* Push Notifications Sub-tab */}
      {activeSubTab === 'push' && (
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/20">
                <BellIcon className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Push Notifications
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Send push notifications to attendees with the mobile app
                </p>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-2">
                  Send Push Notification
                </h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Send a push notification to all attendees who have the mobile app installed and notifications enabled
                </p>
                <SendNotificationModal
                  eventId={eventId}
                  eventTitle={eventTitle}
                  onComplete={() => toast.success('Notification sent!')}
                />
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Slack Sub-tab */}
      {activeSubTab === 'slack' && (
        <SlackNotificationsTab eventId={eventId} eventTitle={eventTitle} />
      )}

      {/* Google Sheets Sub-tab */}
      {activeSubTab === 'sheets' && (
        <GoogleSheetsNotificationsTab eventId={eventId} eventTitle={eventTitle} />
      )}
    </div>
  );
}
