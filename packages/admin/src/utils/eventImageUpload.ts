// @ts-nocheck
import { supabase } from '@/lib/supabase';

export interface EventImageUploadResult {
  success: boolean;
  url?: string;
  error?: string;
  path?: string;
}

/**
 * Upload an event preview image to Supabase Storage
 * Used for event screenshots/preview images
 */
export async function uploadEventImage(
  imageBuffer: Buffer,
  eventId: string,
  fileExtension: string = 'jpg'
): Promise<EventImageUploadResult> {
  try {
    const fileName = `${eventId}.${fileExtension}`;
    const filePath = `event-previews/${fileName}`;

    // Upload file to storage
    const { data, error } = await supabase.storage
      .from('event-images')
      .upload(filePath, imageBuffer, {
        upsert: true, // Overwrite existing files
        contentType: `image/${fileExtension === 'jpg' ? 'jpeg' : fileExtension}`,
        cacheControl: '3600', // Cache for 1 hour
      });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('event-images')
      .getPublicUrl(data.path);

    return {
      success: true,
      url: urlData.publicUrl,
      path: data.path,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Delete an event image from Supabase Storage
 */
export async function deleteEventImage(imagePath: string): Promise<EventImageUploadResult> {
  try {
    const { error } = await supabase.storage
      .from('event-images')
      .remove([imagePath]);

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Get event image URL from storage path
 */
export function getEventImageUrl(imagePath: string): string {
  const { data } = supabase.storage
    .from('event-images')
    .getPublicUrl(imagePath);

  return data.publicUrl;
}

/**
 * Extract storage path from full URL
 */
export function extractEventImagePath(imageUrl: string): string | null {
  try {
    const url = new URL(imageUrl);
    const pathParts = url.pathname.split('/');
    const bucketIndex = pathParts.findIndex(part => part === 'event-images');

    if (bucketIndex !== -1 && bucketIndex < pathParts.length - 1) {
      return pathParts.slice(bucketIndex + 1).join('/');
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if event image exists in storage
 */
export async function eventImageExists(eventId: string): Promise<boolean> {
  try {
    const filePath = `event-previews/${eventId}.jpg`;
    const { data, error } = await supabase.storage
      .from('event-images')
      .list('event-previews', {
        search: `${eventId}.jpg`,
      });

    if (error) {
      return false;
    }

    return data && data.length > 0;
  } catch {
    return false;
  }
}
