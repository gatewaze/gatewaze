// @ts-nocheck
import { useState } from 'react';
import {
  PhotoIcon,
  VideoCameraIcon,
  ClockIcon,
  FolderIcon,
  TagIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Card } from '@/components/ui-legacy';
import {
  EventMedia,
  EventMediaAlbum,
  EventMediaAlbumItem,
  EventMediaSponsorTag,
  EventSponsor,
  formatFileSize,
  formatDuration,
  getMediaPublicUrl,
  removeMediaFromAlbum,
  removeSponsorFromMedia,
} from '@/utils/eventMediaService';
import { toast } from 'sonner';

interface MediaGalleryViewProps {
  media: EventMedia[];
  onView: (media: EventMedia) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (mediaId: string) => void;
  newlyAddedIds?: Set<string>;
  albums?: EventMediaAlbum[];
  albumItems?: EventMediaAlbumItem[];
  sponsors?: EventSponsor[];
  sponsorTags?: EventMediaSponsorTag[];
  onRefresh?: () => void;
  columnsCount?: number;
}

export function MediaGalleryView({
  media,
  onView,
  selectedIds = new Set(),
  onToggleSelect,
  newlyAddedIds = new Set(),
  albums = [],
  albumItems = [],
  sponsors = [],
  sponsorTags = [],
  onRefresh,
  columnsCount = 5,
}: MediaGalleryViewProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredAlbumTag, setHoveredAlbumTag] = useState<string | null>(null);
  const [hoveredSponsorTag, setHoveredSponsorTag] = useState<string | null>(null);
  const [deletingTag, setDeletingTag] = useState<string | null>(null);

  // Map columnsCount to Tailwind grid classes (need to use full class names for Tailwind purge)
  const getGridClass = (cols: number) => {
    const classMap: Record<number, string> = {
      3: 'grid-cols-3',
      4: 'grid-cols-4',
      5: 'grid-cols-5',
      6: 'grid-cols-6',
      7: 'grid-cols-7',
      8: 'grid-cols-8',
    };
    return classMap[cols] || 'grid-cols-5';
  };

  const handleRemoveFromAlbum = async (mediaId: string, albumId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const tagId = `album-${mediaId}-${albumId}`;
    if (deletingTag === tagId) return;

    setDeletingTag(tagId);

    try {
      const result = await removeMediaFromAlbum(mediaId, albumId);
      if (result.success) {
        toast.success('Removed from album');
        // Don't call onRefresh - real-time updates will handle it
      } else {
        toast.error('Failed to remove from album');
      }
    } catch (error) {
      console.error('Error removing from album:', error);
      toast.error('Failed to remove from album');
    } finally {
      setDeletingTag(null);
      setHoveredAlbumTag(null);
    }
  };

  const handleRemoveSponsorTag = async (mediaId: string, sponsorId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const tagId = `sponsor-${mediaId}-${sponsorId}`;
    if (deletingTag === tagId) return;

    setDeletingTag(tagId);

    try {
      const result = await removeSponsorFromMedia(mediaId, sponsorId);
      if (result.success) {
        toast.success('Sponsor tag removed');
        // Don't call onRefresh - real-time updates will handle it
      } else {
        toast.error('Failed to remove sponsor tag');
      }
    } catch (error) {
      console.error('Error removing sponsor tag:', error);
      toast.error('Failed to remove sponsor tag');
    } finally {
      setDeletingTag(null);
      setHoveredSponsorTag(null);
    }
  };

  return (
    <div className={`grid gap-4 ${getGridClass(columnsCount)}`}>
      {media.map(item => {
        // Determine display URL based on upload method
        let displayUrl = '';
        if (item.file_type === 'photo') {
          displayUrl = getMediaPublicUrl(item.storage_path, { width: 350, height: 350, quality: 80, resize: 'contain' });
        } else if (item.file_type === 'video') {
          if (item.upload_method === 'youtube' && item.youtube_thumbnail_url) {
            // Use YouTube thumbnail for YouTube videos
            displayUrl = item.youtube_thumbnail_url;
          } else if (item.thumbnail_path) {
            displayUrl = getMediaPublicUrl(item.thumbnail_path);
          } else if (item.storage_path) {
            displayUrl = getMediaPublicUrl(item.storage_path);
          }
        }

        const isHovered = hoveredId === item.id;
        const isSelected = selectedIds.has(item.id);
        const isNewlyAdded = newlyAddedIds.has(item.id);

        // Get albums this media is in
        const mediaAlbums = albumItems
          .filter(ai => ai.media_id === item.id)
          .map(ai => albums.find(a => a.id === ai.album_id))
          .filter(Boolean) as EventMediaAlbum[];

        // Get sponsors tagged on this media
        const mediaSponsors = sponsorTags
          .filter(st => st.media_id === item.id)
          .map(st => sponsors.find(s => s.id === st.event_sponsor_id))
          .filter(Boolean) as EventSponsor[];

        return (
          <Card
            key={item.id}
            className={`group relative overflow-hidden p-0 cursor-pointer transition-all duration-300 ${
              isSelected ? 'ring-2 ring-primary-500' : ''
            } ${
              isNewlyAdded ? 'ring-2 ring-green-500 animate-pulse shadow-lg shadow-green-500/20' : ''
            }`}
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => {
              if (onToggleSelect) {
                onToggleSelect(item.id);
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onView(item);
            }}
          >
            {/* Selection checkbox - always visible on hover or when selected */}
            <div className={`absolute left-2 top-2 z-10 transition-opacity ${
              isSelected || isHovered ? 'opacity-100' : 'opacity-0'
            }`}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleSelect?.(item.id);
                }}
                className="h-5 w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Media Preview */}
            <div className="relative aspect-square bg-gray-100 dark:bg-gray-800">
              {item.file_type === 'photo' ? (
                <img
                  src={displayUrl}
                  alt={item.caption || item.file_name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="relative h-full w-full">
                  {displayUrl ? (
                    <img
                      src={displayUrl}
                      alt={item.caption || item.file_name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <VideoCameraIcon className="h-12 w-12 text-gray-400" />
                    </div>
                  )}
                  {/* YouTube badge for YouTube videos */}
                  {item.upload_method === 'youtube' && (
                    <div className="absolute top-2 left-2 rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                      YouTube
                    </div>
                  )}
                  {/* Video duration badge */}
                  {item.duration && (
                    <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/75 px-2 py-1 text-xs text-white">
                      <ClockIcon className="h-3 w-3" />
                      {formatDuration(item.duration)}
                    </div>
                  )}
                </div>
              )}

              {/* File type indicator - show when not selected */}
              {!isSelected && (
                <div className="absolute right-2 top-2 rounded bg-black/50 p-1">
                  {item.file_type === 'photo' ? (
                    <PhotoIcon className="h-4 w-4 text-white" />
                  ) : (
                    <VideoCameraIcon className="h-4 w-4 text-white" />
                  )}
                </div>
              )}
            </div>

            {/* Media Info */}
            <div className="p-3 space-y-2">
              {/* Albums */}
              {mediaAlbums.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <FolderIcon className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                  <div className="flex flex-wrap gap-1">
                    {mediaAlbums.slice(0, 2).map((album, idx) => {
                      const tagKey = `album-${item.id}-${album.id}`;
                      const isHovered = hoveredAlbumTag === tagKey;
                      const isDeleting = deletingTag === tagKey;

                      return (
                        <span
                          key={album.id}
                          className={`inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-medium text-blue-800 dark:text-blue-400 cursor-pointer transition-all ${
                            isDeleting ? 'opacity-50' : isHovered ? 'pr-1' : ''
                          }`}
                          title={album.name}
                          onMouseEnter={() => setHoveredAlbumTag(tagKey)}
                          onMouseLeave={() => setHoveredAlbumTag(null)}
                          onClick={(e) => handleRemoveFromAlbum(item.id, album.id, e)}
                        >
                          <span>{album.name.length > 10 ? album.name.substring(0, 10) + '...' : album.name}</span>
                          {isHovered && !isDeleting && (
                            <XMarkIcon className="h-3 w-3 text-blue-600 dark:text-blue-300" />
                          )}
                        </span>
                      );
                    })}
                    {mediaAlbums.length > 2 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        +{mediaAlbums.length - 2}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Sponsors */}
              {mediaSponsors.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <TagIcon className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                  <div className="flex flex-wrap gap-1">
                    {mediaSponsors.slice(0, 2).map((sponsor, idx) => {
                      const tagKey = `sponsor-${item.id}-${sponsor.id}`;
                      const isHovered = hoveredSponsorTag === tagKey;
                      const isDeleting = deletingTag === tagKey;
                      const sponsorName = sponsor.sponsor?.name || 'Unknown';

                      return (
                        <span
                          key={sponsor.id}
                          className={`inline-flex items-center gap-1 rounded-full bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-xs font-medium text-purple-800 dark:text-purple-400 cursor-pointer transition-all ${
                            isDeleting ? 'opacity-50' : isHovered ? 'pr-1' : ''
                          }`}
                          title={sponsorName}
                          onMouseEnter={() => setHoveredSponsorTag(tagKey)}
                          onMouseLeave={() => setHoveredSponsorTag(null)}
                          onClick={(e) => handleRemoveSponsorTag(item.id, sponsor.id, e)}
                        >
                          <span>{sponsorName.length > 10 ? sponsorName.substring(0, 10) + '...' : sponsorName}</span>
                          {isHovered && !isDeleting && (
                            <XMarkIcon className="h-3 w-3 text-purple-600 dark:text-purple-300" />
                          )}
                        </span>
                      );
                    })}
                    {mediaSponsors.length > 2 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        +{mediaSponsors.length - 2}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Show placeholder if no albums or sponsors */}
              {mediaAlbums.length === 0 && mediaSponsors.length === 0 && (
                <div className="text-xs text-gray-400 dark:text-gray-500 italic">
                  No tags or albums
                </div>
              )}

              {/* Pending approval badge */}
              {item.uploaded_by === 'attendee' && !item.is_approved && (
                <div>
                  <span className="inline-flex rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                    Pending Approval
                  </span>
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
