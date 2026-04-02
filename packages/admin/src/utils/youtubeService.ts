/**
 * YouTube Service
 * Handles YouTube API integration for video uploads
 */

export interface YouTubeConfig {
  apiKey: string;
  clientId: string;
  clientSecret: string;
  channelId: string;
  refreshToken: string;
}

export interface YouTubeUploadResult {
  success: boolean;
  videoId?: string;
  url?: string;
  embedUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface YouTubeVideoMetadata {
  title: string;
  description: string;
  tags?: string[];
  category?: string;
  privacy?: 'public' | 'unlisted' | 'private';
}

/**
 * Get YouTube configuration from environment variables
 */
export function getYouTubeConfig(): YouTubeConfig | null {
  const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;
  const clientId = import.meta.env.VITE_YOUTUBE_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_YOUTUBE_CLIENT_SECRET;
  const channelId = import.meta.env.VITE_YOUTUBE_CHANNEL_ID;
  const refreshToken = import.meta.env.VITE_YOUTUBE_REFRESH_TOKEN;

  if (!apiKey || !clientId || !clientSecret || !channelId || !refreshToken) {
    console.warn('YouTube configuration is incomplete');
    return null;
  }

  return {
    apiKey,
    clientId,
    clientSecret,
    channelId,
    refreshToken,
  };
}

/**
 * Check if YouTube is configured for the current brand
 */
export function isYouTubeConfigured(): boolean {
  return getYouTubeConfig() !== null;
}

/**
 * Generate YouTube embed URL from video ID
 */
export function getYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}

/**
 * Generate YouTube watch URL from video ID
 */
export function getYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Get YouTube thumbnail URL for a video
 * @param videoId YouTube video ID
 * @param quality 'default' | 'medium' | 'high' | 'standard' | 'maxres'
 */
export function getYouTubeThumbnailUrl(
  videoId: string,
  quality: 'default' | 'medium' | 'high' | 'standard' | 'maxres' = 'maxres'
): string {
  const qualityMap = {
    default: 'default.jpg',
    medium: 'mqdefault.jpg',
    high: 'hqdefault.jpg',
    standard: 'sddefault.jpg',
    maxres: 'maxresdefault.jpg',
  };

  return `https://i.ytimg.com/vi/${videoId}/${qualityMap[quality]}`;
}

/**
 * Upload video to YouTube via Edge Function
 * Note: Currently limited to ~50MB files due to Edge Function resource constraints
 */
export async function uploadVideoToYouTube(
  file: File,
  metadata: YouTubeVideoMetadata,
  onProgress?: (progress: number) => void
): Promise<YouTubeUploadResult> {
  try {
    const config = getYouTubeConfig();
    if (!config) {
      return {
        success: false,
        error: 'YouTube is not configured for this brand',
      };
    }

    // Create form data for upload
    const formData = new FormData();
    formData.append('video', file);
    formData.append('title', metadata.title);
    formData.append('description', metadata.description);
    formData.append('privacy', metadata.privacy || 'unlisted');

    if (metadata.tags && metadata.tags.length > 0) {
      formData.append('tags', JSON.stringify(metadata.tags));
    }

    if (metadata.category) {
      formData.append('category', metadata.category);
    }

    // Call the Edge Function
    console.log('Uploading video to YouTube via Edge Function...');
    console.log('File size:', file.size, 'bytes (~' + (file.size / 1024 / 1024).toFixed(2) + ' MB)');
    console.log('File name:', file.name);
    console.log('Title:', metadata.title);

    const startTime = Date.now();

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-video-to-youtube`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: formData,
      }
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Edge Function responded in ${elapsed}s with status:`, response.status);

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        const text = await response.text();
        console.error('Edge Function error (non-JSON):', text);
        return {
          success: false,
          error: `Upload failed with status ${response.status}: ${text}`,
        };
      }
      console.error('Edge Function error:', errorData);
      return {
        success: false,
        error: errorData.error || 'Failed to upload video to YouTube',
      };
    }

    const data = await response.json();
    console.log('YouTube upload successful! Video ID:', data.videoId);

    return {
      success: true,
      videoId: data.videoId,
      url: getYouTubeWatchUrl(data.videoId),
      embedUrl: getYouTubeEmbedUrl(data.videoId),
      thumbnailUrl: getYouTubeThumbnailUrl(data.videoId),
    };
  } catch (error) {
    console.error('Error uploading to YouTube:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Get video details from YouTube
 */
export async function getYouTubeVideoDetails(videoId: string) {
  try {
    const config = getYouTubeConfig();
    if (!config) {
      throw new Error('YouTube is not configured');
    }

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoId}&key=${config.apiKey}`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch video details');
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      throw new Error('Video not found');
    }

    return data.items[0];
  } catch (error) {
    console.error('Error fetching YouTube video details:', error);
    throw error;
  }
}

/**
 * Extract event name from event ID or generate a default title
 */
export function generateVideoTitle(eventId: string, fileName: string): string {
  // Remove file extension
  const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');

  // Clean up the filename
  const cleanName = nameWithoutExt
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `${cleanName} - ${eventId.toUpperCase()}`;
}

/**
 * Generate video description
 */
export function generateVideoDescription(eventId: string, brandName: string): string {
  return `Video from ${brandName} event ${eventId.toUpperCase()}.

Uploaded via ${brandName} event management system.`;
}
