/**
 * Chunked Upload Service for Large Files
 *
 * This service handles large file uploads by splitting them into chunks
 * and uploading them sequentially to avoid timeout issues.
 *
 * Supabase Storage has a timeout limit that causes 524 errors for large files.
 * This implementation works around that limitation.
 */

import { supabase } from '@/lib/supabase';

interface ChunkedUploadOptions {
  bucket: string;
  path: string;
  file: File;
  eventId: string; // Required for database tracking
  chunkSize?: number; // Size of each chunk in bytes
  onProgress?: (progress: number) => void;
  onChunkComplete?: (chunkNumber: number, totalChunks: number) => void;
  metadata?: Record<string, any>; // Additional metadata (caption, albumIds, etc.)
}

interface ChunkedUploadResult {
  success: boolean;
  path?: string;
  error?: string;
}

// Use 10MB chunks for more reliable uploads to avoid timeouts
// Smaller chunks upload faster and are less likely to timeout
const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

/**
 * Upload a large file using chunked/multipart upload strategy
 */
export async function uploadLargeFile(options: ChunkedUploadOptions): Promise<ChunkedUploadResult> {
  const {
    bucket,
    path,
    file,
    chunkSize = DEFAULT_CHUNK_SIZE,
    onProgress,
    onChunkComplete
  } = options;

  try {
    const fileSizeMB = file.size / (1024 * 1024);
    const chunkSizeMB = chunkSize / (1024 * 1024);
    console.log(`Starting chunked upload for ${file.name} (${fileSizeMB.toFixed(2)}MB)`);

    // Calculate chunks
    const totalChunks = Math.ceil(file.size / chunkSize);
    console.log(`File will be uploaded in ${totalChunks} chunks of ${chunkSizeMB}MB each`);
    console.log(`Estimated upload time: ${Math.ceil(totalChunks * 0.5)} - ${Math.ceil(totalChunks * 2)} minutes`);

    // For files smaller than chunk size, use regular upload
    if (totalChunks === 1) {
      console.log('File is small enough for single upload');
      return await uploadSingleFile(bucket, path, file, onProgress);
    }

    // For larger files, we need to use a different strategy
    // Since Supabase doesn't support native multipart uploads,
    // we'll upload chunks as separate files and then combine them server-side
    // OR we can use a different approach with TUS protocol if available

    // Check if we can use TUS resumable uploads (if Supabase supports it)
    const useTus = await checkTusSupport();
    if (useTus) {
      return await uploadWithTus(bucket, path, file, chunkSize, onProgress, onChunkComplete);
    }

    // Fallback: Upload as chunks and combine
    return await uploadInChunks(bucket, path, file, chunkSize, onProgress, onChunkComplete);

  } catch (error) {
    console.error('Chunked upload failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during chunked upload'
    };
  }
}

/**
 * Upload a single file (for smaller files)
 */
async function uploadSingleFile(
  bucket: string,
  path: string,
  file: File,
  onProgress?: (progress: number) => void
): Promise<ChunkedUploadResult> {
  try {
    // Get authenticated session
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return {
        success: false,
        error: 'Authentication required for upload'
      };
    }

    // Use XMLHttpRequest for progress tracking
    const xhr = new XMLHttpRequest();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const projectRef = extractProjectRef(session.access_token);
    const storageUrl = projectRef
      ? `https://${projectRef}.storage.supabase.co`
      : supabaseUrl;

    const uploadUrl = `${storageUrl}/storage/v1/object/${bucket}/${path}`;

    return new Promise((resolve) => {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const percentComplete = (e.loaded / e.total) * 100;
          onProgress(percentComplete);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200 || xhr.status === 201) {
          resolve({ success: true, path });
        } else {
          const errorMessage = `Upload failed with status ${xhr.status}`;
          console.error(errorMessage, xhr.responseText);
          resolve({ success: false, error: errorMessage });
        }
      });

      xhr.addEventListener('error', () => {
        resolve({ success: false, error: 'Network error during upload' });
      });

      xhr.addEventListener('timeout', () => {
        resolve({ success: false, error: 'Upload timeout - file too large for single upload' });
      });

      xhr.open('POST', uploadUrl);
      xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
      xhr.setRequestHeader('apikey', session.access_token);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('x-upsert', 'true');

      // Set a longer timeout for large files (10 minutes)
      xhr.timeout = 600000;

      xhr.send(file);
    });

  } catch (error) {
    console.error('Single file upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed'
    };
  }
}

/**
 * Upload file in chunks (fallback method)
 */
async function uploadInChunks(
  bucket: string,
  path: string,
  file: File,
  chunkSize: number,
  onProgress?: (progress: number) => void,
  onChunkComplete?: (chunkNumber: number, totalChunks: number) => void
): Promise<ChunkedUploadResult> {
  const totalChunks = Math.ceil(file.size / chunkSize);
  const chunkPaths: string[] = [];
  let uploadedBytes = 0;

  // Upload each chunk
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);

    const chunkPath = `${path}.part${i.toString().padStart(5, '0')}`;
    const chunkSizeMB = (chunk.size / (1024 * 1024)).toFixed(2);

    console.log(`Uploading chunk ${i + 1}/${totalChunks} (${chunkSizeMB}MB, bytes ${start}-${end})`);
    console.log(`Chunk path: ${chunkPath}`);

    // Retry logic for each chunk
    let retries = 0;
    let uploaded = false;

    while (retries < MAX_RETRIES && !uploaded) {
      try {
        // Get authenticated session for chunk upload
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          throw new Error('Authentication required for chunk upload');
        }

        // Use direct API call with authentication for chunk upload
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const projectRef = extractProjectRef(session.access_token);
        const storageUrl = projectRef
          ? `https://${projectRef}.storage.supabase.co`
          : supabaseUrl;

        const uploadUrl = `${storageUrl}/storage/v1/object/${bucket}/${chunkPath}`;

        // Upload chunk using XMLHttpRequest for better control
        const uploadResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
          const xhr = new XMLHttpRequest();

          xhr.addEventListener('load', () => {
            if (xhr.status === 200 || xhr.status === 201) {
              resolve({ success: true });
            } else {
              let errorMsg = `Chunk upload failed with status ${xhr.status}`;
              try {
                const errorData = JSON.parse(xhr.responseText);
                errorMsg = errorData.message || errorData.error || errorMsg;
              } catch {
                errorMsg = xhr.responseText || errorMsg;
              }
              resolve({ success: false, error: errorMsg });
            }
          });

          xhr.addEventListener('error', () => {
            resolve({ success: false, error: 'Network error during chunk upload' });
          });

          xhr.addEventListener('timeout', () => {
            resolve({ success: false, error: 'Chunk upload timeout' });
          });

          xhr.open('POST', uploadUrl);
          xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
          xhr.setRequestHeader('apikey', session.access_token);
          xhr.setRequestHeader('Content-Type', 'application/octet-stream');
          xhr.setRequestHeader('x-upsert', 'true');

          // Set timeout for chunk upload (2 minutes should be enough for 50MB)
          xhr.timeout = 120000;

          xhr.send(chunk);
        });

        if (!uploadResult.success) {
          throw new Error(uploadResult.error || 'Chunk upload failed');
        }

        uploaded = true;
        uploadedBytes += chunk.size;
        chunkPaths.push(chunkPath);

        console.log(`✅ Chunk ${i + 1}/${totalChunks} uploaded successfully`);
        console.log(`Progress: ${uploadedBytes}/${file.size} bytes (${((uploadedBytes / file.size) * 100).toFixed(1)}%)`);

        // Update progress
        if (onProgress) {
          const totalProgress = (uploadedBytes / file.size) * 100;
          onProgress(totalProgress);
        }

        if (onChunkComplete) {
          onChunkComplete(i + 1, totalChunks);
        }

      } catch (error) {
        retries++;
        console.error(`Chunk ${i + 1} upload attempt ${retries} failed:`, error);

        if (retries >= MAX_RETRIES) {
          // Clean up uploaded chunks
          await cleanupChunks(bucket, chunkPaths);
          return {
            success: false,
            error: `Failed to upload chunk ${i + 1} after ${MAX_RETRIES} attempts`
          };
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * retries));
      }
    }
  }

  // After all chunks are uploaded, we need to combine them
  console.log('All chunks uploaded successfully.');

  // For very large files (>1GB), skip combination and just create a reference
  const fileSizeGB = file.size / (1024 * 1024 * 1024);
  if (fileSizeGB > 1) {
    console.log('File is too large for in-memory combination. Creating chunked reference...');

  // Create a marker file to indicate chunks are ready for combining
  const markerData = {
    originalName: file.name,
    totalChunks,
    chunkSize,
    totalSize: file.size,
    mimeType: file.type,
    chunks: chunkPaths,
    timestamp: new Date().toISOString()
  };

  const markerPath = `${path}.complete`;
  const { error: markerError } = await supabase.storage
    .from(bucket)
    .upload(markerPath, new Blob([JSON.stringify(markerData)], { type: 'application/json' }), {
      contentType: 'application/json',
      upsert: true
    });

  if (markerError) {
    console.error('Failed to create completion marker:', markerError);
    await cleanupChunks(bucket, chunkPaths);
    return {
      success: false,
      error: 'Failed to finalize chunked upload'
    };
  }

  // Trigger server-side combination of chunks
  try {
    console.log('Triggering chunk combination on server...');
    const { data, error } = await supabase.functions.invoke('media-combine-chunks', {
      body: {
        bucket,
        finalPath: path,
        markerPath
      }
    });

    if (error) {
      console.error('Failed to combine chunks:', error);
      await cleanupChunks(bucket, chunkPaths);
      return {
        success: false,
        error: 'Failed to combine chunks on server'
      };
    }

    if (data?.success) {
      console.log('Chunks combined successfully on server');
      return {
        success: true,
        path: path
      };
    } else {
      console.error('Server failed to combine chunks:', data?.error);
      await cleanupChunks(bucket, chunkPaths);
      return {
        success: false,
        error: data?.error || 'Failed to combine chunks'
      };
    }
  } catch (combineError) {
    console.error('Error calling combine function:', combineError);
    await cleanupChunks(bucket, chunkPaths);
    return {
      success: false,
      error: 'Failed to trigger chunk combination'
    };
  }
}

/**
 * Upload using TUS resumable upload protocol (if supported)
 */
async function uploadWithTus(
  bucket: string,
  path: string,
  file: File,
  chunkSize: number,
  onProgress?: (progress: number) => void,
  onChunkComplete?: (chunkNumber: number, totalChunks: number) => void
): Promise<ChunkedUploadResult> {
  // TUS implementation would go here if Supabase adds support
  // For now, fall back to chunk upload
  console.log('TUS not yet supported, falling back to chunk upload');
  return uploadInChunks(bucket, path, file, chunkSize, onProgress, onChunkComplete);
}

/**
 * Check if TUS resumable uploads are supported
 */
async function checkTusSupport(): Promise<boolean> {
  // Check if Supabase supports TUS protocol
  // This would involve checking for TUS headers in OPTIONS request
  return false; // Not yet supported by Supabase
}

/**
 * Clean up uploaded chunks in case of failure
 */
async function cleanupChunks(bucket: string, chunkPaths: string[]): Promise<void> {
  if (chunkPaths.length === 0) return;

  console.log('Cleaning up uploaded chunks...');
  try {
    const { error } = await supabase.storage
      .from(bucket)
      .remove(chunkPaths);

    if (error) {
      console.error('Failed to clean up chunks:', error);
    }
  } catch (error) {
    console.error('Error during chunk cleanup:', error);
  }
}

/**
 * Extract project reference from JWT token
 */
function extractProjectRef(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.ref || null;
  } catch {
    return null;
  }
}