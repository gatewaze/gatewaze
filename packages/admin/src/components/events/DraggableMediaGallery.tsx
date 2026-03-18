// @ts-nocheck
import { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
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
  formatDuration,
  getMediaPublicUrl,
  removeMediaFromAlbum,
  removeSponsorFromMedia,
  updateMediaDisplayOrder,
  updateAlbumItemSortOrder,
} from '@/utils/eventMediaService';
import { toast } from 'sonner';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

interface SortableMediaItemProps {
  item: EventMedia;
  isSelected: boolean;
  isDragMode: boolean;
  isNewlyAdded: boolean;
  onToggleSelect?: (mediaId: string) => void;
  onView: (media: EventMedia) => void;
  albums: EventMediaAlbum[];
  albumItems: EventMediaAlbumItem[];
  sponsors: EventSponsor[];
  sponsorTags: EventMediaSponsorTag[];
}

function SortableMediaItem({
  item,
  isSelected,
  isDragMode,
  isNewlyAdded,
  onToggleSelect,
  onView,
  albums,
  albumItems,
  sponsors,
  sponsorTags,
}: SortableMediaItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !isDragMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredAlbumTag, setHoveredAlbumTag] = useState<string | null>(null);
  const [hoveredSponsorTag, setHoveredSponsorTag] = useState<string | null>(null);
  const [deletingTag, setDeletingTag] = useState<string | null>(null);

  const handleRemoveFromAlbum = async (mediaId: string, albumId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const tagId = `album-${mediaId}-${albumId}`;
    if (deletingTag === tagId) return;

    setDeletingTag(tagId);

    try {
      const result = await removeMediaFromAlbum(mediaId, albumId);
      if (result.success) {
        toast.success('Removed from album');
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(isDragMode ? { ...attributes, ...listeners } : {})}
    >
      <Card
        className={`group relative overflow-hidden p-0 transition-all duration-300 ${
          isSelected ? 'ring-2 ring-primary-500' : ''
        } ${
          isNewlyAdded ? 'ring-2 ring-green-500 animate-pulse shadow-lg shadow-green-500/20' : ''
        } ${
          isDragMode ? 'cursor-move' : 'cursor-pointer'
        } ${
          isDragging ? 'z-50' : ''
        }`}
        onMouseEnter={() => setHoveredId(item.id)}
        onMouseLeave={() => setHoveredId(null)}
        onClick={() => {
          if (!isDragMode && onToggleSelect) {
            onToggleSelect(item.id);
          }
        }}
        onDoubleClick={(e) => {
          if (!isDragMode) {
            e.stopPropagation();
            onView(item);
          }
        }}
      >
        {/* Drag indicator when in drag mode */}
        {isDragMode && (
          <div className="absolute top-2 right-2 z-20 bg-black/75 rounded-full p-1.5">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
          </div>
        )}

        {/* Selection checkbox - always visible in selection mode, hidden in drag mode */}
        {!isDragMode && (
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
        )}

        {/* Media Preview */}
        <div className="relative aspect-square bg-gray-100 dark:bg-gray-800">
          {item.file_type === 'photo' ? (
            <img
              src={displayUrl}
              alt={item.caption || item.file_name}
              className="h-full w-full object-cover"
              loading="lazy"
              draggable={false}
            />
          ) : (
            <div className="relative h-full w-full">
              {displayUrl ? (
                <img
                  src={displayUrl}
                  alt={item.caption || item.file_name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <VideoCameraIcon className="h-12 w-12 text-gray-400" />
                </div>
              )}
              {/* YouTube badge for YouTube videos */}
              {item.upload_method === 'youtube' && !isDragMode && (
                <div className="absolute top-2 left-2 rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white z-10">
                  YouTube
                </div>
              )}
              {/* Processing status badge for pending YouTube uploads */}
              {item.youtube_upload_status === 'pending' && !isDragMode && (
                <div className="absolute top-2 left-2 rounded bg-yellow-600 px-2 py-0.5 text-xs font-semibold text-white z-10 flex items-center gap-1">
                  <LoadingSpinner size="small" />
                  Uploading to YouTube
                </div>
              )}
              {item.youtube_upload_status === 'processing' && !isDragMode && (
                <div className="absolute top-2 left-2 rounded bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white z-10 flex items-center gap-1">
                  <LoadingSpinner size="small" />
                  Processing
                </div>
              )}
              {item.youtube_upload_status === 'failed' && !isDragMode && (
                <div className="absolute top-2 left-2 rounded bg-red-800 px-2 py-0.5 text-xs font-semibold text-white z-10" title={item.youtube_error_message || 'Upload failed'}>
                  Upload Failed
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

          {/* File type indicator - show when not selected and not in drag mode */}
          {!isSelected && !isDragMode && (
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
        <div className={`p-3 space-y-2 ${isDragMode ? 'opacity-60' : ''}`}>
            {/* Albums */}
            {mediaAlbums.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <FolderIcon className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                <div className="flex flex-wrap gap-1">
                  {mediaAlbums.slice(0, 2).map((album) => {
                    const tagKey = `album-${item.id}-${album.id}`;
                    const isHovered = hoveredAlbumTag === tagKey;
                    const isDeleting = deletingTag === tagKey;

                    return (
                      <span
                        key={album.id}
                        className={`inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-medium text-blue-800 dark:text-blue-400 ${isDragMode ? 'cursor-move' : 'cursor-pointer'} transition-all ${
                          isDeleting ? 'opacity-50' : isHovered ? 'pr-1' : ''
                        }`}
                        title={album.name}
                        onMouseEnter={() => !isDragMode && setHoveredAlbumTag(tagKey)}
                        onMouseLeave={() => !isDragMode && setHoveredAlbumTag(null)}
                        onClick={(e) => !isDragMode && handleRemoveFromAlbum(item.id, album.id, e)}
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
                  {mediaSponsors.slice(0, 2).map((sponsor) => {
                    const tagKey = `sponsor-${item.id}-${sponsor.id}`;
                    const isHovered = hoveredSponsorTag === tagKey;
                    const isDeleting = deletingTag === tagKey;
                    const sponsorName = sponsor.sponsor?.name || 'Unknown';

                    return (
                      <span
                        key={sponsor.id}
                        className={`inline-flex items-center gap-1 rounded-full bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-xs font-medium text-purple-800 dark:text-purple-400 ${isDragMode ? 'cursor-move' : 'cursor-pointer'} transition-all ${
                          isDeleting ? 'opacity-50' : isHovered ? 'pr-1' : ''
                        }`}
                        title={sponsorName}
                        onMouseEnter={() => !isDragMode && setHoveredSponsorTag(tagKey)}
                        onMouseLeave={() => !isDragMode && setHoveredSponsorTag(null)}
                        onClick={(e) => !isDragMode && handleRemoveSponsorTag(item.id, sponsor.id, e)}
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
    </div>
  );
}

interface DraggableMediaGalleryProps {
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
  isDragMode: boolean;
  selectedAlbum?: string | null;
  onOrderChange?: (newOrder: EventMedia[]) => void;
  columnsCount?: number;
}

export function DraggableMediaGallery({
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
  isDragMode,
  selectedAlbum,
  onOrderChange,
  columnsCount = 5,
}: DraggableMediaGalleryProps) {
  const [items, setItems] = useState(media);
  const [activeId, setActiveId] = useState<string | null>(null);

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

  // Update local items when media prop changes
  useEffect(() => {
    setItems(media);
  }, [media]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex(item => item.id === active.id);
      const newIndex = items.findIndex(item => item.id === over.id);

      const newItems = arrayMove(items, oldIndex, newIndex);
      setItems(newItems);

      // Update order in database
      try {
        if (selectedAlbum) {
          // Update album-specific sort order
          const updates = newItems.map((item, index) => ({
            mediaId: item.id,
            albumId: selectedAlbum,
            sortOrder: index * 10,
          }));

          // Batch update for better performance
          await Promise.all(
            updates.map(update =>
              updateAlbumItemSortOrder(update.mediaId, update.albumId, update.sortOrder)
            )
          );

          toast.success('Album order updated');
        } else {
          // For general display order, only swap the affected items
          const draggedItem = items[oldIndex];
          const targetItem = items[newIndex];

          // Get the display_order values
          const draggedOrder = draggedItem.display_order || 0;
          const targetOrder = targetItem.display_order || 0;

          // If we're moving forward (oldIndex < newIndex), we need to shift items backwards
          // If we're moving backward (oldIndex > newIndex), we need to shift items forward
          const updates: Array<{id: string, display_order: number}> = [];

          if (oldIndex < newIndex) {
            // Moving forward: shift items between old and new position backwards
            let prevOrder = draggedOrder;
            for (let i = oldIndex + 1; i <= newIndex; i++) {
              const currentItem = items[i];
              const currentOrder = currentItem.display_order || 0;
              updates.push({
                id: currentItem.id,
                display_order: prevOrder,
              });
              prevOrder = currentOrder;
            }
            // Place the dragged item at the target position
            updates.push({
              id: draggedItem.id,
              display_order: targetOrder,
            });
          } else {
            // Moving backward: shift items between new and old position forward
            let prevOrder = draggedOrder;
            for (let i = oldIndex - 1; i >= newIndex; i--) {
              const currentItem = items[i];
              const currentOrder = currentItem.display_order || 0;
              updates.push({
                id: currentItem.id,
                display_order: prevOrder,
              });
              prevOrder = currentOrder;
            }
            // Place the dragged item at the target position
            updates.push({
              id: draggedItem.id,
              display_order: targetOrder,
            });
          }

          // Update the local state with swapped display orders
          const updatedItems = newItems.map(item => {
            const update = updates.find(u => u.id === item.id);
            if (update) {
              return { ...item, display_order: update.display_order };
            }
            return item;
          });
          setItems(updatedItems);

          // Batch update for better performance
          await Promise.all(
            updates.map(update =>
              updateMediaDisplayOrder(update.id, update.display_order)
            )
          );

          // Update parent component's state
          if (onOrderChange) {
            onOrderChange(updatedItems);
          }

          toast.success('Display order updated');
        }
      } catch (error) {
        console.error('Failed to update order:', error);
        toast.error('Failed to save order');
        // Revert to original order
        setItems(media);
      }
    }

    setActiveId(null);
  };

  const activeItem = activeId ? items.find(item => item.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map(item => item.id)}
        strategy={rectSortingStrategy}
      >
        <div className={`grid gap-4 ${getGridClass(columnsCount)}`}>
          {items.map(item => (
            <SortableMediaItem
              key={item.id}
              item={item}
              isSelected={selectedIds.has(item.id)}
              isDragMode={isDragMode}
              isNewlyAdded={newlyAddedIds.has(item.id)}
              onToggleSelect={onToggleSelect}
              onView={onView}
              albums={albums}
              albumItems={albumItems}
              sponsors={sponsors}
              sponsorTags={sponsorTags}
            />
          ))}
        </div>
      </SortableContext>

      <DragOverlay>
        {activeItem ? (
          <Card className="opacity-80 shadow-2xl">
            <div className="relative aspect-square bg-gray-100 dark:bg-gray-800">
              {activeItem.file_type === 'photo' ? (
                <img
                  src={getMediaPublicUrl(activeItem.storage_path, { width: 350, height: 350, quality: 80, resize: 'contain' })}
                  alt={activeItem.caption || activeItem.file_name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <VideoCameraIcon className="h-12 w-12 text-gray-400" />
                </div>
              )}
            </div>
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}