// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/ui-legacy/Modal';
import { Input } from '@/components/ui-legacy/Form/Input';
import { Select } from '@/components/ui-legacy/Form/Select';
import { RichTextEditor } from '@/components/ui-legacy/RichTextEditor';
import EmailService from '@/utils/emailService';
import EmailTemplateService, { EmailTemplate } from '@/utils/emailTemplateService';
import { SpeakerEmailService } from '@/utils/speakerEmailService';
import { toast } from 'sonner';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { useAuthContext } from '@/app/contexts/auth/context';
import {
  buildContext,
  replaceVariables,
  findAllVariables,
  type TemplateContext,
} from '@/utils/templateVariables';
import type { EventTalkWithSpeakers } from '@/utils/talkService';

interface SendSpeakerEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  talk: EventTalkWithSpeakers;
  eventId: string;
  eventTitle: string;
}

export function SendSpeakerEmailModal({
  isOpen,
  onClose,
  talk,
  eventId,
  eventTitle,
}: SendSpeakerEmailModalProps) {
  const { user } = useAuthContext();
  const fromAddresses = EmailService.getFromAddresses();

  const [selectedFromOption, setSelectedFromOption] = useState('custom');
  const [customFromAddress, setCustomFromAddress] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [cc, setCc] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Template state
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  // Event details for template context
  const [eventDetails, setEventDetails] = useState<any>(null);

  // Extract primary speaker from talk
  const speaker = useMemo(() => {
    if (!talk?.speakers?.length) return null;
    return talk.speakers.find(s => s.is_primary) || talk.speakers[0];
  }, [talk]);

  // Build template context
  const templateContext = useMemo<TemplateContext>(() => {
    if (!speaker || !eventDetails) return {};

    return buildContext({
      customer: {
        first_name: speaker.first_name || '',
        last_name: speaker.last_name || '',
        full_name: speaker.full_name || '',
        email: speaker.email || '',
      },
      speaker: {
        first_name: speaker.first_name || '',
        last_name: speaker.last_name || '',
        full_name: speaker.full_name || '',
        email: speaker.email || '',
        talk_title: talk.title || '',
        talk_synopsis: talk.synopsis || '',
        company: speaker.company || '',
        job_title: speaker.job_title || '',
        edit_link: talk.edit_token
          ? `/events/${eventId}/talks/success/${talk.edit_token}`
          : undefined,
      },
      event: {
        event_title: eventDetails.event_title,
        event_id: eventDetails.event_id,
        event_city: eventDetails.event_city,
        event_country_code: eventDetails.event_country_code,
        event_start: eventDetails.event_start,
        event_end: eventDetails.event_end,
      },
    });
  }, [speaker, talk, eventDetails, eventId]);

  // Check if message contains template variables
  const hasTemplateVariables = useMemo(() => {
    return findAllVariables(message).length > 0 || findAllVariables(subject).length > 0;
  }, [message, subject]);

  // Generate preview with variables replaced
  const previewMessage = useMemo(() => {
    if (!hasTemplateVariables) return message;
    return replaceVariables(message, templateContext);
  }, [message, templateContext, hasTemplateVariables]);

  const previewSubject = useMemo(() => {
    if (!hasTemplateVariables) return subject;
    return replaceVariables(subject, templateContext);
  }, [subject, templateContext, hasTemplateVariables]);

  // Build from address options
  const fromOptions = useMemo(() => {
    const options = [];
    if (fromAddresses.events) {
      options.push({ label: `Events (${fromAddresses.events})`, value: 'events' });
    }
    if (fromAddresses.members) {
      options.push({ label: `Members (${fromAddresses.members})`, value: 'members' });
    }
    if (fromAddresses.partners) {
      options.push({ label: `Partners (${fromAddresses.partners})`, value: 'partners' });
    }
    if (fromAddresses.default) {
      options.push({ label: `Default (${fromAddresses.default})`, value: 'default' });
    }
    if (fromAddresses.admin) {
      options.push({ label: `Admin (${fromAddresses.admin})`, value: 'admin' });
    }
    options.push({ label: 'Custom...', value: 'custom' });
    return options;
  }, [fromAddresses]);

  // Get the actual from address to use
  const fromAddress = useMemo(() => {
    if (selectedFromOption === 'custom') {
      return customFromAddress;
    }
    return fromAddresses[selectedFromOption as keyof typeof fromAddresses] || '';
  }, [selectedFromOption, customFromAddress, fromAddresses]);

  // Fetch event details when modal opens
  useEffect(() => {
    if (!isOpen) return;
    SpeakerEmailService.getEventDetails(eventId).then(setEventDetails);
  }, [isOpen, eventId]);

  // Load templates when modal opens
  useEffect(() => {
    const loadTemplates = async () => {
      if (!isOpen || !user?.id) return;

      setLoadingTemplates(true);
      try {
        const currentFromKey = selectedFromOption !== 'custom' ? selectedFromOption : undefined;
        const data = await EmailTemplateService.getTemplatesForAdmin(user.id, currentFromKey);
        setTemplates(data);
      } catch (error) {
        console.error('Error loading templates:', error);
      } finally {
        setLoadingTemplates(false);
      }
    };

    loadTemplates();
  }, [isOpen, user?.id, selectedFromOption]);

  // Handle template selection
  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;

    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSubject(template.subject);
      setMessage(template.content_html);
    }
  };

  // Set defaults when modal opens
  useEffect(() => {
    if (isOpen) {
      // Default from address to the signed-in user's email
      if (user?.email) {
        setSelectedFromOption('custom');
        setCustomFromAddress(user.email);
      } else {
        setSelectedFromOption('events');
        setCustomFromAddress('');
      }
      setSubject(eventTitle);
      setSelectedTemplateId('');
      setMessage('');
      setReplyTo('');
      setCc('');
      setShowPreview(false);
    }
  }, [isOpen, eventTitle, user?.email]);

  const handleSend = async () => {
    if (!speaker?.email) {
      toast.error('Speaker has no email address');
      return;
    }

    if (!fromAddress.trim()) {
      toast.error('Please enter a from address');
      return;
    }

    if (!subject.trim()) {
      toast.error('Please enter a subject');
      return;
    }

    if (!message.trim()) {
      toast.error('Please enter a message');
      return;
    }

    setIsSending(true);

    try {
      const processedSubject = replaceVariables(subject, templateContext);
      const processedMessage = replaceVariables(message, templateContext);

      const result = await EmailService.sendEmail({
        to: [speaker.email],
        cc: cc.trim() || undefined,
        from: fromAddress,
        subject: processedSubject,
        html: processedMessage,
        replyTo: replyTo.trim() || undefined,
      });

      if (result.success) {
        if (selectedTemplateId) {
          EmailTemplateService.incrementUsage(selectedTemplateId).catch(console.error);
        }
        toast.success(`Email sent to ${speaker.full_name || speaker.email}`);
        handleClose();
      } else {
        toast.error(result.error || 'Failed to send email');
      }
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast.error(error.message || 'Failed to send email');
    } finally {
      setIsSending(false);
    }
  };

  const handleClose = () => {
    setSubject('');
    setMessage('');
    setReplyTo('');
    setCc('');
    setSelectedTemplateId('');
    setShowPreview(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Email Speaker: ${speaker?.full_name || 'Speaker'}`}
      size="2xl"
      footer={
        <div className="flex justify-end gap-3 px-6 py-4">
          <button
            onClick={handleClose}
            disabled={isSending}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={isSending || !speaker?.email}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSending ? (
              <>
                <LoadingSpinner size="xs" />
                Sending...
              </>
            ) : (
              'Send Email'
            )}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-6">
        {/* Left Column - Email Options */}
        <div className="space-y-4">
          {/* Recipient (read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              To
            </label>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {speaker?.full_name || 'Unknown Speaker'}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {speaker?.email || 'No email'}
              </div>
              {talk.title && (
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Talk: {talk.title}
                </div>
              )}
            </div>
          </div>

          {/* From Address Selection */}
          <Select
            label="From"
            value={selectedFromOption}
            onChange={(e) => setSelectedFromOption(e.target.value)}
            disabled={isSending}
            data={fromOptions}
            description="The email address this will be sent from"
          />

          {/* Custom From Address Input */}
          {selectedFromOption === 'custom' && (
            <Input
              label="Custom From Address"
              type="email"
              value={customFromAddress}
              onChange={(e) => setCustomFromAddress(e.target.value)}
              placeholder="sender@example.com"
              disabled={isSending}
            />
          )}

          {/* CC */}
          <Input
            label="CC (optional)"
            type="email"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="cc@example.com"
            disabled={isSending}
            description="Send a copy to this address"
          />

          {/* Reply To */}
          <Input
            label="Reply To (optional)"
            type="email"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            placeholder="reply@example.com"
            disabled={isSending}
            description="Where replies should be sent (if different from 'From')"
          />

          {/* Available Variables Reference */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Available Variables
            </label>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-xs text-gray-600 dark:text-gray-400 space-y-1 max-h-48 overflow-y-auto">
              <p className="font-medium text-gray-700 dark:text-gray-300">Speaker</p>
              <p><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{speaker.first_name}}'}</code> <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{speaker.full_name}}'}</code></p>
              <p><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{speaker.talk_title}}'}</code> <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{speaker.company}}'}</code></p>
              <p><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{speaker.edit_link}}'}</code> <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{speaker.job_title}}'}</code></p>
              <p className="font-medium text-gray-700 dark:text-gray-300 mt-2">Event</p>
              <p><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{event.name}}'}</code> <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{event.start_date}}'}</code></p>
              <p><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{event.city}}'}</code> <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{event.end_date}}'}</code></p>
            </div>
          </div>
        </div>

        {/* Right Column - Subject and Message */}
        <div className="space-y-4 flex flex-col">
          {/* Template Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              <span className="flex items-center gap-1.5">
                <DocumentTextIcon className="size-4" />
                Load Template
              </span>
            </label>
            <select
              value={selectedTemplateId}
              onChange={(e) => handleTemplateSelect(e.target.value)}
              disabled={isSending || loadingTemplates}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-50"
            >
              <option value="">
                {loadingTemplates ? 'Loading templates...' : 'Start from scratch'}
              </option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.sendgrid_from_key && ` (${template.sendgrid_from_key})`}
                </option>
              ))}
            </select>
            {templates.length === 0 && !loadingTemplates && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                No templates available. Create templates in Admin &gt; Emails.
              </p>
            )}
          </div>

          {/* Subject */}
          <Input
            label="Subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Enter email subject"
            disabled={isSending}
          />

          {/* Message */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Message
              </label>
              {hasTemplateVariables && (
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md ${
                    showPreview
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                  disabled={isSending}
                >
                  {showPreview ? 'Edit' : 'Preview'}
                </button>
              )}
            </div>

            {/* Show preview info when variables are used */}
            {hasTemplateVariables && !showPreview && (
              <div className="mb-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  This message contains template variables. Use the "Variables" button in the toolbar to insert dynamic content.
                </p>
              </div>
            )}

            {showPreview ? (
              /* Preview Mode */
              <div className="flex-1 min-h-[400px] border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Preview for: {speaker?.full_name || 'Speaker'}
                  </p>
                  {previewSubject !== subject && (
                    <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                      Subject: {previewSubject}
                    </p>
                  )}
                </div>
                <div
                  className="p-4 prose prose-sm dark:prose-invert max-w-none overflow-y-auto"
                  style={{ maxHeight: '350px' }}
                  dangerouslySetInnerHTML={{ __html: previewMessage }}
                />
              </div>
            ) : (
              /* Edit Mode */
              <div className="flex-1 min-h-[400px]">
                <RichTextEditor
                  content={message}
                  onChange={setMessage}
                  placeholder="Enter your message here... Use the Variables button in the toolbar to insert dynamic content."
                  editable={!isSending}
                  templateVariables={{
                    enabled: true,
                    availableScopes: ['customer', 'speaker', 'event'],
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
