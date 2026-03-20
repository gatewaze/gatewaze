import { useState, useEffect } from 'react';
import { PencilIcon, CheckIcon, XMarkIcon, PlusIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Card, Button, Badge, Table, THead, TBody, Tr, Th, Td, Modal } from '@/components/ui';
import { Input } from '@/components/ui/Form/Input';
import { Spinner } from '@/components/ui/Spinner';
import { supabase } from '@/lib/supabase';

interface TopicLabel {
  id: string;
  list_id: string;
  label: string;
  description: string | null;
  default_subscribed: boolean;
}

interface TopicWithLabel {
  list_id: string;
  label: string | null;
  description: string | null;
  default_subscribed: boolean;
  subscriber_count: number;
}

export function TopicLabelsTab() {
  const [topics, setTopics] = useState<TopicWithLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTopic, setEditingTopic] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ label: '', description: '', default_subscribed: true });
  const [saving, setSaving] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState({ list_id: '', label: '', description: '', default_subscribed: true });
  const [adding, setAdding] = useState(false);
  const [togglingDefault, setTogglingDefault] = useState<string | null>(null);

  useEffect(() => {
    loadTopics();
  }, []);

  const loadTopics = async () => {
    try {
      setLoading(true);

      // Use RPC to get subscriber counts per topic efficiently
      const { data: countData, error: countError } = await supabase
        .rpc('email_get_topic_counts');

      // If RPC doesn't exist, fall back to a simpler approach
      let topicCounts: Record<string, number> = {};

      if (countError) {
        // Fallback: Get distinct topics and count separately
        console.warn('RPC not available, using fallback method');

        // Get distinct topics
        const { data: distinctTopics } = await supabase
          .from('email_subscriptions')
          .select('list_id')
          .limit(1000);

        const uniqueListIds = [...new Set((distinctTopics || []).map((t: { list_id: string }) => t.list_id))];

        // Get count for each topic using count query
        for (const list_id of uniqueListIds) {
          const { count } = await supabase
            .from('email_subscriptions')
            .select('*', { count: 'exact', head: true })
            .eq('list_id', list_id)
            .eq('subscribed', true);

          topicCounts[list_id] = count || 0;
        }
      } else {
        // RPC succeeded
        (countData || []).forEach((item: { list_id: string; count: number }) => {
          topicCounts[item.list_id] = item.count;
        });
      }

      // Get existing labels
      const { data: labels, error: labelsError } = await supabase
        .from('email_topic_labels')
        .select('*');

      if (labelsError) throw labelsError;

      // Create a map of labels
      const labelMap: Record<string, TopicLabel> = {};
      (labels || []).forEach((label: TopicLabel) => {
        labelMap[label.list_id] = label;
      });

      // Get all unique topics
      const allListIds = [...new Set([
        ...Object.keys(topicCounts),
        ...Object.keys(labelMap),
      ])];

      // Combine data
      const combinedTopics: TopicWithLabel[] = allListIds.map((list_id) => ({
        list_id,
        label: labelMap[list_id]?.label || null,
        description: labelMap[list_id]?.description || null,
        default_subscribed: labelMap[list_id]?.default_subscribed ?? true,
        subscriber_count: topicCounts[list_id] || 0,
      }));

      // Sort by list_id (natural sort for topic_1, topic_2, etc.)
      combinedTopics.sort((a, b) => {
        const numA = parseInt(a.list_id.replace('topic_', '')) || 0;
        const numB = parseInt(b.list_id.replace('topic_', '')) || 0;
        return numA - numB;
      });

      setTopics(combinedTopics);
    } catch (error) {
      console.error('Error loading topics:', error);
      toast.error('Failed to load topics');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (topic: TopicWithLabel) => {
    setEditingTopic(topic.list_id);
    setEditForm({
      label: topic.label || '',
      description: topic.description || '',
      default_subscribed: topic.default_subscribed,
    });
  };

  const handleCancel = () => {
    setEditingTopic(null);
    setEditForm({ label: '', description: '', default_subscribed: true });
  };

  const handleToggleDefaultStatus = async (topic: TopicWithLabel) => {
    setTogglingDefault(topic.list_id);
    try {
      const newDefaultSubscribed = !topic.default_subscribed;

      // Check if label exists
      const { data: existing } = await supabase
        .from('email_topic_labels')
        .select('id')
        .eq('list_id', topic.list_id)
        .single();

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('email_topic_labels')
          .update({
            default_subscribed: newDefaultSubscribed,
            updated_at: new Date().toISOString(),
          })
          .eq('list_id', topic.list_id);

        if (error) throw error;
      } else {
        // Insert new with default values
        const { error } = await supabase
          .from('email_topic_labels')
          .insert({
            list_id: topic.list_id,
            label: topic.label || topic.list_id,
            default_subscribed: newDefaultSubscribed,
          });

        if (error) throw error;
      }

      // Update local state
      setTopics(prev =>
        prev.map(t =>
          t.list_id === topic.list_id
            ? { ...t, default_subscribed: newDefaultSubscribed }
            : t
        )
      );

      toast.success(`Default status set to ${newDefaultSubscribed ? 'Subscribed' : 'Unsubscribed'}`);
    } catch (error) {
      console.error('Error toggling default status:', error);
      toast.error('Failed to update default status');
    } finally {
      setTogglingDefault(null);
    }
  };

  const handleSave = async (list_id: string) => {
    if (!editForm.label.trim()) {
      toast.error('Label is required');
      return;
    }

    setSaving(true);
    try {
      // Check if label exists
      const { data: existing } = await supabase
        .from('email_topic_labels')
        .select('id')
        .eq('list_id', list_id)
        .single();

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('email_topic_labels')
          .update({
            label: editForm.label.trim(),
            description: editForm.description.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('list_id', list_id);

        if (error) throw error;
      } else {
        // Insert new
        const { error } = await supabase
          .from('email_topic_labels')
          .insert({
            list_id,
            label: editForm.label.trim(),
            description: editForm.description.trim() || null,
          });

        if (error) throw error;
      }

      toast.success('Topic label saved');
      setEditingTopic(null);
      loadTopics();
    } catch (error) {
      console.error('Error saving topic label:', error);
      toast.error('Failed to save topic label');
    } finally {
      setSaving(false);
    }
  };

  const handleAddTopic = async () => {
    if (!addForm.list_id.trim()) {
      toast.error('Topic ID is required');
      return;
    }
    if (!addForm.label.trim()) {
      toast.error('Label is required');
      return;
    }

    // Check if topic already exists
    if (topics.find(t => t.list_id === addForm.list_id.trim())) {
      toast.error('Topic ID already exists');
      return;
    }

    setAdding(true);
    try {
      const { error } = await supabase
        .from('email_topic_labels')
        .insert({
          list_id: addForm.list_id.trim(),
          label: addForm.label.trim(),
          description: addForm.description.trim() || null,
          default_subscribed: addForm.default_subscribed,
        });

      if (error) throw error;

      toast.success('Topic label added');
      setAddModalOpen(false);
      setAddForm({ list_id: '', label: '', description: '', default_subscribed: true });
      loadTopics();
    } catch (error) {
      console.error('Error adding topic label:', error);
      toast.error('Failed to add topic label');
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <>
    <Card variant="surface" className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Email Topic Labels
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Configure friendly names for email subscription topics. These labels will be displayed on member profiles.
          </p>
        </div>
        <Button
          color="primary"
          onClick={() => setAddModalOpen(true)}
          className="gap-2"
        >
          <PlusIcon className="size-4" />
          Add Topic
        </Button>
      </div>

      <Table>
        <THead>
          <Tr>
            <Th>Topic ID</Th>
            <Th>Friendly Label</Th>
            <Th>Description</Th>
            <Th className="text-center">Default Status</Th>
            <Th className="text-center">Subscribers</Th>
            <Th className="text-right">Actions</Th>
          </Tr>
        </THead>
        <TBody>
          {topics.map((topic) => (
            <Tr key={topic.list_id}>
              <Td>
                <code className="text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                  {topic.list_id}
                </code>
              </Td>
              <Td>
                {editingTopic === topic.list_id ? (
                  <Input
                    value={editForm.label}
                    onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                    placeholder="e.g., Weekly Newsletter"
                    className="w-full"
                    disabled={saving}
                  />
                ) : (
                  topic.label ? (
                    <span className="font-medium text-gray-900 dark:text-white">
                      {topic.label}
                    </span>
                  ) : (
                    <span className="text-gray-400 italic">Not set</span>
                  )
                )}
              </Td>
              <Td>
                {editingTopic === topic.list_id ? (
                  <Input
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="Optional description"
                    className="w-full"
                    disabled={saving}
                  />
                ) : (
                  topic.description ? (
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {topic.description}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )
                )}
              </Td>
              <Td className="text-center">
                <Button
                  variant="ghost"
                  onClick={() => handleToggleDefaultStatus(topic)}
                  disabled={togglingDefault === topic.list_id}
                  title={`Click to set default to ${topic.default_subscribed ? 'Unsubscribed' : 'Subscribed'}`}
                >
                  <Badge
                    variant="soft"
                    color={topic.default_subscribed ? 'success' : 'warning'}
                    className="gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    {togglingDefault === topic.list_id ? (
                      <Spinner className="size-3" />
                    ) : null}
                    {topic.default_subscribed ? 'Subscribed' : 'Unsubscribed'}
                  </Badge>
                </Button>
              </Td>
              <Td className="text-center">
                <Badge variant="soft" color="info">
                  {topic.subscriber_count.toLocaleString()}
                </Badge>
              </Td>
              <Td className="text-right">
                {editingTopic === topic.list_id ? (
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="flat"
                      color="success"
                      isIcon
                      className="size-8"
                      onClick={() => handleSave(topic.list_id)}
                      disabled={saving}
                      title="Save"
                    >
                      {saving ? <Spinner className="size-4" /> : <CheckIcon className="size-4" />}
                    </Button>
                    <Button
                      variant="flat"
                      color="neutral"
                      isIcon
                      className="size-8"
                      onClick={handleCancel}
                      disabled={saving}
                      title="Cancel"
                    >
                      <XMarkIcon className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="flat"
                    color="info"
                    isIcon
                    className="size-8"
                    onClick={() => handleEdit(topic)}
                    title="Edit label"
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      {topics.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No email topics found. Add a topic label or wait for member subscriptions to appear.
        </div>
      )}
    </Card>

    {/* Add Topic Modal */}
    <Modal
      isOpen={addModalOpen}
      onClose={() => {
        setAddModalOpen(false);
        setAddForm({ list_id: '', label: '', description: '', default_subscribed: true });
      }}
      title="Add Topic Label"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setAddModalOpen(false);
              setAddForm({ list_id: '', label: '', description: '', default_subscribed: true });
            }}
            disabled={adding}
          >
            Cancel
          </Button>
          <Button
            color="primary"
            onClick={handleAddTopic}
            disabled={adding}
          >
            {adding ? (
              <span className="flex items-center gap-2">
                <Spinner className="size-4" />
                Adding...
              </span>
            ) : 'Add Topic'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Input
          label="Topic ID"
          value={addForm.list_id}
          onChange={(e) => setAddForm({ ...addForm, list_id: e.target.value })}
          placeholder="e.g., topic_1 or weekly_newsletter"
          disabled={adding}
          description="The unique identifier for this topic (used internally)"
        />
        <Input
          label="Friendly Label"
          value={addForm.label}
          onChange={(e) => setAddForm({ ...addForm, label: e.target.value })}
          placeholder="e.g., Weekly Newsletter"
          disabled={adding}
          description="The name shown to users on member profiles"
        />
        <Input
          label="Description (Optional)"
          value={addForm.description}
          onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
          placeholder="e.g., Our weekly digest of the latest news"
          disabled={adding}
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Default Status
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            The subscription status for users who don't have an explicit subscription record
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={addForm.default_subscribed ? 'soft' : 'outline'}
              color={addForm.default_subscribed ? 'green' : 'gray'}
              onClick={() => setAddForm({ ...addForm, default_subscribed: true })}
              disabled={adding}
            >
              Subscribed
            </Button>
            <Button
              type="button"
              variant={!addForm.default_subscribed ? 'soft' : 'outline'}
              color={!addForm.default_subscribed ? 'orange' : 'gray'}
              onClick={() => setAddForm({ ...addForm, default_subscribed: false })}
              disabled={adding}
            >
              Unsubscribed
            </Button>
          </div>
        </div>
      </div>
    </Modal>
    </>
  );
}
