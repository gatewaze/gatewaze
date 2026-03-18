// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  PhotoIcon,
  VideoCameraIcon,
  FolderIcon,
  PlusIcon,
  TrashIcon,
  ArrowUpTrayIcon,
  EyeIcon,
  FunnelIcon,
  XMarkIcon,
  TagIcon,
  ArrowsUpDownIcon,
  ArrowsPointingOutIcon,
} from '@heroicons/react/24/outline';
import { Button, Card, ConfirmModal } from '@/components/ui-legacy';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import {
  EventMedia,
  EventMediaAlbum,
  EventMediaAlbumItem,
  EventMediaSponsorTag,
  EventSponsor,
  getEventMedia,
  getEventAlbums,
  getEventAlbumItems,
  getEventSponsors,
  getEventMediaSponsorTags,
  deleteEventMedia,
  deleteBulkEventMedia,
  deleteEventAlbum,
  formatFileSize,
  formatDuration,
  getMediaPublicUrl,
} from '@/utils/eventMediaService';
import { MediaUploadModal } from './MediaUploadModal';
import { AlbumManagementModal } from './AlbumManagementModal';
import { MediaGalleryView } from './MediaGalleryView';
import { DraggableMediaGallery } from './DraggableMediaGallery';
import { MediaViewerModal } from './MediaViewerModal';
import { AddToAlbumModal } from './AddToAlbumModal';
import { TagSponsorsModal } from './TagSponsorsModal';
import { supabase } from '@/lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

interface EventMediaTabProps {
  eventId: string; // The event code (events.event_id)
}

type ViewMode = 'grid' | 'list';
type FilterType = 'all' | 'photos' | 'videos';
type SortOption = 'upload_newest' | 'upload_oldest' | 'name_asc' | 'name_desc' | 'custom';

export function EventMediaTab({ eventId }: EventMediaTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [media, setMedia] = useState<EventMedia[]>([]);
  const [albums, setAlbums] = useState<EventMediaAlbum[]>([]);
  const [albumItems, setAlbumItems] = useState<EventMediaAlbumItem[]>([]);
  const [sponsors, setSponsors] = useState<EventSponsor[]>([]);
  const [sponsorTags, setSponsorTags] = useState<EventMediaSponsorTag[]>([]);
  const [selectedSponsor, setSelectedSponsor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [sortOption, setSortOption] = useState<SortOption>('upload_newest');
  const [isDragMode, setIsDragMode] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showAlbumModal, setShowAlbumModal] = useState(false);
  const [showAddToAlbumModal, setShowAddToAlbumModal] = useState(false);
  const [showTagSponsorsModal, setShowTagSponsorsModal] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<EventMedia | null>(null);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set());
  const [thumbnailSize, setThumbnailSize] = useState<number>(5); // Default to 5 columns
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'media' | 'album' | 'bulk';
    id?: string;
    ids?: string[];
    name: string;
  } | null>(null);

  // Store subscription channel ref and real-time status
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [isRealTimeActive, setIsRealTimeActive] = useState(false);
  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  }, [eventId]);

  // Check for sponsor filter from URL query params
  useEffect(() => {
    const sponsorId = searchParams.get('sponsorId');
    if (sponsorId) {
      setSelectedSponsor(sponsorId);
    }
  }, [searchParams]);

  // Set up real-time subscriptions for database changes
  useEffect(() => {
    if (!supabase || !eventId) return;

    // Create a single channel for all subscriptions
    const channel = supabase
      .channel(`event-media-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'event_media',
          filter: `event_id=eq.${eventId}`,
        },
        async (payload) => {
          console.log('Media change detected:', payload);

          // Handle different event types for incremental updates
          if (payload.eventType === 'INSERT' && payload.new) {
            // Add new media item without full reload
            const newMedia = payload.new as EventMedia;
            setMedia(prev => [newMedia, ...prev]);

            // Mark as newly added for animation
            setNewlyAddedIds(prev => new Set(prev).add(newMedia.id));

            // Remove the "new" marker after animation completes
            setTimeout(() => {
              setNewlyAddedIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(newMedia.id);
                return newSet;
              });
            }, 3000);

            // Show subtle notification
            toast.success(`New ${newMedia.file_type} added: ${newMedia.file_name}`, {
              duration: 2000,
              position: 'bottom-right',
            });
          } else if (payload.eventType === 'DELETE' && payload.old) {
            // Remove deleted media item
            const deletedId = (payload.old as any).id;
            setMedia(prev => prev.filter(m => m.id !== deletedId));

            // Remove from selected items if it was selected
            setSelectedMediaIds(prev => {
              const newSet = new Set(prev);
              newSet.delete(deletedId);
              return newSet;
            });

            toast.info('Media deleted', {
              duration: 1500,
              position: 'bottom-right',
            });
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            // Update existing media item
            const updatedMedia = payload.new as EventMedia;
            const oldMedia = media.find(m => m.id === updatedMedia.id);

            // Check if display_order changed
            if (oldMedia && oldMedia.display_order !== updatedMedia.display_order) {
              toast.info('Media order updated by another user', {
                duration: 2000,
                position: 'bottom-right',
              });
            }

            setMedia(prev => prev.map(m =>
              m.id === updatedMedia.id ? updatedMedia : m
            ));
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_media_albums',
          filter: `event_id=eq.${eventId}`,
        },
        async (payload) => {
          console.log('Album change detected:', payload);

          if (payload.eventType === 'INSERT' && payload.new) {
            // Add new album
            const newAlbum = payload.new as EventMediaAlbum;
            setAlbums(prev => [...prev, newAlbum]);

            toast.success(`Album created: ${newAlbum.name}`, {
              duration: 2000,
              position: 'bottom-right',
            });
          } else if (payload.eventType === 'DELETE' && payload.old) {
            // Remove deleted album
            const deletedId = (payload.old as any).id;
            setAlbums(prev => prev.filter(a => a.id !== deletedId));

            // Clear selection if this album was selected
            if (selectedAlbum === deletedId) {
              setSelectedAlbum(null);
            }

            toast.info('Album deleted', {
              duration: 1500,
              position: 'bottom-right',
            });
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            // Update existing album
            const updatedAlbum = payload.new as EventMediaAlbum;
            setAlbums(prev => prev.map(a =>
              a.id === updatedAlbum.id ? updatedAlbum : a
            ));
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_media_album_items',
        },
        async (payload) => {
          console.log('Album items change detected:', payload);

          // For album items, we need to reload the album items
          // But we can do it more efficiently
          if (payload.eventType === 'INSERT' && payload.new) {
            const newItem = payload.new as EventMediaAlbumItem;
            setAlbumItems(prev => [...prev, newItem]);
            // Count is now calculated dynamically from albumItems
          } else if (payload.eventType === 'DELETE' && payload.old) {
            const deletedItem = payload.old as any;
            console.log('Album item deleted:', deletedItem);
            setAlbumItems(prev => {
              // Try matching by id first, then fall back to composite key
              const filtered = prev.filter(item => {
                if (deletedItem.id) {
                  return item.id !== deletedItem.id;
                }
                return !(item.media_id === deletedItem.media_id && item.album_id === deletedItem.album_id);
              });
              console.log('Album items before delete:', prev.length, 'after:', filtered.length);
              return filtered;
            });
            // Count is now calculated dynamically from albumItems
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            // Update existing album item (sort order change)
            const updatedItem = payload.new as EventMediaAlbumItem;
            const oldItem = albumItems.find(item => item.id === updatedItem.id);

            // Check if sort_order changed
            if (oldItem && oldItem.sort_order !== updatedItem.sort_order && selectedAlbum === updatedItem.album_id) {
              toast.info('Album order updated by another user', {
                duration: 2000,
                position: 'bottom-right',
              });
            }

            setAlbumItems(prev => prev.map(item =>
              item.id === updatedItem.id ? updatedItem : item
            ));
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_media_sponsor_tags',
        },
        async (payload) => {
          console.log('Sponsor tags change detected:', payload);

          // For sponsor tags, update incrementally
          if (payload.eventType === 'INSERT' && payload.new) {
            const newTag = payload.new as EventMediaSponsorTag;
            console.log('New sponsor tag added:', newTag);
            setSponsorTags(prev => [...prev, newTag]);
          } else if (payload.eventType === 'DELETE' && payload.old) {
            const deletedTag = payload.old as any;
            console.log('Sponsor tag deleted:', deletedTag);
            setSponsorTags(prev => {
              // Try matching by id first, then fall back to composite key
              const filtered = prev.filter(tag => {
                if (deletedTag.id) {
                  return tag.id !== deletedTag.id;
                }
                return !(tag.media_id === deletedTag.media_id && tag.event_sponsor_id === deletedTag.event_sponsor_id);
              });
              console.log('Sponsor tags before delete:', prev.length, 'after:', filtered.length);
              return filtered;
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Real-time subscription established for event ${eventId}`);
          setIsRealTimeActive(true);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Real-time subscription error');
          setIsRealTimeActive(false);
        }
      });

    // Store the channel reference
    channelRef.current = channel;

    // Cleanup on unmount or when eventId changes
    return () => {
      if (channelRef.current) {
        console.log(`Unsubscribing from real-time updates for event ${eventId}`);
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        setIsRealTimeActive(false);
      }
    };
  }, [eventId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [mediaResult, albumsResult, albumItemsResult, sponsorsResult, sponsorTagsResult] = await Promise.all([
        getEventMedia(eventId),
        getEventAlbums(eventId),
        getEventAlbumItems(eventId),
        getEventSponsors(eventId),
        getEventMediaSponsorTags(eventId),
      ]);

      if (mediaResult.error) {
        throw new Error(mediaResult.error.message);
      }
      if (albumsResult.error) {
        throw new Error(albumsResult.error.message);
      }
      if (albumItemsResult.error) {
        console.warn('Error loading album items:', albumItemsResult.error);
      }
      if (sponsorsResult.error) {
        console.warn('Error loading sponsors:', sponsorsResult.error);
      }
      if (sponsorTagsResult.error) {
        console.warn('Error loading sponsor tags:', sponsorTagsResult.error);
      }

      setMedia(mediaResult.data || []);
      setAlbums(albumsResult.data || []);
      setAlbumItems(albumItemsResult.data || []);
      setSponsors(sponsorsResult.data || []);
      setSponsorTags(sponsorTagsResult.data || []);
    } catch (error) {
      console.error('Error loading media:', error);
      toast.error('Failed to load media');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMedia = async (mediaId: string, fileName: string) => {
    setDeleteConfirm({
      type: 'media',
      id: mediaId,
      name: fileName,
    });
  };

  const handleDeleteAlbumClick = (albumId: string, albumName: string) => {
    setDeleteConfirm({
      type: 'album',
      id: albumId,
      name: albumName,
    });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    try {
      if (deleteConfirm.type === 'media') {
        const result = await deleteEventMedia(deleteConfirm.id!);
        if (result.success) {
          toast.success('Media deleted successfully');
          loadData();
        } else {
          toast.error(result.error || 'Failed to delete media');
        }
      } else if (deleteConfirm.type === 'bulk') {
        const result = await deleteBulkEventMedia(deleteConfirm.ids!);
        if (result.success) {
          toast.success(`Successfully deleted ${result.successCount} item(s)`);
          setSelectedMediaIds(new Set()); // Clear selection
          loadData();
        } else {
          toast.error(result.errors[0]?.error || 'Failed to delete media');
        }
      } else {
        const result = await deleteEventAlbum(deleteConfirm.id!);
        if (result.success) {
          toast.success('Album deleted successfully');
          if (selectedAlbum === deleteConfirm.id) {
            setSelectedAlbum(null);
          }
          loadData();
        } else {
          toast.error(result.error || 'Failed to delete album');
        }
      }
    } catch (error) {
      console.error('Error deleting:', error);
      toast.error(`Failed to delete ${deleteConfirm.type}`);
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleToggleSelect = (mediaId: string) => {
    setSelectedMediaIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(mediaId)) {
        newSet.delete(mediaId);
      } else {
        newSet.add(mediaId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedMediaIds.size === sortedMedia.length) {
      setSelectedMediaIds(new Set());
    } else {
      setSelectedMediaIds(new Set(sortedMedia.map(m => m.id)));
    }
  };

  const handleCancelSelection = () => {
    setSelectedMediaIds(new Set());
  };

  const handleAddToAlbum = () => {
    if (selectedMediaIds.size === 0) {
      toast.error('Please select at least one item');
      return;
    }
    setShowAddToAlbumModal(true);
  };

  const handleTagSponsors = () => {
    if (selectedMediaIds.size === 0) {
      toast.error('Please select at least one item');
      return;
    }
    setShowTagSponsorsModal(true);
  };

  const handleBulkDelete = () => {
    if (selectedMediaIds.size === 0) {
      toast.error('Please select at least one item');
      return;
    }
    setDeleteConfirm({
      type: 'bulk',
      ids: Array.from(selectedMediaIds),
      name: `${selectedMediaIds.size} item(s)`,
    });
  };

  const filteredMedia = media.filter(item => {
    // Filter by type
    if (filterType === 'photos' && item.file_type !== 'photo') return false;
    if (filterType === 'videos' && item.file_type !== 'video') return false;

    // Filter by album
    if (selectedAlbum) {
      // Check if this media item is in the selected album
      const isInAlbum = albumItems.some(
        albumItem => albumItem.album_id === selectedAlbum && albumItem.media_id === item.id
      );
      if (!isInAlbum) return false;
    }

    // Filter by sponsor
    if (selectedSponsor) {
      // Check if this media item is tagged with the selected sponsor
      const isTaggedWithSponsor = sponsorTags.some(
        tag => tag.event_sponsor_id === selectedSponsor && tag.media_id === item.id
      );
      if (!isTaggedWithSponsor) return false;
    }

    return true;
  });

  // Apply sorting
  const sortedMedia = [...filteredMedia].sort((a, b) => {
    // If viewing an album and using custom sort, use album-specific sort order
    if (selectedAlbum && sortOption === 'custom') {
      const aAlbumItem = albumItems.find(item => item.album_id === selectedAlbum && item.media_id === a.id);
      const bAlbumItem = albumItems.find(item => item.album_id === selectedAlbum && item.media_id === b.id);

      if (aAlbumItem && bAlbumItem) {
        return aAlbumItem.sort_order - bAlbumItem.sort_order;
      }
    }

    switch (sortOption) {
      case 'upload_newest':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'upload_oldest':
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      case 'name_asc':
        return a.file_name.localeCompare(b.file_name);
      case 'name_desc':
        return b.file_name.localeCompare(a.file_name);
      case 'custom':
        // Use display_order field for all media view
        // If display_order is not set (0 or undefined), treat as very high number to push to end
        const aOrder = a.display_order !== undefined && a.display_order !== 0 ? a.display_order : Number.MAX_SAFE_INTEGER;
        const bOrder = b.display_order !== undefined && b.display_order !== 0 ? b.display_order : Number.MAX_SAFE_INTEGER;

        if (aOrder === Number.MAX_SAFE_INTEGER && bOrder === Number.MAX_SAFE_INTEGER) {
          // If both have no custom order set, sort by creation date (newest first)
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }

        return aOrder - bOrder;
      default:
        return 0;
    }
  });

  const photoCount = media.filter(m => m.file_type === 'photo').length;
  const videoCount = media.filter(m => m.file_type === 'video').length;
  const totalSize = media.reduce((acc, m) => acc + m.file_size, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="medium" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center">
            <PhotoIcon className="h-8 w-8 text-primary-600 dark:text-primary-400" />
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Photos</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{photoCount}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center">
            <VideoCameraIcon className="h-8 w-8 text-primary-600 dark:text-primary-400" />
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Videos</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{videoCount}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center">
            <FolderIcon className="h-8 w-8 text-primary-600 dark:text-primary-400" />
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Albums</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{albums.length}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center">
            <ArrowUpTrayIcon className="h-8 w-8 text-primary-600 dark:text-primary-400" />
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Size</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{formatFileSize(totalSize)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Action Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {selectedMediaIds.size > 0 ? (
          <>
            {/* Sticky action bar for selected items */}
            <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-sm dark:border-gray-700 dark:bg-gray-900/95 p-4 shadow-lg md:hidden">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {selectedMediaIds.size} selected
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={handleAddToAlbum}
                    size="sm"
                    variant="primary"
                  >
                    <FolderIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={handleTagSponsors}
                    size="sm"
                    variant="primary"
                  >
                    <TagIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleBulkDelete}
                    size="sm"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelSelection}
                    size="sm"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Desktop sticky action bar */}
            <div className="hidden md:block">
              <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 transform">
                <div className="flex items-center gap-4 rounded-full border border-gray-200 bg-white/95 backdrop-blur-sm px-8 py-3 shadow-xl dark:border-gray-700 dark:bg-gray-900/95">
                  <span className="text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">
                    {selectedMediaIds.size} selected
                  </span>
                  <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" />
                  <Button
                    variant="secondary"
                    onClick={handleSelectAll}
                    size="sm"
                    className="whitespace-nowrap"
                  >
                    {selectedMediaIds.size === sortedMedia.length ? 'Deselect All' : 'Select All'}
                  </Button>
                  <Button
                    onClick={handleAddToAlbum}
                    size="sm"
                    className="whitespace-nowrap"
                  >
                    <FolderIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                    <span>Add to Album</span>
                  </Button>
                  <Button
                    onClick={handleTagSponsors}
                    size="sm"
                    className="whitespace-nowrap"
                  >
                    <TagIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                    <span>Tag Sponsors</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleBulkDelete}
                    size="sm"
                    className="whitespace-nowrap"
                  >
                    <TrashIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                    <span>Delete</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelSelection}
                    size="sm"
                    className="whitespace-nowrap"
                  >
                    <XMarkIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                    <span>Cancel</span>
                  </Button>
                </div>
              </div>
            </div>

            {/* Original inline action bar (kept for context but visually less prominent) */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {selectedMediaIds.size} selected
              </span>
            </div>
          </>
        ) : (
          <div className="flex gap-2">
            <Button
              onClick={() => setShowUploadModal(true)}
              className="inline-flex items-center"
            >
              <PlusIcon className="mr-2 h-4 w-4" />
              Upload Media
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowAlbumModal(true)}
              className="inline-flex items-center"
            >
              <FolderIcon className="mr-2 h-4 w-4" />
              Manage Albums
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {/* Thumbnail Size Slider */}
          <div className="flex items-center gap-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-surface-2 px-4 py-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Size:</span>
            <input
              type="range"
              min="3"
              max="8"
              value={thumbnailSize}
              onChange={(e) => setThumbnailSize(Number(e.target.value))}
              className="w-24 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-primary-600"
              title={`${thumbnailSize} columns`}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400 w-6 text-center">{thumbnailSize}</span>
          </div>

          {/* Filter Buttons */}
          <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-2.5 text-sm font-medium ${
                filterType === 'all'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-surface-2 dark:text-gray-300 dark:hover:bg-surface-3'
              } rounded-l-lg`}
            >
              All
            </button>
            <button
              onClick={() => setFilterType('photos')}
              className={`border-l border-gray-300 px-3 py-2.5 text-sm font-medium dark:border-gray-600 ${
                filterType === 'photos'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-surface-2 dark:text-gray-300 dark:hover:bg-surface-3'
              }`}
            >
              Photos
            </button>
            <button
              onClick={() => setFilterType('videos')}
              className={`border-l border-gray-300 px-3 py-2.5 text-sm font-medium dark:border-gray-600 ${
                filterType === 'videos'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-surface-2 dark:text-gray-300 dark:hover:bg-surface-3'
              } rounded-r-lg`}
            >
              Videos
            </button>
          </div>

          {/* Sorting Dropdown */}
          <div className="relative inline-block">
            <select
              value={sortOption}
              onChange={(e) => {
                const newSortOption = e.target.value as SortOption;
                setSortOption(newSortOption);
                // When switching away from custom sort, disable drag mode
                if (newSortOption !== 'custom' && isDragMode) {
                  setIsDragMode(false);
                }
              }}
              className="appearance-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-surface-2 pl-3 pr-10 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="upload_newest">Newest First</option>
              <option value="upload_oldest">Oldest First</option>
              <option value="name_asc">Name (A-Z)</option>
              <option value="name_desc">Name (Z-A)</option>
              <option value="custom">Custom Order</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ArrowsUpDownIcon className="h-4 w-4 text-gray-400" />
            </div>
          </div>

          {/* Drag Mode Toggle - only show when custom sorting is selected */}
          {sortOption === 'custom' && (
            <Button
              variant={isDragMode ? 'primary' : 'outline'}
              onClick={() => {
                setIsDragMode(!isDragMode);
                if (!isDragMode) {
                  // Clear selection when entering drag mode
                  setSelectedMediaIds(new Set());
                }
              }}
              size="sm"
              className="inline-flex items-center"
            >
              <ArrowsPointingOutIcon className="h-4 w-4 mr-2" />
              {isDragMode ? 'Exit Reorder' : 'Reorder'}
            </Button>
          )}

          {/* Sponsor Filter Dropdown */}
          <div className="relative inline-block">
            <select
              value={selectedSponsor || ''}
              onChange={(e) => {
                const value = e.target.value || null;
                setSelectedSponsor(value);
                if (value) {
                  setSearchParams({ sponsorId: value });
                } else {
                  setSearchParams({});
                }
              }}
              className="appearance-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-surface-2 px-3 py-2.5 pr-8 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Sponsors</option>
              {sponsors.map(sponsor => (
                <option key={sponsor.id} value={sponsor.id}>
                  {sponsor.sponsor?.name || 'Unknown Sponsor'}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Sponsor Filter Badge */}
      {selectedSponsor && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">Filtering by sponsor:</span>
          <div className="flex items-center gap-2 rounded-lg bg-blue-100 px-4 py-2 text-sm font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
            <TagIcon className="h-4 w-4" />
            {sponsors.find(s => s.id === selectedSponsor)?.sponsor?.name || 'Unknown Sponsor'}
            <button
              onClick={() => {
                setSelectedSponsor(null);
                setSearchParams({});
              }}
              className="ml-2 rounded hover:bg-blue-200 dark:hover:bg-blue-800/50 p-0.5"
              title="Clear sponsor filter"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Albums Sidebar */}
      {albums.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setSelectedAlbum(null)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
              selectedAlbum === null
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-surface-2 dark:text-gray-300 dark:hover:bg-surface-3'
            }`}
          >
            <FolderIcon className="h-4 w-4" />
            All Media
          </button>
          {albums.map(album => {
            // Calculate the actual count from albumItems for real-time accuracy
            const actualCount = albumItems.filter(item => item.album_id === album.id).length;
            return (
              <button
                key={album.id}
                onClick={() => setSelectedAlbum(album.id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
                  selectedAlbum === album.id
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-surface-2 dark:text-gray-300 dark:hover:bg-surface-3'
                }`}
              >
                <FolderIcon className="h-4 w-4" />
                {album.name}
                <span className="ml-1 text-xs opacity-75">({actualCount})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Help text */}
      {sortedMedia.length > 0 && selectedMediaIds.size === 0 && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {isDragMode
            ? 'Drag and drop items to reorder. Changes are saved automatically. Click "Exit Reorder" to select items.'
            : sortOption === 'custom'
              ? 'Click to select media, double-click to view. Click "Reorder" to drag and drop items.'
              : 'Click to select media, double-click to view'
          }
        </div>
      )}

      {/* Media Gallery */}
      {/* Add padding bottom when items are selected to account for sticky bar */}
      <div className={selectedMediaIds.size > 0 ? 'pb-20 md:pb-24' : ''}>
      {sortedMedia.length === 0 ? (
        <Card className="p-12">
          <div className="text-center">
            <PhotoIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">No media yet</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Get started by uploading photos or videos for this event.
            </p>
            <Button
              onClick={() => setShowUploadModal(true)}
              className="mt-4"
            >
              <PlusIcon className="mr-2 h-4 w-4" />
              Upload Media
            </Button>
          </div>
        </Card>
      ) : sortOption === 'custom' ? (
        <DraggableMediaGallery
          media={sortedMedia}
          onView={setSelectedMedia}
          selectedIds={selectedMediaIds}
          onToggleSelect={handleToggleSelect}
          newlyAddedIds={newlyAddedIds}
          albums={albums}
          albumItems={albumItems}
          sponsors={sponsors}
          sponsorTags={sponsorTags}
          onRefresh={loadData}
          isDragMode={isDragMode}
          selectedAlbum={selectedAlbum}
          columnsCount={thumbnailSize}
          onOrderChange={(newOrder) => {
            // Update local state with new order
            setMedia(prevMedia => {
              // Create a map of the new order
              const orderMap = new Map(newOrder.map((item, index) => [item.id, index]));

              // Sort all media based on the new order
              return [...prevMedia].sort((a, b) => {
                const aOrder = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
                const bOrder = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
                return aOrder - bOrder;
              });
            });
          }}
        />
      ) : (
        <MediaGalleryView
          media={sortedMedia}
          onView={setSelectedMedia}
          selectedIds={selectedMediaIds}
          onToggleSelect={handleToggleSelect}
          newlyAddedIds={newlyAddedIds}
          albums={albums}
          albumItems={albumItems}
          sponsors={sponsors}
          sponsorTags={sponsorTags}
          onRefresh={loadData}
          columnsCount={thumbnailSize}
        />
      )}
      </div>

      {/* Modals */}
      {showUploadModal && (
        <MediaUploadModal
          eventId={eventId}
          albums={albums}
          onClose={() => setShowUploadModal(false)}
          onSuccess={() => {
            loadData();
            setShowUploadModal(false);
          }}
        />
      )}

      {showAlbumModal && (
        <AlbumManagementModal
          eventId={eventId}
          albums={albums}
          onClose={() => setShowAlbumModal(false)}
          onSuccess={() => {
            loadData();
          }}
        />
      )}

      {/* Media Viewer Modal */}
      {selectedMedia && (
        <MediaViewerModal
          media={selectedMedia}
          onClose={() => setSelectedMedia(null)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <ConfirmModal
          isOpen={true}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={confirmDelete}
          title={
            deleteConfirm.type === 'bulk'
              ? 'Delete Multiple Items?'
              : deleteConfirm.type === 'media'
                ? 'Delete Media?'
                : 'Delete Album?'
          }
          message={
            deleteConfirm.type === 'bulk'
              ? `Are you sure you want to delete ${deleteConfirm.name}? This action cannot be undone.`
              : deleteConfirm.type === 'media'
                ? `Are you sure you want to delete "${deleteConfirm.name}"? This action cannot be undone.`
                : `Are you sure you want to delete the album "${deleteConfirm.name}"? Media files will not be deleted.`
          }
          confirmText="Delete"
          confirmColor="red"
        />
      )}

      {/* Add to Album Modal */}
      {showAddToAlbumModal && (
        <AddToAlbumModal
          isOpen={true}
          onClose={() => setShowAddToAlbumModal(false)}
          onSuccess={() => {
            // Don't call loadData() - real-time updates will handle it
            setShowAddToAlbumModal(false);
            handleCancelSelection();
          }}
          albums={albums}
          selectedMediaIds={Array.from(selectedMediaIds)}
        />
      )}

      {/* Tag Sponsors Modal */}
      {showTagSponsorsModal && (
        <TagSponsorsModal
          isOpen={true}
          onClose={() => setShowTagSponsorsModal(false)}
          onSuccess={() => {
            // Don't call loadData() - real-time updates will handle it
            setShowTagSponsorsModal(false);
            handleCancelSelection();
          }}
          sponsors={sponsors}
          selectedMediaIds={Array.from(selectedMediaIds)}
        />
      )}
    </div>
  );
}
