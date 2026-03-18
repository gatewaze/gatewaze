// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/ui-legacy/Modal';
import { Input } from '@/components/ui-legacy/Form/Input';
import { Select } from '@/components/ui-legacy/Form/Select';
import { RichTextEditor } from '@/components/ui-legacy/RichTextEditor';
import EmailService from '@/utils/emailService';
import EmailTemplateService, { EmailTemplate } from '@/utils/emailTemplateService';
import { toast } from 'sonner';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { useAuthContext } from '@/app/contexts/auth/context';
import {
  buildContext,
  replaceVariables,
  findAllVariables,
  type TemplateContext,
} from '@/utils/templateVariables';

interface SponsorTeamMember {
  id: string;
  full_name: string;
  email: string;
  is_primary_contact?: boolean;
}

// Extended event data for template variables
interface EventData {
  event_id: string; // 6-character event identifier
  event_title?: string;
  event_city?: string;
  event_country_code?: string;
  event_start?: string;
  event_end?: string;
}

// Extended sponsor data for template variables
interface SponsorData {
  name: string;
  slug?: string;
}

interface SendSponsorEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventName: string;
  eventSponsorId: string;
  sponsorName: string;
  teamMembers: SponsorTeamMember[];
  onGenerateScansCSV?: () => Promise<string>;
  onGenerateRegistrationsCSV?: () => Promise<string>;
  // Extended data for template variables
  eventData?: EventData;
  sponsorData?: SponsorData;
}

export function SendSponsorEmailModal({
  isOpen,
  onClose,
  eventName,
  eventSponsorId,
  sponsorName,
  teamMembers,
  onGenerateScansCSV,
  onGenerateRegistrationsCSV,
  eventData,
  sponsorData,
}: SendSponsorEmailModalProps) {
  const { user } = useAuthContext();
  const fromAddresses = EmailService.getFromAddresses();
  const [selectedFromOption, setSelectedFromOption] = useState('partners');
  const [customFromAddress, setCustomFromAddress] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [includeScansCSV, setIncludeScansCSV] = useState(false);
  const [includeRegistrationsCSV, setIncludeRegistrationsCSV] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Template state
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  // Build template context from props
  const templateContext = useMemo<TemplateContext>(() => {
    const ctx = buildContext({
      event: eventData ? {
        event_title: eventData.event_title || eventName,
        event_id: eventData.event_id,
        event_city: eventData.event_city,
        event_country_code: eventData.event_country_code,
        event_start: eventData.event_start,
        event_end: eventData.event_end,
      } : undefined,
      sponsor: sponsorData ? {
        name: sponsorData.name || sponsorName,
        slug: sponsorData.slug,
      } : {
        name: sponsorName,
      },
    });
    return ctx;
  }, [eventData, sponsorData, eventName, sponsorName]);

  // Check if message contains template variables
  const hasTemplateVariables = useMemo(() => {
    return findAllVariables(message).length > 0 || findAllVariables(subject).length > 0;
  }, [message, subject]);

  // Generate preview with variables replaced
  const previewMessage = useMemo(() => {
    if (!hasTemplateVariables) return message;
    // For preview, we use a sample customer context
    const previewContext: TemplateContext = {
      ...templateContext,
      customer: {
        first_name: teamMembers[0]?.full_name?.split(' ')[0] || 'John',
        last_name: teamMembers[0]?.full_name?.split(' ').slice(1).join(' ') || 'Doe',
        full_name: teamMembers[0]?.full_name || 'John Doe',
        email: teamMembers[0]?.email || 'john@example.com',
      },
    };
    return replaceVariables(message, previewContext);
  }, [message, templateContext, teamMembers, hasTemplateVariables]);

  const previewSubject = useMemo(() => {
    if (!hasTemplateVariables) return subject;
    const previewContext: TemplateContext = {
      ...templateContext,
      customer: {
        first_name: teamMembers[0]?.full_name?.split(' ')[0] || 'John',
        last_name: teamMembers[0]?.full_name?.split(' ').slice(1).join(' ') || 'Doe',
        full_name: teamMembers[0]?.full_name || 'John Doe',
        email: teamMembers[0]?.email || 'john@example.com',
      },
    };
    return replaceVariables(subject, previewContext);
  }, [subject, templateContext, teamMembers, hasTemplateVariables]);

  // Build from address options
  const fromOptions = useMemo(() => {
    const options = [];
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
    if (fromAddresses.events) {
      options.push({ label: `Events (${fromAddresses.events})`, value: 'events' });
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

  // Load templates when modal opens or from address changes
  useEffect(() => {
    const loadTemplates = async () => {
      console.log('loadTemplates called - isOpen:', isOpen, 'user?.id:', user?.id, 'selectedFromOption:', selectedFromOption);
      if (!isOpen || !user?.id) {
        console.log('Early return - modal not open or no user');
        return;
      }

      setLoadingTemplates(true);
      try {
        const currentFromKey = selectedFromOption !== 'custom' ? selectedFromOption : undefined;
        console.log('Calling getTemplatesForAdmin with:', user.id, currentFromKey);
        const data = await EmailTemplateService.getTemplatesForAdmin(
          user.id,
          currentFromKey
        );
        console.log('Got templates from service:', data);
        // Filter to sponsor_email templates
        const sponsorTemplates = data.filter(t => t.template_type === 'sponsor_email');
        console.log('Filtered sponsor templates:', sponsorTemplates);
        setTemplates(sponsorTemplates);
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
      // Track usage
      EmailTemplateService.incrementUsage(templateId).catch(console.error);
    }
  };

  // Set defaults when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedFromOption('partners');
      setCustomFromAddress('');
      setSubject(eventName);
      setSelectedTemplateId('');
      setMessage('');

      // Pre-select the primary contact, or empty array if none
      const primaryContact = teamMembers.find(m => m.is_primary_contact);
      setSelectedRecipients(primaryContact ? [primaryContact.email] : []);

      setIncludeScansCSV(false);
      setIncludeRegistrationsCSV(false);
    }
  }, [isOpen, eventName, teamMembers]);

  const handleToggleRecipient = (email: string) => {
    setSelectedRecipients((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]
    );
  };

  const handleSelectAll = () => {
    if (selectedRecipients.length === teamMembers.length) {
      setSelectedRecipients([]);
    } else {
      setSelectedRecipients(teamMembers.map((m) => m.email));
    }
  };

  const handleSend = async () => {
    // Validate fields
    if (!fromAddress.trim()) {
      toast.error('Please enter a from address');
      return;
    }

    if (selectedRecipients.length === 0) {
      toast.error('Please select at least one recipient');
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
      // Generate CSV attachments if requested
      const attachments: Array<{
        content: string;
        filename: string;
        type: string;
        disposition: 'attachment';
      }> = [];

      // Badge Scans CSV
      if (includeScansCSV && onGenerateScansCSV) {
        try {
          const csvContent = await onGenerateScansCSV();
          console.log('Badge scans CSV content length:', csvContent.length);
          console.log('Badge scans CSV preview:', csvContent.substring(0, 200));

          // Check if CSV has data (more than just headers)
          const csvLines = csvContent.trim().split('\n');
          const hasData = csvLines.length > 1; // More than just header row

          if (!hasData) {
            console.log('⚠️ Badge scans CSV is empty, skipping attachment');
            toast.warning('No badge scans found - badge scans CSV will not be attached');
          } else {
            // Convert CSV to base64
            const base64Content = btoa(unescape(encodeURIComponent(csvContent)));
            console.log('Badge scans base64 content length:', base64Content.length);

            const filename = `${sponsorName.replace(/[^a-z0-9]/gi, '_')}_badge_scans.csv`;
            attachments.push({
              content: base64Content,
              filename,
              type: 'text/csv',
              disposition: 'attachment' as const,
            });
            console.log('✅ Badge scans attachment created:', { filename, contentLength: base64Content.length, rowCount: csvLines.length - 1 });
          }
        } catch (error) {
          console.error('Error generating badge scans CSV:', error);
          toast.error('Failed to generate badge scans CSV attachment');
          setIsSending(false);
          return;
        }
      }

      // Registrations CSV
      if (includeRegistrationsCSV && onGenerateRegistrationsCSV) {
        try {
          const csvContent = await onGenerateRegistrationsCSV();
          console.log('Registrations CSV content length:', csvContent.length);
          console.log('Registrations CSV preview:', csvContent.substring(0, 200));

          // Check if CSV has data (more than just headers)
          const csvLines = csvContent.trim().split('\n');
          const hasData = csvLines.length > 1; // More than just header row

          if (!hasData) {
            console.log('⚠️ Registrations CSV is empty, skipping attachment');
            toast.warning('No registrations with sponsor permission found - registrations CSV will not be attached');
          } else {
            // Convert CSV to base64
            const base64Content = btoa(unescape(encodeURIComponent(csvContent)));
            console.log('Registrations base64 content length:', base64Content.length);

            const filename = `${sponsorName.replace(/[^a-z0-9]/gi, '_')}_registrations.csv`;
            attachments.push({
              content: base64Content,
              filename,
              type: 'text/csv',
              disposition: 'attachment' as const,
            });
            console.log('✅ Registrations attachment created:', { filename, contentLength: base64Content.length, rowCount: csvLines.length - 1 });
          }
        } catch (error) {
          console.error('Error generating registrations CSV:', error);
          toast.error('Failed to generate registrations CSV attachment');
          setIsSending(false);
          return;
        }
      }

      console.log(`Sending email with ${attachments.length} attachment(s)`);
      console.log('Message before processing:', message);
      console.log('Found variables in message:', findAllVariables(message));
      console.log('Template context for replacement:', templateContext);

      // Check if we have template variables that require per-recipient personalization
      const hasCustomerVariables = findAllVariables(message).some(v => v.scope === 'customer') ||
        findAllVariables(subject).some(v => v.scope === 'customer');

      if (hasCustomerVariables) {
        // Send individual personalized emails to each recipient
        let successCount = 0;
        let failCount = 0;

        for (const recipientEmail of selectedRecipients) {
          // Find the team member for this email
          const member = teamMembers.find(m => m.email === recipientEmail);
          const nameParts = member?.full_name?.split(' ') || [];
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || '';

          // Build personalized context for this recipient
          const recipientContext: TemplateContext = {
            ...templateContext,
            customer: {
              first_name: firstName,
              last_name: lastName,
              full_name: member?.full_name || '',
              email: recipientEmail,
            },
          };

          // Replace variables in subject and message
          const personalizedSubject = replaceVariables(subject, recipientContext);
          const personalizedMessage = replaceVariables(message, recipientContext);

          try {
            const result = await EmailService.sendEmail({
              to: [recipientEmail],
              from: fromAddress,
              subject: personalizedSubject,
              html: personalizedMessage,
              replyTo: replyTo.trim() || undefined,
              attachments: attachments.length > 0 ? attachments : undefined,
            });

            if (result.success) {
              successCount++;
            } else {
              failCount++;
              console.error(`Failed to send to ${recipientEmail}:`, result.error);
            }
          } catch (error) {
            failCount++;
            console.error(`Error sending to ${recipientEmail}:`, error);
          }
        }

        if (failCount === 0) {
          toast.success(`Email sent successfully to ${successCount} recipient${successCount !== 1 ? 's' : ''}`);
          handleClose();
        } else if (successCount > 0) {
          toast.warning(`Sent to ${successCount} recipients, failed for ${failCount}`);
          handleClose();
        } else {
          toast.error('Failed to send emails');
        }
      } else {
        // No customer variables - send a single email to all recipients
        // Still replace any event/sponsor variables
        const processedSubject = replaceVariables(subject, templateContext);
        const processedMessage = replaceVariables(message, templateContext);

        const result = await EmailService.sendEmail({
          to: selectedRecipients,
          from: fromAddress,
          subject: processedSubject,
          html: processedMessage,
          replyTo: replyTo.trim() || undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        });

        if (result.success) {
          toast.success(result.message || 'Email sent successfully');
          handleClose();
        } else {
          toast.error(result.error || 'Failed to send email');
        }
      }
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast.error(error.message || 'Failed to send email');
    } finally {
      setIsSending(false);
    }
  };

  const handleClose = () => {
    // Reset form
    setSubject('');
    setMessage('');
    setReplyTo('');
    setSelectedRecipients([]);
    setIncludeScansCSV(false);
    setIncludeRegistrationsCSV(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Email ${sponsorName} Team`}
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
            disabled={isSending || selectedRecipients.length === 0}
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
          {/* Recipients */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                To (Team Members)
              </label>
              <button
                onClick={handleSelectAll}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                disabled={isSending}
              >
                {selectedRecipients.length === teamMembers.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="border border-gray-300 dark:border-gray-600 rounded-md max-h-48 overflow-y-auto">
              {teamMembers.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  No team members assigned to this sponsor yet
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {teamMembers.map((member) => (
                    <label
                      key={member.id}
                      className="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedRecipients.includes(member.email)}
                        onChange={() => handleToggleRecipient(member.email)}
                        disabled={isSending}
                        className="rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {member.full_name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {member.email}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {selectedRecipients.length > 0 && (
              <p className="mt-1 text-xs text-gray-500">
                {selectedRecipients.length} recipient{selectedRecipients.length !== 1 ? 's' : ''} selected
              </p>
            )}
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

          {/* Attachment Options */}
          {(onGenerateScansCSV || onGenerateRegistrationsCSV) && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Attachments
              </label>

              {onGenerateScansCSV && (
                <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                  <input
                    type="checkbox"
                    id="includeScansCSV"
                    checked={includeScansCSV}
                    onChange={(e) => setIncludeScansCSV(e.target.checked)}
                    disabled={isSending}
                    className="mt-1 rounded"
                  />
                  <label htmlFor="includeScansCSV" className="flex-1 cursor-pointer">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      Badge Scans CSV
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Include all badge scans from this sponsor's team
                    </div>
                  </label>
                </div>
              )}

              {onGenerateRegistrationsCSV && (
                <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                  <input
                    type="checkbox"
                    id="includeRegistrationsCSV"
                    checked={includeRegistrationsCSV}
                    onChange={(e) => setIncludeRegistrationsCSV(e.target.checked)}
                    disabled={isSending}
                    className="mt-1 rounded"
                  />
                  <label htmlFor="includeRegistrationsCSV" className="flex-1 cursor-pointer">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      Event Registrations CSV
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Include all event registrations with sponsor permission
                    </div>
                  </label>
                </div>
              )}
            </div>
          )}
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
                  This message contains template variables. Each recipient will receive a personalized version.
                  Use the "Variables" button in the toolbar to insert dynamic content.
                </p>
              </div>
            )}

            {showPreview ? (
              /* Preview Mode */
              <div className="flex-1 min-h-[400px] border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Preview for: {teamMembers[0]?.full_name || 'Sample Recipient'}
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
                    availableScopes: ['customer', 'sponsor', 'event'],
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
