/**
 * S3 Multipart Upload Service
 *
 * Uses AWS S3's native multipart upload API to handle large file uploads.
 * This bypasses Supabase Storage's timeout limitations by using S3 directly.
 *
 * Setup Instructions:
 * 1. Get S3 credentials from Supabase Dashboard:
 *    - Go to Project Settings > Storage
 *    - Find "S3 Connection" details
 * 2. Add to environment variables:
 *    - VITE_S3_ENDPOINT
 *    - VITE_S3_REGION
 *    - VITE_S3_ACCESS_KEY_ID
 *    - VITE_S3_SECRET_ACCESS_KEY
 *    - VITE_S3_BUCKET (usually matches your storage bucket name)
 */

import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

interface S3MultipartUploadOptions {
  file: File;
  key: string; // S3 object key (path)
  bucket?: string; // Defaults to env variable
  onProgress?: (progress: { loaded: number; total: number; percentage: number }) => void;
  metadata?: Record<string, string>;
}

interface S3UploadResult {
  success: boolean;
  location?: string;
  key?: string;
  error?: string;
}

/**
 * Check if S3 credentials are configured
 */
export function isS3Configured(): boolean {
  return !!(
    import.meta.env.VITE_S3_ENDPOINT &&
    import.meta.env.VITE_S3_REGION &&
    import.meta.env.VITE_S3_ACCESS_KEY_ID &&
    import.meta.env.VITE_S3_SECRET_ACCESS_KEY &&
    import.meta.env.VITE_S3_BUCKET
  );
}

/**
 * Get S3 configuration from environment variables
 */
function getS3Config() {
  if (!isS3Configured()) {
    throw new Error('S3 credentials not configured. Please add S3 environment variables.');
  }

  return {
    endpoint: import.meta.env.VITE_S3_ENDPOINT,
    region: import.meta.env.VITE_S3_REGION,
    accessKeyId: import.meta.env.VITE_S3_ACCESS_KEY_ID,
    secretAccessKey: import.meta.env.VITE_S3_SECRET_ACCESS_KEY,
    bucket: import.meta.env.VITE_S3_BUCKET,
  };
}

/**
 * Upload a large file using S3 multipart upload
 * This handles files of any size without timeout issues
 */
export async function uploadToS3Multipart(
  options: S3MultipartUploadOptions
): Promise<S3UploadResult> {
  const { file, key, bucket, onProgress, metadata } = options;

  try {
    console.log(`Starting S3 multipart upload for ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)}MB)`);

    // Get S3 configuration
    const config = getS3Config();
    const targetBucket = bucket || config.bucket;

    // Create S3 client
    const s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Force path style for Supabase compatibility
      forcePathStyle: true,
    });

    // Create multipart upload
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: targetBucket,
        Key: key,
        Body: file,
        ContentType: file.type,
        Metadata: metadata,
      },
      // Optimal part size for large files (10MB chunks)
      partSize: 10 * 1024 * 1024, // 10MB
      queueSize: 4, // Upload 4 parts concurrently
    });

    // Track progress
    upload.on('httpUploadProgress', (progress) => {
      if (onProgress && progress.loaded !== undefined && progress.total !== undefined) {
        const percentage = (progress.loaded / progress.total) * 100;
        onProgress({
          loaded: progress.loaded,
          total: progress.total,
          percentage,
        });
        console.log(`Upload progress: ${percentage.toFixed(1)}% (${progress.loaded}/${progress.total} bytes)`);
      }
    });

    // Perform the upload
    const result = await upload.done();

    console.log('S3 multipart upload completed successfully');
    console.log('Location:', result.Location);
    console.log('Key:', result.Key);

    return {
      success: true,
      location: result.Location,
      key: result.Key,
    };

  } catch (error) {
    console.error('S3 multipart upload failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'S3 upload failed',
    };
  }
}

/**
 * Convert Supabase storage path to S3 key format
 * Example: events/event123/videos/original/video.mp4 -> events/event123/videos/original/video.mp4
 */
export function convertStoragePathToS3Key(storagePath: string): string {
  // Remove leading slashes if any
  return storagePath.replace(/^\/+/, '');
}

/**
 * Generate a pre-signed URL for S3 object (if needed for direct access)
 * Note: Supabase Storage provides its own URL system, so this is optional
 */
export function getSupabaseStorageUrl(bucket: string, path: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}