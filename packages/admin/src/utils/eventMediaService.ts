// @ts-nocheck
import { supabase } from '@/lib/supabase';
import {
  uploadVideoToYouTube,
  generateVideoTitle,
  generateVideoDescription,
  isYouTubeConfigured,
  type YouTubeUploadResult,
} from './youtubeService';
import { uploadLargeFile } from './chunkedUpload';
import { uploadToS3Multipart, isS3Configured, convertStoragePathToS3Key } from './s3MultipartUpload';
import { isBunnyCDNEnabled, getBunnyImageUrl } from './bunnyNet';

// ============================================================================
// Types
// ============================================================================

export interface EventMedia {
  id: string;
  event_id: string;
  file_name: string;
  storage_path: string;
  file_type: 'photo' | 'video';
  mime_type: string;
  file_size: number;
  width?: number;
  height?: number;
  duration?: number; // For videos, in seconds
  thumbnail_path?: string;
  uploaded_by: 'admin' | 'attendee';
  uploader_id?: string;
  upload_source?: string;
  caption?: string;
  metadata?: Record<string, any>;
  is_featured: boolean;
  is_approved: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  // YouTube fields
  youtube_video_id?: string;
  youtube_upload_status?: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';
  youtube_url?: string;
  youtube_embed_url?: string;
  youtube_thumbnail_url?: string;
  youtube_error_message?: string;
  youtube_uploaded_at?: string;
  youtube_processing_started_at?: string;
  youtube_processing_completed_at?: string;
  youtube_channel_id?: string;
  upload_method?: 'storage' | 'youtube';
}

export interface EventMediaAlbum {
  id: string;
  event_id: string;
  name: string;
  description?: string;
  cover_media_id?: string;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  media_count?: number; // Computed field
}

export interface EventMediaAlbumItem {
  id: string;
  media_id: string;
  album_id: string;
  sort_order: number;
  created_at: string;
}

export interface EventMediaSponsorTag {
  id: string;
  media_id: string;
  event_sponsor_id: string;
  created_at: string;
}

export interface EventSponsor {
  id: string;
  event_id: string;
  sponsor_id: string;
  sponsorship_tier: string;
  booth_number?: string;
  is_active: boolean;
  sponsor: {
    id: string;
    name: string;
    slug: string;
    logo_url?: string;
    website?: string;
  };
}

export interface EventMediaZipUpload {
  id: string;
  event_id: string;
  file_name: string;
  storage_path: string;
  file_size: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  processed_count: number;
  total_count: number;
  error_message?: string;
  processing_started_at?: string;
  processing_completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface MediaUploadResult {
  success: boolean;
  media?: EventMedia;
  error?: string;
  isPending?: boolean; // True when video is uploaded to storage and awaiting YouTube processing
}

export interface AlbumWithMedia extends EventMediaAlbum {
  media: EventMedia[];
}

// ============================================================================
// Media CRUD Operations
// ============================================================================

/**
 * Get all media for an event
 */
export async function getEventMedia(
  eventId: string,
  options: {
    fileType?: 'photo' | 'video';
    uploadedBy?: 'admin' | 'attendee';
    isApproved?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ data: EventMedia[] | null; error: any }> {
  try {
    let query = supabase
      .from('event_media')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (options.fileType) {
      query = query.eq('file_type', options.fileType);
    }

    if (options.uploadedBy) {
      query = query.eq('uploaded_by', options.uploadedBy);
    }

    if (options.isApproved !== undefined) {
      query = query.eq('is_approved', options.isApproved);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
    }

    const { data, error } = await query;
    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Get a single media item by ID
 */
export async function getMediaById(mediaId: string): Promise<{ data: EventMedia | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('event_media')
      .select('*')
      .eq('id', mediaId)
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Upload a single media file
 */
export async function uploadEventMedia(
  file: File,
  eventId: string,
  options: {
    fileType: 'photo' | 'video';
    caption?: string;
    albumIds?: string[];
    uploadedBy?: 'admin' | 'attendee';
    uploaderId?: string;
  }
): Promise<MediaUploadResult> {
  try {
    const { fileType, caption, albumIds, uploadedBy = 'admin', uploaderId } = options;

    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${timestamp}-${sanitizedName}`;
    const storagePath = `events/${eventId}/${fileType}s/original/${fileName}`;

    // Upload file to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('event-media')
      .upload(storagePath, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      return {
        success: false,
        error: uploadError.message,
      };
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('event-media')
      .getPublicUrl(uploadData.path);

    // Get image/video dimensions if possible
    let width: number | undefined;
    let height: number | undefined;
    let duration: number | undefined;

    if (fileType === 'photo') {
      try {
        const dimensions = await getImageDimensions(file);
        width = dimensions.width;
        height = dimensions.height;
      } catch (e) {
        console.warn('Could not get image dimensions:', e);
      }
    } else if (fileType === 'video') {
      try {
        const videoDimensions = await getVideoDimensions(file);
        width = videoDimensions.width;
        height = videoDimensions.height;
        duration = videoDimensions.duration;
      } catch (e) {
        console.warn('Could not get video dimensions:', e);
      }
    }

    // Create media record in database
    const mediaData: Partial<EventMedia> = {
      event_id: eventId,
      file_name: file.name,
      storage_path: uploadData.path,
      file_type: fileType,
      mime_type: file.type,
      file_size: file.size,
      width,
      height,
      duration,
      uploaded_by: uploadedBy,
      uploader_id: uploaderId,
      upload_source: 'direct_upload',
      caption,
      is_approved: uploadedBy === 'admin', // Auto-approve admin uploads
    };

    const { data: media, error: dbError } = await supabase
      .from('event_media')
      .insert([mediaData])
      .select()
      .single();

    if (dbError) {
      // Rollback: delete uploaded file
      await supabase.storage.from('event-media').remove([uploadData.path]);
      return {
        success: false,
        error: dbError.message,
      };
    }

    // Add to albums if specified
    if (albumIds && albumIds.length > 0) {
      await addMediaToAlbums(media.id, albumIds);
    }

    // Note: We use Supabase's built-in image transformation instead of pre-processing
    // This is more efficient and avoids CPU timeout issues in Edge Functions

    return {
      success: true,
      media,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Upload file to Supabase Storage with progress tracking using XMLHttpRequest
 */
async function uploadToStorageWithProgress(
  bucket: string,
  path: string,
  file: File,
  options: {
    contentType?: string;
    cacheControl?: string;
    upsert?: boolean;
  },
  onProgress?: (progress: number) => void
): Promise<{ data: { path: string } | null; error: Error | null }> {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    // Get the authenticated user's session for proper RLS authorization
    const { data: { session } } = await supabase.auth.getSession();

    // Storage RLS policies require authenticated users
    if (!session) {
      console.error('No authenticated session found. User must be logged in to upload files.');
      return {
        data: null,
        error: new Error('Authentication required. Please log in to upload files.')
      };
    }

    const authToken = session.access_token;

    // Extract project ref from the anon key (it's in the JWT payload)
    let storageUrl = supabaseUrl;

    // Check if we're using a custom domain
    if (!supabaseUrl.includes('.supabase.co')) {
      // For custom domains, we need to extract the project ref from the JWT
      try {
        const jwtPayload = JSON.parse(atob(anonKey.split('.')[1]));
        if (jwtPayload.ref) {
          // Use the actual Supabase storage URL
          storageUrl = `https://${jwtPayload.ref}.storage.supabase.co`;
        }
      } catch (e) {
        console.warn('Could not extract project ref from JWT, using custom domain directly');
        // Fall back to using the custom domain as-is
        storageUrl = supabaseUrl;
      }
    } else {
      // Standard Supabase URL - convert to storage URL
      storageUrl = supabaseUrl.replace(/^https:\/\/([^.]+)\.supabase\.co/, 'https://$1.storage.supabase.co');
    }

    // Construct the standard upload URL with proper format
    const uploadUrl = `${storageUrl}/storage/v1/object/${bucket}/${path}`;

    console.log('Uploading to:', uploadUrl);

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const percentComplete = (e.loaded / e.total) * 100;
          onProgress(percentComplete);
        }
      });

      xhr.addEventListener('load', () => {
        console.log('Upload response status:', xhr.status);
        console.log('Upload response:', xhr.responseText);

        if (xhr.status === 200 || xhr.status === 201) {
          resolve({ data: { path }, error: null });
        } else {
          let errorMessage = `Upload failed with status ${xhr.status}`;
          try {
            const errorData = JSON.parse(xhr.responseText);
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (e) {
            errorMessage = xhr.responseText || errorMessage;
          }
          console.error('Upload failed:', errorMessage);
          resolve({ data: null, error: new Error(errorMessage) });
        }
      });

      xhr.addEventListener('error', () => {
        console.error('Network error during upload');
        resolve({ data: null, error: new Error('Network error during upload') });
      });

      xhr.open('POST', uploadUrl);
      xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
      xhr.setRequestHeader('apikey', anonKey);
      xhr.setRequestHeader('Content-Type', options.contentType || file.type);

      if (options.cacheControl) {
        xhr.setRequestHeader('cache-control', options.cacheControl);
      }
      if (options.upsert !== undefined) {
        xhr.setRequestHeader('x-upsert', options.upsert.toString());
      }

      xhr.send(file);
    });
  } catch (error) {
    console.error('Upload error:', error);
    return { data: null, error: error instanceof Error ? error : new Error('Upload failed') };
  }
}

/**
 * Upload video to YouTube and create media record
 * This is the primary method for handling video uploads
 *
 * For small videos (< 50MB): Direct upload to YouTube via Edge Function
 * For large videos (>= 50MB): Upload to Storage first, then background processing
 */
export async function uploadVideoToYouTubeAndCreateRecord(
  file: File,
  eventId: string,
  options: {
    caption?: string;
    albumIds?: string[];
    uploadedBy?: 'admin' | 'attendee';
    uploaderId?: string;
    brandName?: string;
    onProgress?: (progress: number) => void;
  } = {}
): Promise<MediaUploadResult> {
  const { caption, albumIds, uploadedBy = 'admin', uploaderId, brandName = 'Event', onProgress } = options;

  try {
    // Check if YouTube is configured
    if (!isYouTubeConfigured()) {
      return {
        success: false,
        error: 'YouTube is not configured for this brand. Please add YouTube credentials to environment variables.',
      };
    }

    // Get video dimensions before uploading
    let width: number | undefined;
    let height: number | undefined;
    let duration: number | undefined;

    try {
      const videoDimensions = await getVideoDimensions(file);
      width = videoDimensions.width;
      height = videoDimensions.height;
      duration = videoDimensions.duration;
    } catch (e) {
      console.warn('Could not get video dimensions:', e);
    }

    const fileSizeMB = file.size / (1024 * 1024);
    const useBackgroundProcessing = fileSizeMB >= 50;

    // Check if S3 multipart upload is configured
    const useS3Multipart = isS3Configured() && fileSizeMB >= 100;

    // Supabase Storage has timeout limits (~2-5 minutes) that prevent very large file uploads
    // If S3 is not configured, enforce 500MB limit. With S3, we can handle much larger files.
    const MAX_UPLOAD_SIZE_MB = useS3Multipart ? 5000 : 500; // 5GB with S3, 500MB without

    if (fileSizeMB > MAX_UPLOAD_SIZE_MB) {
      return {
        success: false,
        error: `Video file is too large (${fileSizeMB.toFixed(0)}MB). Maximum upload size is ${MAX_UPLOAD_SIZE_MB}MB. ${!isS3Configured() ? 'Configure S3 credentials for larger file support.' : 'Please compress your video or contact support.'}`,
      };
    }

    console.log(`Video size: ${fileSizeMB.toFixed(2)}MB - Using ${useBackgroundProcessing ? 'background processing' : 'direct upload'}${useS3Multipart ? ' with S3 multipart' : ''}`);

    if (useBackgroundProcessing) {
      // Large video: Upload to Supabase Storage first, then process in background
      console.log('Uploading large video to Supabase Storage for background processing...');

      // Generate unique filename
      const timestamp = Date.now();
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const fileName = `${timestamp}-${sanitizedName}`;
      const storagePath = `events/${eventId}/videos/original/${fileName}`;

      let uploadData: { path: string } | null = null;
      let uploadError: Error | null = null;

      if (useS3Multipart) {
        // Use S3 multipart upload for very large files
        console.log('Using S3 multipart upload for large file...');

        const s3Key = convertStoragePathToS3Key(storagePath);
        const s3Result = await uploadToS3Multipart({
          file,
          key: s3Key,
          bucket: 'event-media',
          onProgress: (progress) => {
            if (onProgress) {
              onProgress(progress.percentage);
            }
          },
          metadata: {
            'original-filename': file.name,
            'event-id': eventId,
          },
        });

        if (s3Result.success) {
          uploadData = { path: s3Result.key || storagePath };
        } else {
          uploadError = new Error(s3Result.error || 'S3 multipart upload failed');
        }
      } else {
        // For smaller files, use regular upload with progress
        const result = await uploadToStorageWithProgress(
          'event-media',
          storagePath,
          file,
          {
            contentType: file.type,
            cacheControl: '3600',
            upsert: false,
          },
          onProgress
        );
        uploadData = result.data;
        uploadError = result.error;
      }

      if (uploadError || !uploadData) {
        return {
          success: false,
          error: `Failed to upload to storage: ${uploadError?.message || 'Unknown error'}`,
        };
      }

      // Create media record with pending YouTube status
      const mediaData: Partial<EventMedia> = {
        event_id: eventId,
        file_name: file.name,
        storage_path: uploadData.path,
        file_type: 'video',
        mime_type: file.type,
        file_size: file.size,
        width,
        height,
        duration,
        uploaded_by: uploadedBy,
        uploader_id: uploaderId,
        upload_source: 'direct_upload',
        caption,
        is_approved: uploadedBy === 'admin',
        upload_method: 'storage', // Temporarily in storage
        youtube_upload_status: 'pending', // Will be processed by background worker
        youtube_channel_id: import.meta.env.VITE_YOUTUBE_CHANNEL_ID,
      };

      const { data: media, error: dbError } = await supabase
        .from('event_media')
        .insert([mediaData])
        .select()
        .single();

      if (dbError) {
        // Rollback: delete uploaded file
        await supabase.storage.from('event-media').remove([uploadData.path]);
        return {
          success: false,
          error: `Failed to create database record: ${dbError.message}`,
        };
      }

      // Add to albums if specified
      if (albumIds && albumIds.length > 0) {
        await addMediaToAlbums(media.id, albumIds);
      }

      // Trigger YouTube processing for the uploaded video
      console.log('='.repeat(60));
      console.log('VIDEO UPLOAD COMPLETE - YOUTUBE PROCESSING');
      console.log('Media ID:', media.id);
      console.log('Storage Path:', uploadData.path);
      console.log('File Size:', fileSizeMB.toFixed(2), 'MB');
      console.log('Upload Method:', useS3Multipart ? 'S3 Multipart' : 'Standard Storage');
      console.log('='.repeat(60));

      // For very large files (S3 multipart), skip Edge Function and rely on background daemon
      // Edge Functions have timeout limits (~60-150s) that are too short for large files
      if (useS3Multipart || fileSizeMB >= 500) {
        console.log('⏳ Large file detected - will be processed by background daemon');
        console.log('   Run: npm run process:youtube');
        console.log('   Or use the YouTube processor daemon for automatic processing');
      } else {
        // For medium-sized files (50-500MB), try Edge Function with timeout handling
        try {
          console.log('Triggering Edge Function for YouTube processing...');

          // Try to call the Edge Function to process this specific video
          const { data: functionData, error: functionError } = await supabase.functions.invoke(
            'process-youtube-uploads',
            {
              body: {
                mediaId: media.id, // Process this specific video
              },
            }
          );

          if (functionError) {
            console.error('❌ Edge Function invocation error:', functionError);
            console.log('Video will be processed by the background worker (npm run process:youtube)');
          } else {
            console.log('✅ Edge Function called successfully');
            console.log('Function response:', functionData);
            if (functionData?.success) {
              console.log('🎉 YouTube processing triggered successfully!');
            } else if (functionData?.error) {
              console.warn('⚠️ Edge Function returned error:', functionData.error);
            }
          }
        } catch (triggerError) {
          // Don't fail the upload if we can't trigger processing
          console.error('❌ Exception when triggering YouTube processing:', triggerError);
          console.log('Video will be processed by the background worker (npm run process:youtube)');
        }
      }

      return {
        success: true,
        media,
        isPending: true, // Indicate that upload is pending
      };

    } else {
      // Small video: Direct upload to YouTube via Edge Function (original behavior)
      console.log('Uploading small video directly to YouTube...');

      // Fetch event title from database
      const { data: eventData } = await supabase
        .from('events')
        .select('event_id, event_title')
        .eq('event_id', eventId)
        .single();

      const eventName = eventData?.event_title || eventId.toUpperCase();

      // Generate metadata for YouTube
      const fileName = file.name.replace(/\.[^/.]+$/, '');
      const title = `${eventName} // ${fileName}`;
      const description = title; // Description is same as title

      console.log('Video title:', title);

      // Upload to YouTube
      const youtubeResult: YouTubeUploadResult = await uploadVideoToYouTube(file, {
        title,
        description,
        privacy: 'unlisted',
        tags: ['event', eventId, brandName.toLowerCase()],
        category: '28', // Science & Technology
      });

      if (!youtubeResult.success || !youtubeResult.videoId) {
        return {
          success: false,
          error: youtubeResult.error || 'Failed to upload video to YouTube',
        };
      }

      // Create media record in database
      const mediaData: Partial<EventMedia> = {
        event_id: eventId,
        file_name: file.name,
        storage_path: '', // Empty for YouTube videos
        file_type: 'video',
        mime_type: file.type,
        file_size: file.size,
        width,
        height,
        duration,
        uploaded_by: uploadedBy,
        uploader_id: uploaderId,
        upload_source: 'youtube_upload',
        caption,
        is_approved: uploadedBy === 'admin',
        upload_method: 'youtube',
        youtube_video_id: youtubeResult.videoId,
        youtube_url: youtubeResult.url,
        youtube_embed_url: youtubeResult.embedUrl,
        youtube_thumbnail_url: youtubeResult.thumbnailUrl,
        youtube_upload_status: 'completed',
        youtube_uploaded_at: new Date().toISOString(),
        youtube_channel_id: import.meta.env.VITE_YOUTUBE_CHANNEL_ID,
      };

      const { data: media, error: dbError } = await supabase
        .from('event_media')
        .insert([mediaData])
        .select()
        .single();

      if (dbError) {
        return {
          success: false,
          error: `Failed to create database record: ${dbError.message}`,
        };
      }

      // Add to albums if specified
      if (albumIds && albumIds.length > 0) {
        await addMediaToAlbums(media.id, albumIds);
      }

      return {
        success: true,
        media,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Update media metadata
 */
export async function updateEventMedia(
  mediaId: string,
  updates: Partial<Pick<EventMedia, 'caption' | 'is_featured' | 'is_approved' | 'display_order'>>
): Promise<{ data: EventMedia | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('event_media')
      .update(updates)
      .eq('id', mediaId)
      .select()
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Delete media (removes from storage and database)
 */
export async function deleteEventMedia(mediaId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Get media info first
    const { data: media, error: fetchError } = await getMediaById(mediaId);
    if (fetchError || !media) {
      return { success: false, error: 'Media not found' };
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('event-media')
      .remove([media.storage_path]);

    if (storageError) {
      console.warn('Failed to delete from storage:', storageError);
    }

    // Delete thumbnail if exists
    if (media.thumbnail_path) {
      await supabase.storage
        .from('event-media')
        .remove([media.thumbnail_path]);
    }

    // Delete from database (cascade will handle album items)
    const { error: dbError } = await supabase
      .from('event_media')
      .delete()
      .eq('id', mediaId);

    if (dbError) {
      return { success: false, error: dbError.message };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Delete multiple event media items
 */
export async function deleteBulkEventMedia(mediaIds: string[]): Promise<{
  success: boolean;
  successCount: number;
  failedCount: number;
  errors: Array<{ mediaId: string; error: string }>;
}> {
  try {
    const results = {
      successCount: 0,
      failedCount: 0,
      errors: [] as Array<{ mediaId: string; error: string }>,
    };

    // Get all media info first
    const { data: mediaItems, error: fetchError } = await supabase
      .from('event_media')
      .select('id, storage_path, thumbnail_path')
      .in('id', mediaIds);

    if (fetchError) {
      return {
        success: false,
        successCount: 0,
        failedCount: mediaIds.length,
        errors: [{ mediaId: 'all', error: fetchError.message }],
      };
    }

    if (!mediaItems || mediaItems.length === 0) {
      return {
        success: false,
        successCount: 0,
        failedCount: mediaIds.length,
        errors: [{ mediaId: 'all', error: 'No media items found' }],
      };
    }

    // Collect all storage paths to delete
    const storagePaths: string[] = [];
    mediaItems.forEach(item => {
      storagePaths.push(item.storage_path);
      if (item.thumbnail_path) {
        storagePaths.push(item.thumbnail_path);
      }
    });

    // Delete from storage (batch operation)
    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('event-media')
        .remove(storagePaths);

      if (storageError) {
        console.warn('Failed to delete some files from storage:', storageError);
      }
    }

    // Delete from database (cascade will handle album items and sponsor tags)
    const { error: dbError } = await supabase
      .from('event_media')
      .delete()
      .in('id', mediaIds);

    if (dbError) {
      return {
        success: false,
        successCount: 0,
        failedCount: mediaIds.length,
        errors: [{ mediaId: 'all', error: dbError.message }],
      };
    }

    return {
      success: true,
      successCount: mediaIds.length,
      failedCount: 0,
      errors: [],
    };
  } catch (error) {
    return {
      success: false,
      successCount: 0,
      failedCount: mediaIds.length,
      errors: [{
        mediaId: 'all',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }],
    };
  }
}

// ============================================================================
// Album Operations
// ============================================================================

/**
 * Get all albums for an event
 */
export async function getEventAlbums(eventId: string): Promise<{ data: EventMediaAlbum[] | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('event_media_albums')
      .select(`
        *,
        media_count:event_media_album_items(count)
      `)
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });

    // Transform the count data
    const albums = data?.map(album => ({
      ...album,
      media_count: album.media_count?.[0]?.count || 0,
    }));

    return { data: albums || null, error };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Get a single album with its media
 */
export async function getAlbumWithMedia(albumId: string): Promise<{ data: AlbumWithMedia | null; error: any }> {
  try {
    const { data: album, error: albumError } = await supabase
      .from('event_media_albums')
      .select('*')
      .eq('id', albumId)
      .single();

    if (albumError || !album) {
      return { data: null, error: albumError };
    }

    const { data: items, error: itemsError } = await supabase
      .from('event_media_album_items')
      .select(`
        sort_order,
        media:event_media(*)
      `)
      .eq('album_id', albumId)
      .order('sort_order', { ascending: true });

    if (itemsError) {
      return { data: null, error: itemsError };
    }

    const media = items?.map(item => item.media).filter(Boolean) || [];

    return {
      data: {
        ...album,
        media: media as EventMedia[],
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Create a new album
 */
export async function createEventAlbum(
  eventId: string,
  name: string,
  description?: string
): Promise<{ data: EventMediaAlbum | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('event_media_albums')
      .insert([
        {
          event_id: eventId,
          name,
          description,
        },
      ])
      .select()
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Update an album
 */
export async function updateEventAlbum(
  albumId: string,
  updates: Partial<Pick<EventMediaAlbum, 'name' | 'description' | 'cover_media_id' | 'sort_order'>>
): Promise<{ data: EventMediaAlbum | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('event_media_albums')
      .update(updates)
      .eq('id', albumId)
      .select()
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Delete an album (does not delete media, only removes album association)
 */
export async function deleteEventAlbum(albumId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('event_media_albums')
      .delete()
      .eq('id', albumId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Add media to albums
 */
export async function addMediaToAlbums(mediaId: string, albumIds: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    const items = albumIds.map(albumId => ({
      media_id: mediaId,
      album_id: albumId,
    }));

    const { error } = await supabase
      .from('event_media_album_items')
      .insert(items);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Remove media from an album
 */
export async function removeMediaFromAlbum(mediaId: string, albumId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('event_media_album_items')
      .delete()
      .eq('media_id', mediaId)
      .eq('album_id', albumId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Get all album items for an event (for filtering purposes)
 */
export async function getEventAlbumItems(eventId: string): Promise<{ data: EventMediaAlbumItem[] | null; error: any }> {
  try {
    // Get all albums for this event first
    const { data: albums, error: albumsError } = await supabase
      .from('event_media_albums')
      .select('id')
      .eq('event_id', eventId);

    if (albumsError || !albums || albums.length === 0) {
      return { data: [], error: albumsError };
    }

    const albumIds = albums.map(a => a.id);

    // Batch the requests to avoid URL length limits
    // Process in chunks of 50 IDs at a time
    const chunkSize = 50;
    const allItems: EventMediaAlbumItem[] = [];

    for (let i = 0; i < albumIds.length; i += chunkSize) {
      const chunk = albumIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('event_media_album_items')
        .select('*')
        .in('album_id', chunk);

      if (error) {
        console.warn('Error fetching album items batch:', error);
        // Continue with other batches even if one fails
        continue;
      }

      if (data) {
        allItems.push(...data);
      }
    }

    return { data: allItems, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Get albums for a specific media item
 */
export async function getMediaAlbums(mediaId: string): Promise<{ data: EventMediaAlbum[] | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('event_media_album_items')
      .select(`
        album:event_media_albums(*)
      `)
      .eq('media_id', mediaId);

    if (error) {
      return { data: null, error };
    }

    const albums = data?.map(item => item.album).filter(Boolean) || [];
    return { data: albums as EventMediaAlbum[], error: null };
  } catch (error) {
    return { data: null, error };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get image dimensions from file
 */
function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * Get video dimensions and duration from file
 */
function getVideoDimensions(file: File): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Math.floor(video.duration),
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video'));
    };

    video.src = url;
  });
}

/**
 * Get public URL for media storage path with optional transformation
 * Automatically uses Bunny CDN with watermarks if enabled
 */
export function getMediaPublicUrl(storagePath: string, transform?: {
  width?: number;
  height?: number;
  quality?: number;
  resize?: 'cover' | 'contain' | 'fill';
}, options?: {
  disableWatermark?: boolean; // Disable watermark for this specific request
  disableCDN?: boolean; // Force use of Supabase URL (bypass CDN)
}): string {
  // Get Supabase URL WITHOUT transforms (to save quota)
  // Bunny CDN will handle all transformations
  const { data } = supabase.storage
    .from('event-media')
    .getPublicUrl(storagePath);

  const supabaseUrl = data.publicUrl;

  // If CDN is disabled for this request, return Supabase URL
  if (options?.disableCDN) {
    return supabaseUrl;
  }

  // Try to use Bunny CDN if enabled
  if (isBunnyCDNEnabled()) {
    return getBunnyImageUrl(supabaseUrl, {
      watermark: !options?.disableWatermark,
      resize: transform ? {
        width: transform.width,
        height: transform.height,
        quality: transform.quality,
        fit: transform.resize,
      } : undefined,
    });
  }

  return supabaseUrl;
}

/**
 * Validate media file
 */
export function validateMediaFile(
  file: File,
  options: {
    maxSizeInMB?: number;
    allowedTypes?: string[];
  } = {}
): { valid: boolean; error?: string } {
  // Check if file type is allowed
  const allowedTypes = options.allowedTypes || ['image/*', 'video/*'];
  const isAllowed = allowedTypes.some(type => {
    if (type.endsWith('/*')) {
      const prefix = type.slice(0, -2);
      return file.type.startsWith(prefix);
    }
    return file.type === type;
  });

  if (!isAllowed) {
    return { valid: false, error: 'File type not allowed. Only images and videos are supported.' };
  }

  // Check file size
  // For videos going to YouTube: support up to 2GB (will use background processing for large files)
  // For photos: 100MB limit since they go to Supabase Storage
  const isVideo = file.type.startsWith('video/');
  const defaultMaxSize = isVideo ? 2048 : 100; // 2GB for videos, 100MB for photos
  const maxSizeInMB = options.maxSizeInMB ?? defaultMaxSize;
  const maxSizeInBytes = maxSizeInMB * 1024 * 1024;

  if (file.size > maxSizeInBytes) {
    return {
      valid: false,
      error: `File size must be less than ${maxSizeInMB}MB`
    };
  }

  return { valid: true };
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format video duration for display
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// ============================================================================
// Sponsor Tagging Operations
// ============================================================================

/**
 * Get all event sponsors for an event
 */
export async function getEventSponsors(eventId: string): Promise<{ data: EventSponsor[] | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('event_sponsors')
      .select(`
        *,
        sponsor:sponsors(
          id,
          name,
          slug,
          logo_url,
          website
        )
      `)
      .eq('event_id', eventId)
      .eq('is_active', true)
      .order('sponsorship_tier', { ascending: true });

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Add sponsor tags to media items
 */
export async function addMediaToSponsors(mediaId: string, eventSponsorIds: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    // First, get existing tags for this media item
    const { data: existingTags } = await supabase
      .from('event_media_sponsor_tags')
      .select('event_sponsor_id')
      .eq('media_id', mediaId);

    const existingSponsorIds = new Set(existingTags?.map(tag => tag.event_sponsor_id) || []);

    // Filter out sponsors that are already tagged
    const newSponsorIds = eventSponsorIds.filter(id => !existingSponsorIds.has(id));

    // Only insert if there are new sponsors to tag
    if (newSponsorIds.length > 0) {
      const items = newSponsorIds.map(eventSponsorId => ({
        media_id: mediaId,
        event_sponsor_id: eventSponsorId,
      }));

      const { error } = await supabase
        .from('event_media_sponsor_tags')
        .insert(items);

      if (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Remove sponsor tag from media
 */
export async function removeSponsorFromMedia(mediaId: string, eventSponsorId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('event_media_sponsor_tags')
      .delete()
      .eq('media_id', mediaId)
      .eq('event_sponsor_id', eventSponsorId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Get sponsor tags for a specific media item
 */
export async function getMediaSponsorTags(mediaId: string): Promise<{ data: EventSponsor[] | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('event_media_sponsor_tags')
      .select(`
        event_sponsor:event_sponsors(
          *,
          sponsor:sponsors(
            id,
            name,
            slug,
            logo_url,
            website
          )
        )
      `)
      .eq('media_id', mediaId);

    if (error) {
      return { data: null, error };
    }

    // Flatten the structure
    const sponsors = data?.map(item => item.event_sponsor).filter(Boolean) || [];
    return { data: sponsors as EventSponsor[], error: null };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Get media count for each event sponsor
 */
export async function getSponsorMediaCounts(eventId: string): Promise<{ data: Record<string, number> | null; error: any }> {
  try {
    // Get all event sponsors for this event
    const { data: eventSponsors, error: sponsorsError } = await supabase
      .from('event_sponsors')
      .select('id')
      .eq('event_id', eventId);

    if (sponsorsError || !eventSponsors) {
      return { data: null, error: sponsorsError };
    }

    const eventSponsorIds = eventSponsors.map(es => es.id);

    if (eventSponsorIds.length === 0) {
      return { data: {}, error: null };
    }

    // Get media counts for these event sponsors
    const { data: counts, error: countsError } = await supabase
      .from('event_media_sponsor_tags')
      .select('event_sponsor_id')
      .in('event_sponsor_id', eventSponsorIds);

    if (countsError) {
      return { data: null, error: countsError };
    }

    // Count occurrences
    const mediaCounts: Record<string, number> = {};
    counts?.forEach(tag => {
      mediaCounts[tag.event_sponsor_id] = (mediaCounts[tag.event_sponsor_id] || 0) + 1;
    });

    return { data: mediaCounts, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Get all sponsor tags for an event's media
 */
export async function getEventMediaSponsorTags(eventId: string): Promise<{ data: EventMediaSponsorTag[] | null; error: any }> {
  try {
    // First get all media IDs for this event
    const { data: eventMedia, error: mediaError } = await supabase
      .from('event_media')
      .select('id')
      .eq('event_id', eventId);

    if (mediaError || !eventMedia) {
      return { data: null, error: mediaError };
    }

    const mediaIds = eventMedia.map(m => m.id);

    if (mediaIds.length === 0) {
      return { data: [], error: null };
    }

    // Batch the requests to avoid URL length limits
    // Process in chunks of 50 IDs at a time
    const chunkSize = 50;
    const allTags: EventMediaSponsorTag[] = [];

    for (let i = 0; i < mediaIds.length; i += chunkSize) {
      const chunk = mediaIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('event_media_sponsor_tags')
        .select('*')
        .in('media_id', chunk);

      if (error) {
        console.warn('Error fetching sponsor tags batch:', error);
        // Continue with other batches even if one fails
        continue;
      }

      if (data) {
        allTags.push(...data);
      }
    }

    return { data: allTags, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Update display order for a media item
 */
export async function updateMediaDisplayOrder(mediaId: string, displayOrder: number): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('event_media')
      .update({ display_order: displayOrder })
      .eq('id', mediaId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Update sort order for an album item
 */
export async function updateAlbumItemSortOrder(mediaId: string, albumId: string, sortOrder: number): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('event_media_album_items')
      .update({ sort_order: sortOrder })
      .eq('media_id', mediaId)
      .eq('album_id', albumId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
