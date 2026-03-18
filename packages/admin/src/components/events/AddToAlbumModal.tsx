// @ts-nocheck
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Modal } from '@/components/ui-legacy';
import { EventMediaAlbum, addMediaToAlbums } from '@/utils/eventMediaService';

interface AddToAlbumModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  albums: EventMediaAlbum[];
  selectedMediaIds: string[];
}

export function AddToAlbumModal({
  isOpen,
  onClose,
  onSuccess,
  albums,
  selectedMediaIds,
}: AddToAlbumModalProps) {
  const [selectedAlbums, setSelectedAlbums] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Sort albums alphabetically by name
  const sortedAlbums = [...albums].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const handleToggleAlbum = (albumId: string) => {
    setSelectedAlbums(prev =>
      prev.includes(albumId)
        ? prev.filter(id => id !== albumId)
        : [...prev, albumId]
    );
  };

  const handleSubmit = async () => {
    if (selectedAlbums.length === 0) {
      toast.error('Please select at least one album');
      return;
    }

    try {
      setLoading(true);

      // Add each media item to the selected albums
      for (const mediaId of selectedMediaIds) {
        const result = await addMediaToAlbums(mediaId, selectedAlbums);
        if (!result.success) {
          throw new Error(result.error || 'Failed to add media to albums');
        }
      }

      toast.success(
        `Added ${selectedMediaIds.length} item(s) to ${selectedAlbums.length} album(s)`
      );
      onSuccess();
      handleClose();
    } catch (error) {
      console.error('Error adding to albums:', error);
      toast.error('Failed to add media to albums');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSelectedAlbums([]);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add to Albums"
      size="md"
      footer={
        <div className="flex justify-end gap-3 p-4">
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || selectedAlbums.length === 0 || albums.length === 0}
          >
            {loading ? 'Adding...' : 'Add to Albums'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Select albums to add {selectedMediaIds.length} selected item(s) to:
        </p>

        {sortedAlbums.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No albums available. Create an album first.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedAlbums.map(album => (
              <label
                key={album.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={selectedAlbums.includes(album.id)}
                  onChange={() => handleToggleAlbum(album.id)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900 dark:text-white">
                    {album.name}
                  </div>
                  {album.description && (
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {album.description}
                    </div>
                  )}
                  {album.media_count !== undefined && (
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      {album.media_count} items
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}