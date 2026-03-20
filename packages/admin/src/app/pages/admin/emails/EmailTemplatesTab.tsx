import { useState, useEffect, useMemo } from 'react';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  EyeIcon,
  ShareIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Card, Button, Input, Modal, ConfirmModal, Badge } from '@/components/ui';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import EmailTemplateService, { EmailTemplate, CreateEmailTemplateInput, UpdateEmailTemplateInput } from '@/utils/emailTemplateService';
import EmailService from '@/utils/emailService';
import { useAuthContext } from '@/app/contexts/auth/context';

interface TemplateFormData {
  name: string;
  description: string;
  subject: string;
  content_html: string;
  sendgrid_from_key: string;
  template_type: 'sponsor_email' | 'member_email' | 'general';
}

const templateTypeLabels: Record<string, string> = {
  sponsor_email: 'Sponsor Email',
  member_email: 'People Email',
  general: 'General',
};

const templateTypeColors: Record<string, string> = {
  sponsor_email: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  member_email: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  general: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
};

export function EmailTemplatesTab() {
  const { adminProfile } = useAuthContext();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<EmailTemplate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterOwnership, setFilterOwnership] = useState<'all' | 'mine' | 'shared'>('all');

  const fromAddresses = EmailService.getFromAddresses();

  const fromKeyOptions = useMemo(() => {
    const options = [{ label: 'Personal (Not Shared)', value: '' }];
    if (fromAddresses.partners) options.push({ label: `Partners (${fromAddresses.partners})`, value: 'partners' });
    if (fromAddresses.members) options.push({ label: `Members (${fromAddresses.members})`, value: 'members' });
    if (fromAddresses.admin) options.push({ label: `Admin (${fromAddresses.admin})`, value: 'admin' });
    if (fromAddresses.events) options.push({ label: `Events (${fromAddresses.events})`, value: 'events' });
    if (fromAddresses.default) options.push({ label: `Default (${fromAddresses.default})`, value: 'default' });
    return options;
  }, [fromAddresses]);

  const form = useForm<TemplateFormData>({
    defaultValues: {
      name: '',
      description: '',
      subject: '',
      content_html: '',
      sendgrid_from_key: '',
      template_type: 'sponsor_email',
    },
  });

  const isEditing = !!editingTemplate;

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await EmailTemplateService.getAll({ isActive: true });
      setTemplates(data);
    } catch (error) {
      toast.error('Failed to load email templates');
      console.error('Error loading templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (template?: EmailTemplate) => {
    if (template) {
      setEditingTemplate(template);
      form.reset({
        name: template.name,
        description: template.description || '',
        subject: template.subject,
        content_html: template.content_html,
        sendgrid_from_key: template.sendgrid_from_key || '',
        template_type: template.template_type,
      });
    } else {
      setEditingTemplate(null);
      form.reset({
        name: '',
        description: '',
        subject: '',
        content_html: '',
        sendgrid_from_key: '',
        template_type: 'sponsor_email',
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingTemplate(null);
    form.reset();
  };

  const handlePreview = (template: EmailTemplate) => {
    setPreviewTemplate(template);
    setShowPreviewModal(true);
  };

  const onSubmit = async (data: TemplateFormData) => {
    if (!data.content_html.trim()) {
      toast.error('Please enter email content');
      return;
    }

    setSubmitting(true);
    try {
      const templateData = {
        name: data.name,
        description: data.description || undefined,
        subject: data.subject,
        content_html: data.content_html,
        sendgrid_from_key: data.sendgrid_from_key || undefined,
        template_type: data.template_type,
        created_by_admin_id: isEditing ? editingTemplate?.created_by_admin_id : adminProfile?.id,
      };

      if (isEditing) {
        await EmailTemplateService.update(editingTemplate!.id, templateData as UpdateEmailTemplateInput);
        toast.success('Template updated successfully');
      } else {
        await EmailTemplateService.create(templateData as CreateEmailTemplateInput);
        toast.success('Template created successfully');
      }
      handleCloseModal();
      loadTemplates();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save template');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDuplicate = async (template: EmailTemplate) => {
    try {
      await EmailTemplateService.duplicate(template.id);
      toast.success('Template duplicated successfully');
      loadTemplates();
    } catch (error) {
      toast.error('Failed to duplicate template');
    }
  };

  const handleDeleteTemplate = async () => {
    if (!deleteTemplate) return;

    try {
      await EmailTemplateService.delete(deleteTemplate.id);
      toast.success('Template deleted successfully');
      setDeleteTemplate(null);
      loadTemplates();
    } catch (error) {
      toast.error('Failed to delete template');
    }
  };

  const filteredTemplates = templates.filter(t => {
    // Filter by type
    if (filterType !== 'all' && t.template_type !== filterType) return false;

    // Filter by ownership
    if (filterOwnership === 'mine' && t.created_by_admin_id !== adminProfile?.id) return false;
    if (filterOwnership === 'shared' && !t.sendgrid_from_key) return false;

    return true;
  });

  const getOwnershipBadge = (template: EmailTemplate) => {
    if (template.sendgrid_from_key) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300">
          <ShareIcon className="size-3" />
          Shared ({template.sendgrid_from_key})
        </span>
      );
    }
    if (template.created_by_admin_id === adminProfile?.id) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
          <UserIcon className="size-3" />
          Mine
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
        <UserIcon className="size-3" />
        {template.created_by?.name || 'Unknown'}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="medium" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Create and manage reusable email templates with template variables
          </p>
        </div>
        <Button onClick={() => handleOpenModal()} color="primary" className="gap-2">
          <PlusIcon className="size-4" />
          New Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        {/* Type filter */}
        <div className="flex gap-2">
          <Button
            variant={filterType === 'all' ? 'filled' : 'outlined'}
            size="sm"
            onClick={() => setFilterType('all')}
          >
            All Types
          </Button>
          {Object.entries(templateTypeLabels).map(([type, label]) => (
            <Button
              key={type}
              variant={filterType === type ? 'filled' : 'outlined'}
              size="sm"
              onClick={() => setFilterType(type)}
            >
              {label}
            </Button>
          ))}
        </div>

        {/* Ownership filter */}
        <div className="flex gap-2 ml-auto">
          <Button
            variant={filterOwnership === 'all' ? 'filled' : 'outlined'}
            size="sm"
            onClick={() => setFilterOwnership('all')}
          >
            All
          </Button>
          <Button
            variant={filterOwnership === 'mine' ? 'filled' : 'outlined'}
            size="sm"
            onClick={() => setFilterOwnership('mine')}
          >
            My Templates
          </Button>
          <Button
            variant={filterOwnership === 'shared' ? 'filled' : 'outlined'}
            size="sm"
            onClick={() => setFilterOwnership('shared')}
          >
            Shared
          </Button>
        </div>
      </div>

      {/* Template Grid */}
      {filteredTemplates.length === 0 ? (
        <div className="text-center py-12">
          <DocumentTextIcon className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-2 text-gray-500 dark:text-gray-400">No templates found</p>
          <Button onClick={() => handleOpenModal()} color="primary" className="mt-4 gap-2">
            <PlusIcon className="size-4" />
            Create First Template
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => (
            <Card key={template.id} className="p-4 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {template.name}
                  </h3>
                  {template.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      {template.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mb-3">
                <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${templateTypeColors[template.template_type]}`}>
                  {templateTypeLabels[template.template_type]}
                </span>
                {getOwnershipBadge(template)}
              </div>

              <div className="text-xs text-gray-500 dark:text-gray-400 mb-3 space-y-1">
                <div className="truncate">
                  <span className="font-medium">Subject:</span> {template.subject}
                </div>
                {template.usage_count > 0 && (
                  <div>
                    <span className="font-medium">Used:</span> {template.usage_count} times
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => handlePreview(template)}
                  className="gap-1"
                >
                  <EyeIcon className="size-3" />
                  Preview
                </Button>
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => handleOpenModal(template)}
                  className="gap-1"
                >
                  <PencilIcon className="size-3" />
                  Edit
                </Button>
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => handleDuplicate(template)}
                  className="gap-1"
                >
                  <DocumentDuplicateIcon className="size-3" />
                </Button>
                <Button
                  variant="outlined"
                  size="sm"
                  color="error"
                  onClick={() => setDeleteTemplate(template)}
                  className="gap-1"
                >
                  <TrashIcon className="size-3" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Template Editor Modal */}
      <Modal
        isOpen={showModal}
        onClose={handleCloseModal}
        title={isEditing ? 'Edit Template' : 'Create Template'}
        size="2xl"
        footer={
          <div className="flex justify-end gap-3 px-6 py-4">
            <Button type="button" variant="outlined" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button type="submit" color="primary" disabled={submitting} onClick={form.handleSubmit(onSubmit)}>
              {submitting ? 'Saving...' : isEditing ? 'Update Template' : 'Create Template'}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-6">
          {/* Left Column - Template Settings */}
          <div className="space-y-4">
            <Input
              label="Template Name"
              placeholder="e.g., Welcome Sponsor Email"
              {...form.register('name', { required: 'Name is required' })}
              error={form.formState.errors.name?.message}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Template Type
              </label>
              <select
                {...form.register('template_type')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                {Object.entries(templateTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <Input
              label="Description (optional)"
              placeholder="Brief description of when to use this template"
              {...form.register('description')}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Share With (SendGrid From Address)
              </label>
              <select
                {...form.register('sendgrid_from_key')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                {fromKeyOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                When shared, this template will be visible to anyone sending emails from that address
              </p>
            </div>
          </div>

          {/* Right Column - Subject and Content */}
          <div className="space-y-4 flex flex-col">
            <Input
              label="Email Subject"
              placeholder="e.g., Welcome to {{event.name}}!"
              {...form.register('subject', { required: 'Subject is required' })}
              error={form.formState.errors.subject?.message}
            />

            <div className="flex-1 flex flex-col min-h-0">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Email Content
              </label>
              <div className="flex-1 min-h-[400px]">
                <RichTextEditor
                  content={form.watch('content_html')}
                  onChange={(content) => form.setValue('content_html', content)}
                  placeholder="Write your email content here. Use the Variables button to insert dynamic content."
                  templateVariables={{
                    enabled: true,
                    availableScopes: ['customer', 'sponsor', 'event'],
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Preview Modal */}
      <Modal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        title={`Preview: ${previewTemplate?.name || ''}`}
        size="xl"
      >
        {previewTemplate && (
          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
              <p className="text-sm">
                <span className="font-medium text-gray-500 dark:text-gray-400">Subject:</span>{' '}
                <span className="text-gray-900 dark:text-white">{previewTemplate.subject}</span>
              </p>
            </div>
            <div
              className="prose prose-sm dark:prose-invert max-w-none p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
              dangerouslySetInnerHTML={{ __html: previewTemplate.content_html }}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Note: Template variables like {'{{customer.first_name}}'} will be replaced with actual values when sending.
            </p>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteTemplate}
        onClose={() => setDeleteTemplate(null)}
        onConfirm={handleDeleteTemplate}
        title="Delete Template"
        message={`Are you sure you want to delete "${deleteTemplate?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  );
}
