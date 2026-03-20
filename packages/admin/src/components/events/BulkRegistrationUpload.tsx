import { useState, useRef } from 'react';
import { ArrowUpTrayIcon, DocumentArrowDownIcon } from '@heroicons/react/24/outline';
import { Button, Modal } from '@/components/ui';
import { BulkRegistrationService, BulkRegistrationRow, BulkRegistrationResult } from '@/utils/bulkRegistrationService';
import { toast } from 'sonner';

interface BulkRegistrationUploadProps {
  eventId: string;
  onComplete?: () => void;
}

export const BulkRegistrationUpload = ({ eventId, onComplete }: BulkRegistrationUploadProps) => {
  const [showModal, setShowModal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<BulkRegistrationRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<BulkRegistrationResult | null>(null);
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
      const parsedRows = await BulkRegistrationService.parseCsvFile(selectedFile);
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
      const uploadResult = await BulkRegistrationService.processBulkRegistrations(
        rows,
        eventId,
        (current, total) => {
          setProgress({ current, total });
        },
        updateExisting
      );

      setResult(uploadResult);

      if (uploadResult.successful > 0) {
        toast.success(`Successfully registered ${uploadResult.successful} users`);
        if (onComplete) {
          onComplete();
        }
      }

      if (uploadResult.failed > 0) {
        toast.error(`Failed to register ${uploadResult.failed} users. Check details below.`);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to process registrations');
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
    const csv = 'email,name,first_name,last_name,job_title,company,phone,linkedin_url,registration_type,ticket_type,sponsor_permission,external_qr_code,source,registered_at,cio_id\njohn.doe@example.com,John Doe,,,Software Engineer,Acme Inc,+1-555-0100,https://linkedin.com/in/johndoe,individual,Standard,true,EXT-QR-001,website,2025-09-15 4:55 PM CEST,\njane.smith@example.com,,Jane,Smith,Product Manager,Tech Corp,+1-555-0200,https://linkedin.com/in/janesmith,sponsor,VIP,yes,EXT-QR-002,referral,1726412100,';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk_registration_template.csv';
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
              Processing registrations...
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
              {uploading ? 'Processing...' : `Upload ${rows.length} Registrations`}
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
        Upload CSV
      </Button>

      <Modal
        isOpen={showModal}
        onClose={handleClose}
        title="Bulk Registration Upload"
        size="lg"
        footer={footerContent}
      >
        <div className="space-y-6">
          {/* Instructions */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">CSV Format</h4>
            <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
              <strong>Only email is required.</strong> All other fields are optional. Columns can be in any order.
            </p>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <p className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-1">Basic Fields:</p>
                <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
                  <li><strong>email</strong> - Required</li>
                  <li><strong>name</strong> - Full name (will be split)</li>
                  <li><strong>first_name</strong> - First name</li>
                  <li><strong>last_name</strong> - Last name</li>
                  <li><strong>job_title</strong> - Job title</li>
                  <li><strong>company</strong> - Company name</li>
                  <li><strong>phone</strong> - Phone number</li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-1">Additional Fields:</p>
                <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
                  <li><strong>linkedin_url</strong> - LinkedIn URL</li>
                  <li><strong>registration_type</strong> - Type/role</li>
                  <li><strong>ticket_type</strong> - Ticket tier</li>
                  <li><strong>sponsor_permission</strong> - true/false</li>
                  <li><strong>external_qr_code</strong> - External QR</li>
                  <li><strong>source</strong> - Marketing source</li>
                  <li><strong>registered_at</strong> - Registration timestamp</li>
                  <li><strong>cio_id</strong> - Customer.io ID</li>
                </ul>
              </div>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded px-3 py-2 mb-2">
              <p className="text-xs text-green-800 dark:text-green-200">
                <strong>Smart Upload:</strong> Partial updates supported - only provided fields will be updated. Existing data won't be overwritten if not included.
              </p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 mb-2">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                <strong>Timestamp Formats:</strong> registered_at accepts: <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">2025-09-15 4:55 PM CEST</code>, <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">2025-09-15 16:55 CEST</code>, ISO format, or Unix timestamp.
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
                  id="update-existing"
                  type="checkbox"
                  checked={updateExisting}
                  onChange={(e) => setUpdateExisting(e.target.checked)}
                  disabled={uploading}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              <div className="ml-3 text-sm">
                <label htmlFor="update-existing" className="font-medium text-gray-700 dark:text-gray-300">
                  Update existing registrations
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  If checked, will update fields for users already registered. If unchecked, will skip already registered users.
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
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Name</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Job Title</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Company</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                    {rows.slice(0, 5).map((row, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 text-xs text-gray-900 dark:text-white">{row.email}</td>
                        <td className="px-3 py-2 text-xs text-gray-900 dark:text-white">
                          {row.first_name} {row.last_name}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-900 dark:text-white">{row.job_title}</td>
                        <td className="px-3 py-2 text-xs text-gray-900 dark:text-white">{row.company}</td>
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
