// @ts-nocheck
import { supabase } from '@/lib/supabase';

export interface EventLogoUploadResult {
  success: boolean;
  url?: string;
  error?: string;
  path?: string;
}

/**
 * Upload an event logo to Supabase Storage
 * @param file - The image file to upload
 * @param eventId - The event ID
 * @param type - Type of image ('logo', 'badge', or 'screenshot')
 */
export async function uploadEventLogo(
  file: File,
  eventId: string,
  type: 'logo' | 'badge' | 'screenshot' = 'logo'
): Promise<EventLogoUploadResult> {
  try {
    // Get file extension
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const fileName = `${eventId}-${type}.${fileExtension}`;
    // Use different folder for screenshots
    const folder = type === 'screenshot' ? 'event-screenshots' : 'event-logos';
    const filePath = `${folder}/${fileName}`;

    // Read file as array buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // Upload file to storage
    const { data, error } = await supabase.storage
      .from('event-images')
      .upload(filePath, buffer, {
        upsert: true, // Overwrite existing files
        contentType: file.type,
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
 * Delete an event logo from Supabase Storage
 */
export async function deleteEventLogo(imagePath: string): Promise<EventLogoUploadResult> {
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
 * Update an event logo (replaces existing one)
 */
export async function updateEventLogo(
  oldImagePath: string,
  file: File,
  eventId: string,
  type: 'logo' | 'badge' | 'screenshot' = 'logo'
): Promise<EventLogoUploadResult> {
  try {
    // Delete old image
    await deleteEventLogo(oldImagePath);

    // Upload new image
    return await uploadEventLogo(file, eventId, type);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Extract storage path from full URL
 */
export function extractEventLogoPath(imageUrl: string): string | null {
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
 * Get event logo URL from storage path
 */
export function getEventLogoUrl(imagePath: string): string {
  const { data } = supabase.storage
    .from('event-images')
    .getPublicUrl(imagePath);

  return data.publicUrl;
}

/**
 * Validate image file
 */
export function validateImageFile(file: File, options: { maxSizeInMB?: number } = {}): { valid: boolean; error?: string } {
  const { maxSizeInMB = 50 } = options;

  // Check if file is an image
  if (!file.type.startsWith('image/')) {
    return { valid: false, error: 'File must be an image' };
  }

  // Check file size
  const maxSizeInBytes = maxSizeInMB * 1024 * 1024;
  if (file.size > maxSizeInBytes) {
    return { valid: false, error: `File size must be less than ${maxSizeInMB}MB` };
  }

  return { valid: true };
}
