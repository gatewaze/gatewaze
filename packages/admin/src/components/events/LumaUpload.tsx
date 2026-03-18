// @ts-nocheck
import { useState, useRef, useEffect } from 'react';
import { ArrowUpTrayIcon, InformationCircleIcon, CheckCircleIcon, XCircleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { Button, Modal, Badge } from '@/components/ui-legacy';
import { LumaUploadService, LumaCsvType, LumaCsvUpload } from '@/utils/lumaUploadService';
import { toast } from 'sonner';
import { useAuthContext } from '@/app/contexts/auth/context';

interface LumaUploadProps {
  eventId?: string;
  lumaEventId?: string;
  brandId: string;
  onComplete?: () => void;
}

export const LumaUpload = ({ eventId, brandId, onComplete }: LumaUploadProps) => {
  const { user } = useAuthContext();
  const [showModal, setShowModal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [csvType, setCsvType] = useState<LumaCsvType | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<LumaCsvUpload | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to upload status changes when we have an active upload
  useEffect(() => {
    if (!uploadStatus?.id || uploadStatus.status === 'completed' || uploadStatus.status === 'failed') {
      return;
    }

    const unsubscribe = LumaUploadService.subscribeToUploadStatus(
      uploadStatus.id,
      (updated) => {
        setUploadStatus(updated);

        if (updated.status === 'completed') {
          toast.success(`Processing complete: ${updated.processed_rows} rows processed, ${updated.registrations_created} registrations created`);
          if (onComplete) {
            onComplete();
          }
        } else if (updated.status === 'failed') {
          toast.error('Processing failed. Check the errors below.');
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [uploadStatus?.id, uploadStatus?.status, onComplete]);

  // Poll for status updates as a fallback (in case realtime doesn't work)
  useEffect(() => {
    if (!uploadStatus?.id || uploadStatus.status === 'completed' || uploadStatus.status === 'failed') {
      return;
    }

    const pollInterval = setInterval(async () => {
      const status = await LumaUploadService.getUploadStatus(uploadStatus.id);
      if (status) {
        setUploadStatus(status);

        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(pollInterval);
        }
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [uploadStatus?.id, uploadStatus?.status]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }

    setFile(selectedFile);
    setCsvType(null);
    setRowCount(0);
    setUploadStatus(null);

    try {
      const { type, rows } = await LumaUploadService.parseCsvFile(selectedFile);
      setCsvType(type);
      setRowCount(rows.length);
      toast.success(`Detected ${type === 'event_guests' ? 'Event Guests' : 'Calendar Members'} CSV with ${rows.length} rows`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to parse CSV file');
      setFile(null);
    }
  };

  const handleUpload = async () => {
    if (!file || !csvType || !user?.id) return;

    setUploading(true);

    try {
      // Upload for background processing - returns immediately
      const { uploadId, rowCount: count, csvType: type } = await LumaUploadService.uploadForBackgroundProcessing(
        file,
        brandId,
        user.id,
        { eventId }
      );

      toast.success(`CSV uploaded! Processing ${count} ${type === 'event_guests' ? 'event guests' : 'calendar members'} in background...`);

      // Get initial status
      const status = await LumaUploadService.getUploadStatus(uploadId);
      if (status) {
        setUploadStatus(status);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload CSV');
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setCsvType(null);
    setRowCount(0);
    setUploadStatus(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setShowModal(false);
      // Don't reset if processing - allow user to reopen and check status
      if (!uploadStatus || uploadStatus.status === 'completed' || uploadStatus.status === 'failed') {
        handleReset();
      }
    }
  };

  const isProcessing = uploadStatus?.status === 'processing' || uploadStatus?.status === 'pending';
  const isComplete = uploadStatus?.status === 'completed';
  const isFailed = uploadStatus?.status === 'failed';
  const progressPercent = uploadStatus && uploadStatus.row_count > 0
    ? Math.round((uploadStatus.processed_rows / uploadStatus.row_count) * 100)
    : 0;

  // Footer content with progress bar and buttons
  const footerContent = (
    <div className="px-6 py-4">
      {/* Progress Bar - shown during processing */}
      {isProcessing && uploadStatus && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400 flex items-center gap-2">
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              Processing in background...
            </span>
            <span className="font-medium text-gray-900 dark:text-white">
              {uploadStatus.processed_rows} / {uploadStatus.row_count} ({progressPercent}%)
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full bg-primary-600 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3">
        {!uploadStatus && (
          <>
            <Button
              variant="secondary"
              onClick={handleClose}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!file || !csvType || uploading}
            >
              {uploading ? 'Uploading...' : `Upload ${rowCount} Rows`}
            </Button>
          </>
        )}
        {uploadStatus && (
          <>
            {(isComplete || isFailed) && (
              <Button variant="secondary" onClick={handleReset}>
                Upload Another
              </Button>
            )}
            <Button onClick={handleClose}>
              {isProcessing ? 'Close (Processing continues)' : 'Close'}
            </Button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2"
      >
        <ArrowUpTrayIcon className="h-4 w-4" />
        Luma Import
      </Button>

      <Modal
        isOpen={showModal}
        onClose={handleClose}
        title="Import from Luma"
        size="lg"
        footer={footerContent}
      >
        <div className="space-y-6">
          {/* Info Banner */}
          <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
            <div className="flex gap-3">
              <InformationCircleIcon className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
              <div className="text-sm text-blue-800 dark:text-blue-200">
                <p className="font-medium mb-2">Upload Luma CSV files</p>
                <p className="mb-2">This tool auto-detects two types of Luma exports:</p>
                <ul className="list-disc ml-4 space-y-1">
                  <li>
                    <strong>Event Guests CSV</strong> - Contains registration data with QR codes.
                    Approved guests will be registered for the event automatically.
                  </li>
                  <li>
                    <strong>Calendar Members CSV</strong> - Contains member email mappings.
                    Enables real-time registration via email notifications.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* File Upload Area */}
          {!uploadStatus && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
                id="luma-csv-upload"
              />
              <label
                htmlFor="luma-csv-upload"
                className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:hover:border-gray-500"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <ArrowUpTrayIcon className="w-8 h-8 mb-2 text-gray-500 dark:text-gray-400" />
                  <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Luma Event Guests or Calendar Members CSV
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* File Info */}
          {file && !uploadStatus && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{file.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {csvType && (
                    <Badge variant={csvType === 'event_guests' ? 'success' : 'info'}>
                      {csvType === 'event_guests' ? 'Event Guests' : 'Calendar Members'}
                    </Badge>
                  )}
                  <Badge variant="default">{rowCount} rows</Badge>
                </div>
              </div>

              {csvType === 'event_guests' && !eventId && (
                <div className="mt-3 rounded bg-yellow-50 p-2 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
                  Note: No event is linked to this Luma event yet. Registrations will be stored
                  but not fully processed until the event is linked.
                </div>
              )}
            </div>
          )}

          {/* Upload Status */}
          {uploadStatus && (
            <div className="space-y-4">
              {/* Status Header */}
              <div className="flex items-center gap-3">
                {isProcessing && (
                  <>
                    <ArrowPathIcon className="h-6 w-6 text-blue-500 animate-spin" />
                    <span className="text-lg font-medium text-blue-600 dark:text-blue-400">
                      Processing...
                    </span>
                  </>
                )}
                {isComplete && (
                  <>
                    <CheckCircleIcon className="h-6 w-6 text-green-500" />
                    <span className="text-lg font-medium text-green-600 dark:text-green-400">
                      Complete
                    </span>
                  </>
                )}
                {isFailed && (
                  <>
                    <XCircleIcon className="h-6 w-6 text-red-500" />
                    <span className="text-lg font-medium text-red-600 dark:text-red-400">
                      Failed
                    </span>
                  </>
                )}
              </div>

              {/* Summary */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg bg-gray-50 p-4 text-center dark:bg-gray-800">
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {uploadStatus.row_count}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Total Rows</p>
                </div>
                <div className="rounded-lg bg-green-50 p-4 text-center dark:bg-green-900/20">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {uploadStatus.processed_rows}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Processed</p>
                </div>
                <div className="rounded-lg bg-blue-50 p-4 text-center dark:bg-blue-900/20">
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {uploadStatus.registrations_created}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Registrations</p>
                </div>
              </div>

              {/* Luma Event ID */}
              {uploadStatus.luma_event_id && (
                <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Luma Event ID</p>
                  <p className="font-mono text-gray-900 dark:text-white">{uploadStatus.luma_event_id}</p>
                </div>
              )}

              {/* Errors */}
              {uploadStatus.errors && uploadStatus.errors.length > 0 && (
                <div>
                  <p className="mb-2 font-medium text-red-600 dark:text-red-400">
                    Errors ({uploadStatus.error_count})
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                    <ul className="space-y-1 text-sm text-red-800 dark:text-red-200">
                      {uploadStatus.errors.slice(0, 50).map((error, index) => (
                        <li key={index}>
                          Row {error.row}: {error.error}
                        </li>
                      ))}
                      {uploadStatus.errors.length > 50 && (
                        <li className="italic">
                          ...and {uploadStatus.errors.length - 50} more errors
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
};
