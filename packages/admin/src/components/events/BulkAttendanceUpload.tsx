import { useState, useRef } from 'react';
import { ArrowUpTrayIcon, DocumentArrowDownIcon } from '@heroicons/react/24/outline';
import { Button, Modal } from '@/components/ui';
import { BulkAttendanceService, BulkAttendanceRow, BulkAttendanceResult } from '@/utils/bulkAttendanceService';
import { toast } from 'sonner';

interface BulkAttendanceUploadProps {
  eventId: string;
  onComplete?: () => void;
}

export const BulkAttendanceUpload = ({ eventId, onComplete }: BulkAttendanceUploadProps) => {
  const [showModal, setShowModal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<BulkAttendanceRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<BulkAttendanceResult | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }

    setFile(selectedFile);
    setRows([]);
    setResult(null);

    try {
      const parsedRows = await BulkAttendanceService.parseCsvFile(selectedFile);
      setRows(parsedRows);
      toast.success(`Parsed ${parsedRows.length} rows from CSV`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to parse CSV file');
      setFile(null);
    }
  };

  const handleUpload = async () => {
    if (!file || rows.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: rows.length });

    try {
      const uploadResult = await BulkAttendanceService.processBulkAttendance(
        rows,
        eventId,
        (current, total) => {
          setProgress({ current, total });
        },
        updateExisting
      );

      setResult(uploadResult);

      if (uploadResult.successful > 0) {
        toast.success(`Successfully recorded ${uploadResult.successful} attendance records`);
        if (onComplete) {
          onComplete();
        }
      }

      if (uploadResult.failed > 0) {
        toast.error(`Failed to record ${uploadResult.failed} attendance records. Check details below.`);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to process attendance records');
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setRows([]);
    setResult(null);
    setProgress({ current: 0, total: 0 });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setShowModal(false);
      handleReset();
    }
  };

  const downloadTemplate = () => {
    const csv = 'email,attended_at,check_in_method,check_in_location\njohn.doe@example.com,2025-09-15 4:55 PM CEST,manual_entry,Main Entrance\njane.smith@example.com,1726412100,qr_scan,';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk_attendance_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  // Footer content with progress bar and buttons
  const footerContent = (
    <div className="px-6 py-4">
      {/* Progress Bar - shown during upload */}
      {uploading && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              Processing attendance records...
            </span>
            <span className="font-medium text-gray-900 dark:text-white">
              {progress.current} / {progress.total} ({progressPercent}%)
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
        {!result && (
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
              disabled={!file || rows.length === 0 || uploading}
            >
              {uploading ? 'Processing...' : `Upload ${rows.length} Attendance Records`}
            </Button>
          </>
        )}
        {result && (
          <>
            <Button
              variant="secondary"
              onClick={handleReset}
            >
              Upload Another File
            </Button>
            <Button
              onClick={handleClose}
            >
              Close
            </Button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2"
      >
        <ArrowUpTrayIcon className="w-4 h-4" />
        Upload Attendance CSV
      </Button>

      <Modal
        isOpen={showModal}
        onClose={handleClose}
        title="Bulk Attendance Upload"
        size="lg"
        footer={footerContent}
      >
        <div className="space-y-6">
          {/* Instructions */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">CSV Format</h4>
            <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
              <strong>Only email is required.</strong> Users must already be registered for the event. All other fields are optional.
            </p>
            <div className="mb-3">
              <p className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-1">Supported Fields:</p>
              <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
                <li><strong>email</strong> - Required, must match a registered attendee</li>
                <li><strong>attended_at</strong> - Check-in timestamp (optional, defaults to now)</li>
                <li><strong>check_in_method</strong> - qr_scan, manual_entry, badge_scan, mobile_app (optional)</li>
                <li><strong>check_in_location</strong> - Location name (optional)</li>
              </ul>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 mb-2">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                <strong>Timestamp Formats:</strong> attended_at accepts: <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">2025-09-15 4:55 PM CEST</code>, <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">2025-09-15 16:55 CEST</code>, ISO format, or Unix timestamp.
              </p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded px-3 py-2 mb-2">
              <p className="text-xs text-green-800 dark:text-green-200">
                <strong>Note:</strong> This will create attendance records for users who are already registered. Users not registered for this event will be skipped.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={downloadTemplate}
              className="mt-3 flex items-center gap-2 text-blue-700 dark:text-blue-300"
            >
              <DocumentArrowDownIcon className="w-4 h-4" />
              Download Template
            </Button>
          </div>

          {/* File Upload */}
          {!result && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Select CSV File
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                disabled={uploading}
                className="block w-full text-sm text-gray-500 dark:text-gray-400
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100
                  dark:file:bg-blue-900/50 dark:file:text-blue-300
                  dark:hover:file:bg-blue-900/70
                  disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {file && (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  Selected: {file.name} ({rows.length} rows)
                </p>
              )}
            </div>
          )}

          {/* Update Mode Checkbox */}
          {rows.length > 0 && !result && (
            <div className="flex items-start">
              <div className="flex items-center h-5">
                <input
                  id="update-existing-attendance"
                  type="checkbox"
                  checked={updateExisting}
                  onChange={(e) => setUpdateExisting(e.target.checked)}
                  disabled={uploading}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              <div className="ml-3 text-sm">
                <label htmlFor="update-existing-attendance" className="font-medium text-gray-700 dark:text-gray-300">
                  Update existing attendance records
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  If checked, will update check-in time for users already checked in. If unchecked, will skip already checked-in users.
                </p>
              </div>
            </div>
          )}

          {/* Preview */}
          {rows.length > 0 && !result && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Preview (First 5 rows)
              </h4>
              <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Email</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Attended At</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Check-in Method</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Location</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                    {rows.slice(0, 5).map((row, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 text-xs text-gray-900 dark:text-white">{row.email}</td>
                        <td className="px-3 py-2 text-xs text-gray-900 dark:text-white">{row.attended_at || '(now)'}</td>
                        <td className="px-3 py-2 text-xs text-gray-900 dark:text-white">{row.check_in_method || 'manual_entry'}</td>
                        <td className="px-3 py-2 text-xs text-gray-900 dark:text-white">{row.check_in_location || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 5 && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  ... and {rows.length - 5} more rows
                </p>
              )}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{result.total}</div>
                  <div className="text-sm text-gray-500">Total</div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">{result.successful}</div>
                  <div className="text-sm text-gray-500">Successful</div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">{result.failed}</div>
                  <div className="text-sm text-gray-500">Failed/Skipped</div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Errors ({result.errors.length})
                  </h4>
                  <div className="max-h-60 overflow-y-auto border border-red-200 dark:border-red-800 rounded-lg">
                    <table className="min-w-full divide-y divide-red-200 dark:divide-red-800">
                      <thead className="bg-red-50 dark:bg-red-900/20 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-red-900 dark:text-red-100">Row</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-red-900 dark:text-red-100">Email</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-red-900 dark:text-red-100">Error</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-900 divide-y divide-red-200 dark:divide-red-800">
                        {result.errors.map((error, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-2 text-xs text-gray-900 dark:text-white">{error.row}</td>
                            <td className="px-3 py-2 text-xs text-gray-900 dark:text-white">{error.email}</td>
                            <td className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
