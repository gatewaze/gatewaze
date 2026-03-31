import { useState, useEffect, useMemo } from 'react';
import { Modal, Button } from '@/components/ui';
import { Input } from '@/components/ui/Form/Input';
import { Select } from '@/components/ui/Form/Select';
import { Spinner } from '@/components/ui/Spinner';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import EmailService from '@/utils/emailService';
import { toast } from 'sonner';

interface TeamMember {
  id: string;
  full_name: string;
  email: string;
}

interface SendSponsorEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventName: string;
  eventSponsorId: string;
  sponsorName: string;
  teamMembers: TeamMember[];
  onGenerateScansCSV: () => Promise<string>;
  onGenerateRegistrationsCSV: () => Promise<string>;
  eventData: {
    event_id: string;
    event_title: string;
    event_city: string;
    event_country_code: string;
    event_start: string;
    event_end: string;
  };
  sponsorData: {
    name: string;
    slug?: string;
  };
}

export function SendSponsorEmailModal({
  isOpen,
  onClose,
  eventName,
  sponsorName,
  teamMembers,
  onGenerateScansCSV,
  onGenerateRegistrationsCSV,
  eventData,
}: SendSponsorEmailModalProps) {
  const fromAddresses = EmailService.getFromAddresses();
  const [selectedFromOption, setSelectedFromOption] = useState('partners');
  const [customFromAddress, setCustomFromAddress] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [attachScansCSV, setAttachScansCSV] = useState(false);
  const [attachRegistrationsCSV, setAttachRegistrationsCSV] = useState(false);

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
    options.push({ label: 'Custom...', value: 'custom' });
    return options;
  }, [fromAddresses]);

  const fromAddress = useMemo(() => {
    if (selectedFromOption === 'custom') {
      return customFromAddress;
    }
    return fromAddresses[selectedFromOption as keyof typeof fromAddresses] || '';
  }, [selectedFromOption, customFromAddress, fromAddresses]);

  useEffect(() => {
    if (isOpen) {
      setSelectedFromOption(fromAddresses.partners ? 'partners' : 'members');
      setCustomFromAddress('');
      setSubject(`${eventName} — Sponsor Update`);
      setMessage('');
      setReplyTo('');
      setSelectedRecipients(teamMembers.map(m => m.email));
      setAttachScansCSV(false);
      setAttachRegistrationsCSV(false);
    }
  }, [isOpen, eventName, teamMembers, fromAddresses.partners]);

  const handleToggleRecipient = (email: string) => {
    setSelectedRecipients(prev =>
      prev.includes(email)
        ? prev.filter(e => e !== email)
        : [...prev, email]
    );
  };

  const handleSend = async () => {
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
      const attachments: { content: string; filename: string; type: string; disposition: 'attachment' }[] = [];

      if (attachScansCSV) {
        try {
          const csv = await onGenerateScansCSV();
          attachments.push({
            content: btoa(csv),
            filename: `${sponsorName.replace(/\s+/g, '-').toLowerCase()}-scans-${eventData.event_title.replace(/\s+/g, '-').toLowerCase()}.csv`,
            type: 'text/csv',
            disposition: 'attachment',
          });
        } catch {
          toast.error('Failed to generate scans CSV');
          setIsSending(false);
          return;
        }
      }

      if (attachRegistrationsCSV) {
        try {
          const csv = await onGenerateRegistrationsCSV();
          attachments.push({
            content: btoa(csv),
            filename: `registrations-${eventData.event_title.replace(/\s+/g, '-').toLowerCase()}.csv`,
            type: 'text/csv',
            disposition: 'attachment',
          });
        } catch {
          toast.error('Failed to generate registrations CSV');
          setIsSending(false);
          return;
        }
      }

      const result = await EmailService.sendEmail({
        to: selectedRecipients,
        from: fromAddress,
        subject,
        html: message,
        replyTo: replyTo.trim() || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (result.success) {
        toast.success(`Email sent to ${selectedRecipients.length} recipient(s)`);
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
    setSelectedRecipients([]);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Email ${sponsorName} Team`}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outlined" onClick={handleClose} disabled={isSending}>
            Cancel
          </Button>
          <Button color="primary" onClick={handleSend} disabled={isSending}>
            {isSending ? (
              <span className="flex items-center gap-2">
                <Spinner className="size-4" />
                Sending...
              </span>
            ) : (
              `Send to ${selectedRecipients.length} recipient(s)`
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Recipients */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Recipients
          </label>
          {teamMembers.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No team members found for this sponsor.
            </p>
          ) : (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {teamMembers.map(member => (
                <label
                  key={member.id}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedRecipients.includes(member.email)}
                    onChange={() => handleToggleRecipient(member.email)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-900 dark:text-gray-100">
                    {member.full_name}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ({member.email})
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* From Address */}
        <Select
          label="From"
          value={selectedFromOption}
          onChange={(e) => setSelectedFromOption(e.target.value)}
          disabled={isSending}
          data={fromOptions}
        />

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
        />

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
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Message
          </label>
          <RichTextEditor
            content={message}
            onChange={setMessage}
            placeholder="Enter your message here..."
            editable={!isSending}
          />
        </div>

        {/* Attachments */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Attachments
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={attachScansCSV}
                onChange={(e) => setAttachScansCSV(e.target.checked)}
                className="rounded border-gray-300"
                disabled={isSending}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Attach badge scans CSV
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={attachRegistrationsCSV}
                onChange={(e) => setAttachRegistrationsCSV(e.target.checked)}
                className="rounded border-gray-300"
                disabled={isSending}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Attach registrations CSV
              </span>
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
}
