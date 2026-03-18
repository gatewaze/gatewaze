// @ts-nocheck
import { useState, useEffect } from 'react';
import { ArrowPathIcon, CheckCircleIcon, XCircleIcon, ChevronDownIcon, ChevronUpIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { LumaUploadService, LumaCsvUpload } from '@/utils/lumaUploadService';
import { formatDistanceToNow } from 'date-fns';
import { cancelImport } from '@/utils/cancelStuckImports';
import { toast } from 'sonner';

interface LumaUploadStatusProps {
  brandId: string;
  eventId?: string;  // Optional: filter to only show uploads for this event
  calendarId?: string;  // Optional: filter to only show uploads for this calendar
}

export const LumaUploadStatus = ({ brandId, eventId, calendarId }: LumaUploadStatusProps) => {
  const [uploads, setUploads] = useState<LumaCsvUpload[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch recent uploads on mount
  useEffect(() => {
    const fetchUploads = async () => {
      setLoading(true);
      const recentUploads = await LumaUploadService.getRecentUploads(brandId, 5, eventId, calendarId);
      setUploads(recentUploads);
      setLoading(false);
    };

    fetchUploads();
  }, [brandId, eventId, calendarId]);

  // Subscribe to changes for any processing uploads
  useEffect(() => {
    const processingUploads = uploads.filter(u => u.status === 'processing' || u.status === 'pending');

    if (processingUploads.length === 0) return;

    const unsubscribes = processingUploads.map(upload =>
      LumaUploadService.subscribeToUploadStatus(upload.id, (updated) => {
        setUploads(prev => prev.map(u => u.id === updated.id ? updated : u));
      })
    );

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [uploads.map(u => u.id).join(',')]);

  // Poll for updates as fallback
  useEffect(() => {
    const processingUploads = uploads.filter(u => u.status === 'processing' || u.status === 'pending');

    if (processingUploads.length === 0) return;

    const pollInterval = setInterval(async () => {
      const recentUploads = await LumaUploadService.getRecentUploads(brandId, 5, eventId, calendarId);
      setUploads(recentUploads);

      // Stop polling if nothing is processing anymore
      const stillProcessing = recentUploads.some(u => u.status === 'processing' || u.status === 'pending');
      if (!stillProcessing) {
        clearInterval(pollInterval);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [brandId, eventId, calendarId, uploads.some(u => u.status === 'processing' || u.status === 'pending')]);

  // Filter to show only recent uploads (last 24 hours) or any that are still processing
  const relevantUploads = uploads.filter(upload => {
    const uploadTime = new Date(upload.uploaded_at).getTime();
    const now = Date.now();
    const isRecent = now - uploadTime < 24 * 60 * 60 * 1000; // 24 hours
    const isActive = upload.status === 'processing' || upload.status === 'pending';
    return isRecent || isActive;
  });

  if (loading || relevantUploads.length === 0) {
    return null;
  }

  const activeUploads = relevantUploads.filter(u => u.status === 'processing' || u.status === 'pending');
  const hasActiveUploads = activeUploads.length > 0;

  // Calculate overall progress for active uploads
  const totalRows = activeUploads.reduce((sum, u) => sum + u.row_count, 0);
  const processedRows = activeUploads.reduce((sum, u) => sum + u.processed_rows, 0);
  const overallProgress = totalRows > 0 ? Math.round((processedRows / totalRows) * 100) : 0;

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {hasActiveUploads ? (
            <ArrowPathIcon className="h-5 w-5 text-blue-500 animate-spin" />
          ) : (
            <CheckCircleIcon className="h-5 w-5 text-green-500" />
          )}
          <div className="text-left">
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {hasActiveUploads
                ? `Luma Import in Progress (${overallProgress}%)`
                : `${relevantUploads.length} Recent Luma Import${relevantUploads.length !== 1 ? 's' : ''}`
              }
            </span>
            {hasActiveUploads && (
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                {processedRows} / {totalRows} rows
              </span>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronUpIcon className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronDownIcon className="h-5 w-5 text-gray-400" />
        )}
      </button>

      {/* Progress bar for active uploads */}
      {hasActiveUploads && (
        <div className="h-1 bg-gray-200 dark:bg-gray-700">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {relevantUploads.map((upload) => (
            <UploadRow key={upload.id} upload={upload} />
          ))}
        </div>
      )}
    </div>
  );
};

const UploadRow = ({ upload }: { upload: LumaCsvUpload }) => {
  const [cancelling, setCancelling] = useState(false);
  const isProcessing = upload.status === 'processing' || upload.status === 'pending';
  const isComplete = upload.status === 'completed';
  const isFailed = upload.status === 'failed';
  const progress = upload.row_count > 0 ? Math.round((upload.processed_rows / upload.row_count) * 100) : 0;

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this import? This cannot be undone.')) {
      return;
    }

    setCancelling(true);
    try {
      const result = await cancelImport(upload.id);
      if (result.success) {
        toast.success('Import cancelled successfully');
      } else {
        toast.error(result.error || 'Failed to cancel import');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel import');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-gray-700 last:border-b-0">
      <div className="flex items-center gap-3 min-w-0">
        {isProcessing && <ArrowPathIcon className="h-4 w-4 text-blue-500 animate-spin shrink-0" />}
        {isComplete && <CheckCircleIcon className="h-4 w-4 text-green-500 shrink-0" />}
        {isFailed && <XCircleIcon className="h-4 w-4 text-red-500 shrink-0" />}

        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {upload.file_name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {upload.csv_type === 'event_guests' ? 'Event Guests' : upload.csv_type === 'calendar_members_import' ? 'Calendar Members Import' : 'Luma Calendar Members'}
            {' · '}
            {formatDistanceToNow(new Date(upload.uploaded_at), { addSuffix: true })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0 ml-4">
        {isProcessing && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors disabled:opacity-50"
            title="Cancel import"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}

        <div className="text-right">
        {isProcessing && (
          <div className="text-sm">
            <span className="font-medium text-blue-600 dark:text-blue-400">{progress}%</span>
            <span className="text-gray-500 dark:text-gray-400 text-xs block">
              {upload.processed_rows} / {upload.row_count}
            </span>
          </div>
        )}
        {isComplete && (
          <div className="text-sm">
            <span className="font-medium text-green-600 dark:text-green-400">
              {upload.registrations_created} {upload.csv_type === 'calendar_members_import' ? 'members' : 'registrations'}
            </span>
            <span className="text-gray-500 dark:text-gray-400 text-xs block">
              {upload.processed_rows} processed
            </span>
          </div>
        )}
        {isFailed && (
          <div className="text-sm">
            <span className="font-medium text-red-600 dark:text-red-400">Failed</span>
            {upload.error_count > 0 && (
              <span className="text-gray-500 dark:text-gray-400 text-xs block">
                {upload.error_count} errors
              </span>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
};
