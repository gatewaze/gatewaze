import { supabase } from '@/lib/supabase';
import { toPublicUrl } from '@gatewaze/shared';

export interface ImageUploadResult {
  success: boolean;
  /**
   * The relative storage path (e.g. `blog-posts/blog-image-12345.png`).
   * Callers persist this directly; readers resolve to full URLs via `toPublicUrl`.
   */
  url?: string;
  error?: string;
  path?: string;
}

export interface ImageUploadOptions {
  maxSizeInMB?: number;
  allowedTypes?: string[];
  generateThumbnail?: boolean;
}

const DEFAULT_OPTIONS: ImageUploadOptions = {
  maxSizeInMB: 50,
  allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'],
  generateThumbnail: false,
};

/**
 * Upload an image to Supabase Storage
 */
export async function uploadBlogImage(
  file: File,
  fileName?: string,
  options: ImageUploadOptions = {}
): Promise<ImageUploadResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Validate file type
    if (!opts.allowedTypes?.includes(file.type)) {
      return {
        success: false,
        error: `File type ${file.type} not allowed. Allowed types: ${opts.allowedTypes?.join(', ')}`,
      };
    }

    // Validate file size
    const maxSizeInBytes = (opts.maxSizeInMB || 50) * 1024 * 1024;
    if (file.size > maxSizeInBytes) {
      return {
        success: false,
        error: `File size too large. Maximum size: ${opts.maxSizeInMB}MB`,
      };
    }

    // Generate unique filename if not provided
    const timestamp = Date.now();
    const extension = file.name.split('.').pop();
    const finalFileName = fileName || `blog-image-${timestamp}.${extension}`;
    const filePath = `blog-posts/${finalFileName}`;

    // Upload file to storage
    const { data, error } = await supabase.storage
      .from('media')
      .upload(filePath, file, {
        upsert: false, // Don't overwrite existing files
        cacheControl: '3600', // Cache for 1 hour
      });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    // Return the relative path as `url` — callers persist this directly.
    return {
      success: true,
      url: data.path,
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
 * Delete an image from Supabase Storage
 */
export async function deleteBlogImage(imagePath: string): Promise<ImageUploadResult> {
  try {
    const { error } = await supabase.storage
      .from('media')
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
 * Update an image (delete old and upload new)
 */
export async function updateBlogImage(
  oldImagePath: string | null,
  newFile: File,
  fileName?: string,
  options: ImageUploadOptions = {}
): Promise<ImageUploadResult> {
  try {
    // Upload new image
    const uploadResult = await uploadBlogImage(newFile, fileName, options);

    if (!uploadResult.success) {
      return uploadResult;
    }

    // Delete old image if it exists and upload was successful
    if (oldImagePath) {
      await deleteBlogImage(oldImagePath);
    }

    return uploadResult;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Get image URL from storage path.
 * Passes through already-full URLs unchanged (idempotent).
 */
export function getBlogImageUrl(imagePath: string, bucketUrl?: string): string {
  if (bucketUrl) return toPublicUrl(imagePath, bucketUrl) ?? imagePath;
  const { data } = supabase.storage.from('media').getPublicUrl(imagePath);
  return data.publicUrl;
}

/**
 * Extract storage path from full URL, or pass through if already relative.
 * Idempotent — safe to call on either format.
 */
export function extractImagePath(imageUrl: string): string | null {
  if (!imageUrl) return null;
  if (!/^https?:\/\//.test(imageUrl)) return imageUrl;
  try {
    const url = new URL(imageUrl);
    const pathParts = url.pathname.split('/');
    const bucketIndex = pathParts.findIndex(part => part === 'media');

    if (bucketIndex !== -1 && bucketIndex < pathParts.length - 1) {
      return pathParts.slice(bucketIndex + 1).join('/');
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Validate image file before upload
 */
export function validateImageFile(
  file: File,
  options: ImageUploadOptions = {}
): { valid: boolean; error?: string } {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check file type
  if (!opts.allowedTypes?.includes(file.type)) {
    return {
      valid: false,
      error: `File type ${file.type} not allowed. Allowed types: ${opts.allowedTypes?.join(', ')}`,
    };
  }

  // Check file size
  const maxSizeInBytes = (opts.maxSizeInMB || 50) * 1024 * 1024;
  if (file.size > maxSizeInBytes) {
    return {
      valid: false,
      error: `File size too large. Maximum size: ${opts.maxSizeInMB}MB`,
    };
  }

  return { valid: true };
}