/**
 * Event Content Image Service
 *
 * Downloads images from external sources (lumacdn.com) and uploads them
 * to Supabase Storage for event content processing.
 */

import { supabase } from '../supabase-client.js';

const CONTENT_IMAGES_BUCKET = 'event-content-images';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * @typedef {Object} ImageUploadResult
 * @property {boolean} success
 * @property {string} [publicUrl] - Public URL of the uploaded image
 * @property {string} [storagePath] - Path in storage bucket
 * @property {string} [error] - Error message if failed
 */

/**
 * Initialize the storage bucket if it doesn't exist
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function initializeBucket() {
  try {
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();

    if (listError) {
      console.error('Failed to list buckets:', listError);
      return { success: false, error: listError.message };
    }

    const bucketExists = buckets?.some((b) => b.name === CONTENT_IMAGES_BUCKET);

    if (!bucketExists) {
      const { error: createError } = await supabase.storage.createBucket(CONTENT_IMAGES_BUCKET, {
        public: true,
        fileSizeLimit: MAX_FILE_SIZE,
        allowedMimeTypes: ALLOWED_TYPES,
      });

      if (createError) {
        console.error('Failed to create bucket:', createError);
        return { success: false, error: createError.message };
      }

      console.log(`✅ Created storage bucket: ${CONTENT_IMAGES_BUCKET}`);
    }

    return { success: true };
  } catch (error) {
    console.error('Bucket initialization error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get content type from response headers or URL
 * @param {Response} response
 * @param {string} url
 * @returns {string}
 */
function getContentType(response, url) {
  const headerType = response.headers.get('content-type');
  if (headerType && headerType.startsWith('image/')) {
    return headerType.split(';')[0];
  }

  // Fallback to URL extension
  const extension = url.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return 'image/jpeg'; // Default to JPEG
  }
}

/**
 * Get file extension from content type
 * @param {string} contentType
 * @returns {string}
 */
function getExtension(contentType) {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'jpg';
  }
}

/**
 * Download an image from an external URL and upload to Supabase Storage
 * @param {string} imageUrl - External URL to download from
 * @param {string} eventId - Event UUID for organizing storage
 * @param {number} imageIndex - Index of the image in the document
 * @returns {Promise<ImageUploadResult>}
 */
export async function downloadAndUploadImage(imageUrl, eventId, imageIndex) {
  try {
    console.log(`  📥 Downloading image ${imageIndex}: ${imageUrl.substring(0, 80)}...`);

    // Download the image
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to download image: ${response.status} ${response.statusText}`,
      };
    }

    // Get blob and validate
    const blob = await response.blob();

    if (blob.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `Image too large: ${(blob.size / 1024 / 1024).toFixed(2)}MB (max: 10MB)`,
      };
    }

    const contentType = getContentType(response, imageUrl);
    if (!ALLOWED_TYPES.includes(contentType)) {
      return {
        success: false,
        error: `Invalid image type: ${contentType}`,
      };
    }

    // Generate unique filename
    const extension = getExtension(contentType);
    const timestamp = Date.now();
    const fileName = `content-${imageIndex}-${timestamp}.${extension}`;
    const storagePath = `${eventId}/${fileName}`;

    console.log(`  📤 Uploading to storage: ${storagePath}`);

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(CONTENT_IMAGES_BUCKET)
      .upload(storagePath, blob, {
        contentType,
        cacheControl: '31536000', // Cache for 1 year
        upsert: false,
      });

    if (uploadError) {
      return {
        success: false,
        error: `Upload failed: ${uploadError.message}`,
      };
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from(CONTENT_IMAGES_BUCKET).getPublicUrl(storagePath);

    console.log(`  ✅ Image uploaded: ${storagePath}`);

    return {
      success: true,
      publicUrl: urlData.publicUrl,
      storagePath,
    };
  } catch (error) {
    console.error(`  ❌ Image processing error:`, error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Process all images from a ProseMirror document
 * Downloads from external URLs and uploads to Supabase
 * @param {Array<{originalUrl: string, index: number}>} images - Images extracted from ProseMirror
 * @param {string} eventId - Event UUID
 * @returns {Promise<Map<string, string>>} Map of original URL -> new public URL
 */
export async function processAllImages(images, eventId) {
  const urlMap = new Map();

  if (!images || images.length === 0) {
    return urlMap;
  }

  console.log(`📷 Processing ${images.length} images for event ${eventId}`);

  // Ensure bucket exists
  await initializeBucket();

  // Process images sequentially to avoid rate limits
  for (const image of images) {
    const result = await downloadAndUploadImage(image.originalUrl, eventId, image.index);

    if (result.success && result.publicUrl) {
      urlMap.set(image.originalUrl, result.publicUrl);
    } else {
      console.warn(`  ⚠️ Failed to process image ${image.index}: ${result.error}`);
      // Keep original URL on failure
      urlMap.set(image.originalUrl, image.originalUrl);
    }

    // Small delay between downloads to be nice to the source server
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`📷 Processed ${urlMap.size} images, ${images.length - urlMap.size} failures`);

  return urlMap;
}

/**
 * Delete all content images for an event
 * @param {string} eventId - Event UUID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteEventImages(eventId) {
  try {
    const { data: files, error: listError } = await supabase.storage
      .from(CONTENT_IMAGES_BUCKET)
      .list(eventId);

    if (listError) {
      return { success: false, error: listError.message };
    }

    if (!files || files.length === 0) {
      return { success: true };
    }

    const filePaths = files.map((f) => `${eventId}/${f.name}`);

    const { error: deleteError } = await supabase.storage.from(CONTENT_IMAGES_BUCKET).remove(filePaths);

    if (deleteError) {
      return { success: false, error: deleteError.message };
    }

    console.log(`🗑️ Deleted ${filePaths.length} content images for event ${eventId}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export default {
  initializeBucket,
  downloadAndUploadImage,
  processAllImages,
  deleteEventImages,
};
