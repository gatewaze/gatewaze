// @ts-nocheck
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Modal } from '@/components/ui-legacy';
import { EventSponsor, addMediaToSponsors } from '@/utils/eventMediaService';

interface TagSponsorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  sponsors: EventSponsor[];
  selectedMediaIds: string[];
}

export function TagSponsorsModal({
  isOpen,
  onClose,
  onSuccess,
  sponsors,
  selectedMediaIds,
}: TagSponsorsModalProps) {
  const [selectedSponsors, setSelectedSponsors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Sort sponsors alphabetically by name
  const sortedSponsors = [...sponsors].sort((a, b) =>
    a.sponsor.name.localeCompare(b.sponsor.name)
  );

  const handleToggleSponsor = (eventSponsorId: string) => {
    setSelectedSponsors(prev =>
      prev.includes(eventSponsorId)
        ? prev.filter(id => id !== eventSponsorId)
        : [...prev, eventSponsorId]
    );
  };

  const handleSubmit = async () => {
    if (selectedSponsors.length === 0) {
      toast.error('Please select at least one sponsor');
      return;
    }

    try {
      setLoading(true);

      let successCount = 0;
      let errorCount = 0;

      // Add each media item to the selected sponsors
      for (const mediaId of selectedMediaIds) {
        const result = await addMediaToSponsors(mediaId, selectedSponsors);
        if (result.success) {
          successCount++;
        } else {
          errorCount++;
          console.warn(`Failed to tag media ${mediaId}:`, result.error);
        }
      }

      if (errorCount === 0) {
        toast.success(
          `Successfully tagged ${successCount} item(s) with ${selectedSponsors.length} sponsor(s)`
        );
      } else if (successCount > 0) {
        toast.warning(
          `Tagged ${successCount} item(s), ${errorCount} item(s) may have been already tagged`
        );
      } else {
        toast.error('Failed to tag items - they may already be tagged with these sponsors');
      }

      onSuccess();
      handleClose();
    } catch (error) {
      console.error('Error tagging sponsors:', error);
      toast.error('Failed to tag sponsors');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSelectedSponsors([]);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Tag Sponsors"
      size="md"
      footer={
        <div className="flex justify-end gap-3 p-4">
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || selectedSponsors.length === 0 || sponsors.length === 0}
          >
            {loading ? 'Tagging...' : 'Tag Sponsors'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Select sponsors to tag in {selectedMediaIds.length} selected item(s):
        </p>

        {sortedSponsors.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No sponsors available for this event.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedSponsors.map(eventSponsor => (
              <label
                key={eventSponsor.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={selectedSponsors.includes(eventSponsor.id)}
                  onChange={() => handleToggleSponsor(eventSponsor.id)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <div className="flex flex-1 items-center gap-3">
                  {eventSponsor.sponsor.logo_url && (
                    <img
                      src={eventSponsor.sponsor.logo_url}
                      alt={eventSponsor.sponsor.name}
                      className="h-10 w-10 rounded object-contain"
                    />
                  )}
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {eventSponsor.sponsor.name}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span className="capitalize">{eventSponsor.sponsorship_tier}</span>
                      {eventSponsor.booth_number && (
                        <>
                          <span>•</span>
                          <span>Booth {eventSponsor.booth_number}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}