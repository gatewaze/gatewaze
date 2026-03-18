// @ts-nocheck
import { useState } from 'react';
import { toast } from 'sonner';
import {
  XMarkIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  FolderIcon,
} from '@heroicons/react/24/outline';
import { Button, Modal, Input, ConfirmModal } from '@/components/ui-legacy';
import {
  EventMediaAlbum,
  createEventAlbum,
  updateEventAlbum,
  deleteEventAlbum,
} from '@/utils/eventMediaService';

interface AlbumManagementModalProps {
  eventId: string;
  albums: EventMediaAlbum[];
  onClose: () => void;
  onSuccess: () => void;
}

interface AlbumFormData {
  name: string;
  description: string;
}

export function AlbumManagementModal({
  eventId,
  albums,
  onClose,
  onSuccess,
}: AlbumManagementModalProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingAlbum, setEditingAlbum] = useState<EventMediaAlbum | null>(null);
  const [formData, setFormData] = useState<AlbumFormData>({
    name: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  const handleAddAlbum = () => {
    setEditingAlbum(null);
    setFormData({ name: '', description: '' });
    setShowForm(true);
  };

  const handleEditAlbum = (album: EventMediaAlbum) => {
    setEditingAlbum(album);
    setFormData({
      name: album.name,
      description: album.description || '',
    });
    setShowForm(true);
  };

  const handleSaveAlbum = async () => {
    if (!formData.name.trim()) {
      toast.error('Album name is required');
      return;
    }

    setSaving(true);
    try {
      if (editingAlbum) {
        // Update existing album
        const { data, error } = await updateEventAlbum(editingAlbum.id, {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
        });

        if (error) {
          throw new Error(error.message);
        }

        toast.success('Album updated successfully');
      } else {
        // Create new album
        const { data, error } = await createEventAlbum(
          eventId,
          formData.name.trim(),
          formData.description.trim() || undefined
        );

        if (error) {
          throw new Error(error.message);
        }

        toast.success('Album created successfully');
      }

      setShowForm(false);
      setFormData({ name: '', description: '' });
      setEditingAlbum(null);
      onSuccess();
    } catch (error) {
      console.error('Error saving album:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save album');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAlbumClick = (albumId: string, albumName: string) => {
    setDeleteConfirm({ id: albumId, name: albumName });
  };

  const confirmDeleteAlbum = async () => {
    if (!deleteConfirm) return;

    try {
      const result = await deleteEventAlbum(deleteConfirm.id);
      if (result.success) {
        toast.success('Album deleted successfully');
        onSuccess();
      } else {
        toast.error(result.error || 'Failed to delete album');
      }
    } catch (error) {
      console.error('Error deleting album:', error);
      toast.error('Failed to delete album');
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setFormData({ name: '', description: '' });
    setEditingAlbum(null);
  };

  return (
    <Modal isOpen={true} onClose={onClose} size="md">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Manage Albums
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Album Form */}
        {showForm && (
          <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-surface-3">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">
              {editingAlbum ? 'Edit Album' : 'New Album'}
            </h3>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
                Album Name <span className="text-red-500">*</span>
              </label>
              <Input
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter album name"
                disabled={saving}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
                Description (optional)
              </label>
              <textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter album description"
                disabled={saving}
                rows={3}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50 dark:border-gray-600 dark:bg-surface-2 dark:text-white dark:placeholder-gray-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCancelForm}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveAlbum} disabled={saving}>
                {saving ? 'Saving...' : editingAlbum ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        )}

        {/* Add Album Button */}
        {!showForm && (
          <Button onClick={handleAddAlbum} className="w-full">
            <PlusIcon className="mr-2 h-4 w-4" />
            Add New Album
          </Button>
        )}

        {/* Albums List */}
        <div className="space-y-2">
          {albums.length === 0 ? (
            <div className="py-12 text-center">
              <FolderIcon className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                No albums yet. Create your first album to organize media.
              </p>
            </div>
          ) : (
            albums.map(album => (
              <div
                key={album.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FolderIcon className="h-5 w-5 flex-shrink-0 text-primary-600 dark:text-primary-400" />
                    <h3 className="font-medium text-gray-900 dark:text-white">
                      {album.name}
                    </h3>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      ({album.media_count || 0} items)
                    </span>
                  </div>
                  {album.description && (
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      {album.description}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditAlbum(album)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-surface-3 dark:hover:text-gray-300"
                    title="Edit album"
                  >
                    <PencilIcon className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleDeleteAlbumClick(album.id, album.name)}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    title="Delete album"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Close Button */}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <ConfirmModal
          isOpen={true}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={confirmDeleteAlbum}
          title="Delete Album?"
          message={`Are you sure you want to delete the album "${deleteConfirm.name}"? Media files will not be deleted.`}
          confirmText="Delete"
          confirmColor="red"
        />
      )}
    </Modal>
  );
}
