import { useState, useEffect, useMemo } from 'react';
import { Modal, Button } from '@/components/ui';
import { Input } from '@/components/ui/Form/Input';
import { Select } from '@/components/ui/Form/Select';
import { Spinner } from '@/components/ui/Spinner';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import EmailService from '@/utils/emailService';
import { toast } from 'sonner';

interface SendEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipientEmail: string;
  recipientName?: string;
  customerId?: number;
}

export function SendEmailModal({
  isOpen,
  onClose,
  recipientEmail,
  recipientName,
  customerId,
}: SendEmailModalProps) {
  const fromAddresses = EmailService.getFromAddresses();
  const [selectedFromOption, setSelectedFromOption] = useState('members');
  const [customFromAddress, setCustomFromAddress] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Build from address options
  const fromOptions = useMemo(() => {
    const options = [];
    if (fromAddresses.members) {
      options.push({ label: `Members (${fromAddresses.members})`, value: 'members' });
    }
    if (fromAddresses.default) {
      options.push({ label: `Default (${fromAddresses.default})`, value: 'default' });
    }
    if (fromAddresses.partners) {
      options.push({ label: `Partners (${fromAddresses.partners})`, value: 'partners' });
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

  // Set default from option when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedFromOption('members');
      setCustomFromAddress('');
    }
  }, [isOpen]);

  const handleSend = async () => {
    // Validate fields
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
      const result = await EmailService.sendEmail({
        to: recipientEmail,
        from: fromAddress,
        subject,
        html: message,
        replyTo: replyTo.trim() || undefined,
        customerId,
      });

      if (result.success) {
        toast.success(result.message || 'Email sent successfully');
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
    // Reset form
    setSubject('');
    setMessage('');
    setReplyTo('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Send Email"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="outlined"
            onClick={handleClose}
            disabled={isSending}
          >
            Cancel
          </Button>
          <Button
            color="primary"
            onClick={handleSend}
            disabled={isSending}
          >
            {isSending ? (
              <span className="flex items-center gap-2">
                <Spinner className="size-4" />
                Sending...
              </span>
            ) : (
              'Send Email'
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Recipient */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            To
          </label>
          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-md text-sm text-gray-900 dark:text-gray-100">
            {recipientName ? `${recipientName} (${recipientEmail})` : recipientEmail}
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
      </div>
    </Modal>
  );
}
