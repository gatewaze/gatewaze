// @ts-nocheck
import { useState, useRef } from 'react';
import { toast } from 'sonner';
import {
  XMarkIcon,
  PhotoIcon,
  VideoCameraIcon,
  ArrowUpTrayIcon,
  DocumentIcon,
  ArchiveBoxIcon,
} from '@heroicons/react/24/outline';
import { Button, Modal, Input } from '@/components/ui-legacy';
import { supabase } from '@/lib/supabase';
import {
  EventMediaAlbum,
  uploadEventMedia,
  uploadVideoToYouTubeAndCreateRecord,
  validateMediaFile,
  formatFileSize,
} from '@/utils/eventMediaService';
import { isYouTubeConfigured } from '@/utils/youtubeService';

interface MediaUploadModalProps {
  eventId: string;
  albums: EventMediaAlbum[];
  onClose: () => void;
  onSuccess: () => void;
}

interface FileWithPreview {
  file: File;
  preview: string;
  type: 'photo' | 'video';
}

type UploadMode = 'files' | 'zip';

export function MediaUploadModal({ eventId, albums, onClose, onSuccess }: MediaUploadModalProps) {
  const [uploadMode, setUploadMode] = useState<UploadMode>('files');
  const [selectedFiles, setSelectedFiles] = useState<FileWithPreview[]>([]);
  const [selectedZipFile, setSelectedZipFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [selectedAlbums, setSelectedAlbums] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    processFiles(files);
  };

  const handleZipFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.zip')) {
        toast.error('Please select a ZIP file');
        return;
      }
      if (file.size > 500 * 1024 * 1024) { // 500MB limit for zip files
        toast.error('ZIP file must be less than 500MB');
        return;
      }
      setSelectedZipFile(file);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    processFiles(files);
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
  };

  const processFiles = (files: File[]) => {
    const validFiles: FileWithPreview[] = [];

    files.forEach(file => {
      const validation = validateMediaFile(file);
      if (!validation.valid) {
        toast.error(`${file.name}: ${validation.error}`);
        return;
      }

      const type = file.type.startsWith('image/') ? 'photo' : 'video';
      const preview = URL.createObjectURL(file);

      validFiles.push({ file, preview, type });
    });

    setSelectedFiles(prev => [...prev, ...validFiles]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => {
      const newFiles = [...prev];
      URL.revokeObjectURL(newFiles[index].preview);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  const toggleAlbum = (albumId: string) => {
    setSelectedAlbums(prev =>
      prev.includes(albumId)
        ? prev.filter(id => id !== albumId)
        : [...prev, albumId]
    );
  };

  const handleUpload = async () => {
    if (uploadMode === 'files') {
      await handleFilesUpload();
    } else {
      await handleZipUpload();
    }
  };

  const handleFilesUpload = async () => {
    if (selectedFiles.length === 0) {
      toast.error('Please select at least one file');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    // Check YouTube configuration for videos
    const hasVideos = selectedFiles.some(f => f.type === 'video');
    const youtubeConfigured = isYouTubeConfigured();

    if (hasVideos && !youtubeConfigured) {
      toast.error('YouTube is not configured. Videos cannot be uploaded at this time.');
      setUploading(false);
      return;
    }

    try {
      const total = selectedFiles.length;
      let completed = 0;

      for (let i = 0; i < selectedFiles.length; i++) {
        const { file, type } = selectedFiles[i];
        let result;

        if (type === 'video') {
          // Upload videos to YouTube with progress tracking
          result = await uploadVideoToYouTubeAndCreateRecord(file, eventId, {
            caption: caption || undefined,
            albumIds: selectedAlbums.length > 0 ? selectedAlbums : undefined,
            brandName: import.meta.env.VITE_BRAND_NAME || 'Event',
            onProgress: (progress) => {
              // Calculate overall progress including completed files and current file progress
              const baseProgress = (completed / total) * 100;
              const currentFileProgress = (progress / 100) * (1 / total) * 100;
              setUploadProgress(Math.round(baseProgress + currentFileProgress));
            },
          });
        } else {
          // Upload photos to Supabase Storage
          result = await uploadEventMedia(file, eventId, {
            fileType: type,
            caption: caption || undefined,
            albumIds: selectedAlbums.length > 0 ? selectedAlbums : undefined,
          });
        }

        if (!result.success) {
          toast.error(`Failed to upload ${file.name}: ${result.error}`);
        } else {
          completed++;
          // Show info message for pending YouTube uploads
          if (result.isPending) {
            toast.info(`${file.name} uploaded - YouTube processing will begin shortly`, {
              duration: 5000,
            });
          }
        }

        // Update progress after each file completes
        setUploadProgress(Math.round((completed / total) * 100));
      }

      if (completed === total) {
        const hasPending = selectedFiles.some(
          ({ file, type }) => type === 'video' && file.size / (1024 * 1024) >= 50
        );
        if (hasPending) {
          toast.success(
            `Successfully uploaded ${completed} file${completed > 1 ? 's' : ''}. Large videos will be processed in the background.`,
            { duration: 6000 }
          );
        } else {
          toast.success(`Successfully uploaded ${completed} file${completed > 1 ? 's' : ''}`);
        }
        onSuccess();
      } else if (completed > 0) {
        toast.warning(`Uploaded ${completed} of ${total} files`);
        onSuccess();
      } else {
        toast.error('Failed to upload any files');
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('An error occurred during upload');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleZipUpload = async () => {
    if (!selectedZipFile) {
      toast.error('Please select a ZIP file');
      return;
    }

    setUploading(true);
    setUploadProgress(10);

    try {
      // 1. Upload ZIP file to storage
      const timestamp = Date.now();
      const storagePath = `events/${eventId}/zip-uploads/${timestamp}-${selectedZipFile.name}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('event-media')
        .upload(storagePath, selectedZipFile, {
          contentType: 'application/zip',
          cacheControl: '3600',
        });

      if (uploadError) {
        throw new Error(`Failed to upload ZIP file: ${uploadError.message}`);
      }

      setUploadProgress(50);

      // 2. Create zip upload record (will trigger processing if Edge Function is set up)
      const { data: zipUpload, error: dbError } = await supabase
        .from('event_media_zip_uploads')
        .insert({
          event_id: eventId,
          file_name: selectedZipFile.name,
          storage_path: uploadData.path,
          file_size: selectedZipFile.size,
          status: 'pending',
        })
        .select()
        .single();

      if (dbError) {
        // Rollback: delete uploaded file
        await supabase.storage.from('event-media').remove([uploadData.path]);
        throw new Error(`Failed to create upload record: ${dbError.message}`);
      }

      setUploadProgress(100);

      // Trigger the Edge Function to process the ZIP
      try {
        // Use supabase.functions.invoke which handles URL and auth automatically
        supabase.functions.invoke('process-media-zip', {
          body: { zipUploadId: zipUpload.id },
        }).catch(err => {
          console.error('Failed to trigger ZIP processing:', err);
        });
      } catch (triggerError) {
        console.error('Error triggering processing:', triggerError);
      }

      toast.success(
        'ZIP file uploaded successfully! Processing has started. You can close this dialog.',
        { duration: 5000 }
      );

      // Give user time to read the message
      setTimeout(() => {
        onSuccess();
      }, 2000);
    } catch (error) {
      console.error('ZIP upload error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to upload ZIP file');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const photoCount = selectedFiles.filter(f => f.type === 'photo').length;
  const videoCount = selectedFiles.filter(f => f.type === 'video').length;
  const totalSize = selectedFiles.reduce((acc, f) => acc + f.file.size, 0);

  return (
    <Modal isOpen={true} onClose={onClose} size="lg">
      <div className="flex flex-col" style={{ height: '80vh', maxHeight: '800px' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Upload Media
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Upload Mode Selector */}
          <div className="flex gap-2">
            <button
              onClick={() => setUploadMode('files')}
              disabled={uploading}
              className={`flex-1 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
              uploadMode === 'files'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-surface-3 dark:text-gray-300 dark:hover:bg-surface-4'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <PhotoIcon className="h-5 w-5" />
                <span>Individual Files</span>
              </div>
            </button>
            <button
              onClick={() => setUploadMode('zip')}
              disabled={uploading}
              className={`flex-1 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                uploadMode === 'zip'
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-surface-3 dark:text-gray-300 dark:hover:bg-surface-4'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <ArchiveBoxIcon className="h-5 w-5" />
                <span>ZIP File</span>
              </div>
            </button>
          </div>

          {/* Upload Area - Individual Files */}
          {uploadMode === 'files' && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center hover:border-gray-400 dark:border-gray-600 dark:bg-surface-3 dark:hover:border-gray-500"
            >
              <ArrowUpTrayIcon className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
                Click to upload or drag and drop
              </p>
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                Photos up to 100MB • Videos up to 500MB
              </p>
              <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                ⚠️ Videos larger than 500MB may fail to upload due to platform limitations
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          )}

          {/* Upload Area - ZIP File */}
          {uploadMode === 'zip' && (
            <div
              onClick={() => zipInputRef.current?.click()}
              className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center hover:border-gray-400 dark:border-gray-600 dark:bg-surface-3 dark:hover:border-gray-500"
            >
              <ArchiveBoxIcon className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
                Click to select a ZIP file
              </p>
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                ZIP files up to 500MB • Folders will become albums
              </p>
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip"
                onChange={handleZipFileSelect}
                className="hidden"
              />
            </div>
          )}

          {/* Selected ZIP File */}
          {uploadMode === 'zip' && selectedZipFile && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                Selected ZIP File
              </h3>
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-surface-2">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded bg-gray-100 dark:bg-gray-800">
                  <ArchiveBoxIcon className="h-6 w-6 text-gray-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {selectedZipFile.name}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {formatFileSize(selectedZipFile.size)}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedZipFile(null)}
                  className="flex-shrink-0 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                ℹ️ After upload, the ZIP file will be processed automatically. Folders inside the ZIP will become albums.
              </p>
            </div>
          )}

          {/* Selected Files */}
          {uploadMode === 'files' && selectedFiles.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                  Selected Files ({selectedFiles.length})
                </h3>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {photoCount > 0 && `${photoCount} photo${photoCount > 1 ? 's' : ''}`}
                  {photoCount > 0 && videoCount > 0 && ', '}
                  {videoCount > 0 && `${videoCount} video${videoCount > 1 ? 's' : ''}`}
                  {' · '}
                  {formatFileSize(totalSize)}
                </div>
              </div>

              <div className="max-h-64 space-y-2 overflow-y-auto">
                {selectedFiles.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-surface-2"
                  >
                    <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded">
                      {item.type === 'photo' ? (
                        <img
                          src={item.preview}
                          alt={item.file.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gray-100 dark:bg-gray-800">
                          <VideoCameraIcon className="h-6 w-6 text-gray-400" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                        {item.file.name}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {formatFileSize(item.file.size)}
                      </p>
                    </div>
                    <button
                      onClick={() => removeFile(index)}
                      className="flex-shrink-0 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Caption - Only for individual files */}
          {uploadMode === 'files' && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
                Caption (optional)
              </label>
              <Input
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="Add a caption for these files..."
                disabled={uploading}
              />
            </div>
          )}

          {/* Albums - Only for individual files */}
          {uploadMode === 'files' && albums.length > 0 && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
                Add to Albums (optional)
              </label>
              <div className="flex flex-wrap gap-2">
                {albums.map(album => (
                  <button
                    key={album.id}
                    onClick={() => toggleAlbum(album.id)}
                    disabled={uploading}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      selectedAlbums.includes(album.id)
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-surface-3 dark:text-gray-300 dark:hover:bg-surface-4'
                    }`}
                  >
                    {album.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Fixed Footer with Progress and Actions */}
        <div className="border-t border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-surface-2">
          {/* Upload Progress */}
          {uploading && (
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Uploading...</span>
                <span className="font-medium text-gray-900 dark:text-white">{uploadProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full bg-primary-600 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose} disabled={uploading}>
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={
                (uploadMode === 'files' && selectedFiles.length === 0) ||
                (uploadMode === 'zip' && !selectedZipFile) ||
                uploading
              }
            >
              {uploading
                ? 'Uploading...'
                : uploadMode === 'files'
                ? `Upload ${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''}`
                : 'Upload ZIP File'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
