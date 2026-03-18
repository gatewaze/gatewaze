// @ts-nocheck
import { XMarkIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/ui-legacy';
import { EventMedia, getMediaPublicUrl } from '@/utils/eventMediaService';

interface MediaViewerModalProps {
  media: EventMedia;
  onClose: () => void;
}

export function MediaViewerModal({ media, onClose }: MediaViewerModalProps) {
  // Determine display URL based on upload method
  let displayUrl = '';
  let originalUrl = '';

  if (media.file_type === 'photo') {
    displayUrl = getMediaPublicUrl(media.storage_path, { width: 800, height: 800, quality: 85, resize: 'contain' });
    originalUrl = getMediaPublicUrl(media.storage_path);
  } else if (media.file_type === 'video') {
    if (media.upload_method === 'youtube' && media.youtube_embed_url) {
      // Use YouTube embed for YouTube videos
      displayUrl = media.youtube_embed_url;
      originalUrl = media.youtube_url || '';
    } else {
      displayUrl = getMediaPublicUrl(media.storage_path);
      originalUrl = getMediaPublicUrl(media.storage_path);
    }
  }

  const handleDownload = () => {
    if (media.upload_method === 'youtube') {
      // For YouTube videos, open in new tab instead of downloading
      window.open(originalUrl, '_blank');
      return;
    }

    // Download the original file for non-YouTube media
    const link = document.createElement('a');
    link.href = originalUrl;
    link.download = media.file_name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Modal isOpen={true} onClose={onClose} size="xl">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
            {media.caption || media.file_name}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-surface-3"
              title="Download original"
            >
              <ArrowDownTrayIcon className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-surface-3 dark:hover:text-gray-300"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Media Display */}
        <div className="relative bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden">
          {media.file_type === 'photo' ? (
            <img
              src={displayUrl}
              alt={media.caption || media.file_name}
              className="w-full h-auto max-h-[70vh] object-contain"
            />
          ) : media.upload_method === 'youtube' && media.youtube_embed_url ? (
            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
              <iframe
                src={displayUrl}
                title={media.caption || media.file_name}
                className="absolute top-0 left-0 w-full h-full"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <video
              src={displayUrl}
              controls
              className="w-full h-auto max-h-[70vh]"
            >
              Your browser does not support the video tag.
            </video>
          )}
        </div>

        {/* Media Info */}
        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
          {media.caption && (
            <p className="text-gray-900 dark:text-white">{media.caption}</p>
          )}
          <div className="flex flex-wrap gap-4">
            <span>
              <strong>Type:</strong> {media.file_type === 'photo' ? 'Photo' : 'Video'}
            </span>
            {media.upload_method === 'youtube' && (
              <span className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                YouTube
              </span>
            )}
            {media.width && media.height && (
              <span>
                <strong>Dimensions:</strong> {media.width} × {media.height}
              </span>
            )}
            {media.duration && (
              <span>
                <strong>Duration:</strong> {Math.floor(media.duration / 60)}:
                {String(Math.floor(media.duration % 60)).padStart(2, '0')}
              </span>
            )}
          </div>
          <p className="text-xs">
            Uploaded by {media.uploaded_by} on{' '}
            {new Date(media.created_at).toLocaleDateString()}
          </p>
          {media.upload_method === 'youtube' && media.youtube_url && (
            <p className="text-xs">
              <a
                href={media.youtube_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                View on YouTube →
              </a>
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
