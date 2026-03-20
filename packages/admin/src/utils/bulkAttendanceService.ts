import { getApiConfig } from '@/config/brands';

export interface BulkAttendanceRow {
  email: string;
  attended_at?: string; // Timestamp - supports formats like '2025-09-15 4:55 PM CEST' or Unix timestamp
  check_in_method?: string; // qr_scan, manual_entry, badge_scan, mobile_app
  check_in_location?: string;
}

export interface BulkAttendanceResult {
  total: number;
  successful: number;
  failed: number;
  errors: Array<{ row: number; email: string; error: string }>;
}

export class BulkAttendanceService {
  /**
   * Parse CSV file and return rows
   */
  static parseCsvFile(file: File): Promise<BulkAttendanceRow[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const rows = this.parseCsvText(text);
          resolve(rows);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /**
   * Parse CSV text content
   * Supports flexible column order - reads headers from first row
   * Only email is required
   */
  static parseCsvText(text: string): BulkAttendanceRow[] {
    const lines = text.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      throw new Error('CSV file is empty');
    }

    // Parse header - normalize to lowercase and trim
    const header = this.parseCsvLine(lines[0]).map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));

    // Validate that email column exists (only required field)
    if (!header.includes('email')) {
      throw new Error('Missing required column: email');
    }

    // Define all supported columns
    const supportedColumns = ['email', 'attended_at', 'check_in_method', 'check_in_location'];

    // Warn about unrecognized columns
    const unrecognizedColumns = header.filter(col => col && !supportedColumns.includes(col));
    if (unrecognizedColumns.length > 0) {
      console.warn(`Unrecognized columns will be ignored: ${unrecognizedColumns.join(', ')}`);
    }

    // Parse data rows
    const rows: BulkAttendanceRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i]);

      // Allow rows with fewer columns than headers (missing trailing columns)
      if (values.length > header.length) {
        console.warn(`Row ${i + 1}: Too many columns, extra columns will be ignored`);
      }

      const row: any = {};
      header.forEach((col, index) => {
        const value = values[index]?.trim() || '';
        // Only include supported columns
        if (supportedColumns.includes(col)) {
          row[col] = value;
        }
      });

      // Skip completely empty rows
      if (Object.values(row).every(v => !v)) {
        continue;
      }

      rows.push(row as BulkAttendanceRow);
    }

    return rows;
  }

  /**
   * Parse a single CSV line, handling quoted fields
   */
  static parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  }

  /**
   * Validate a single row
   * Only email is required
   */
  static validateRow(row: BulkAttendanceRow, rowIndex: number): string | null {
    // Validate required field: email
    if (!row.email || !row.email.trim()) {
      return `Row ${rowIndex}: Email is required`;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(row.email)) {
      return `Row ${rowIndex}: Invalid email format`;
    }

    // Validate check_in_method if provided
    if (row.check_in_method && row.check_in_method.trim()) {
      const validMethods = ['qr_scan', 'manual_entry', 'badge_scan', 'mobile_app'];
      if (!validMethods.includes(row.check_in_method.trim())) {
        return `Row ${rowIndex}: Invalid check_in_method. Must be one of: ${validMethods.join(', ')}`;
      }
    }

    return null;
  }

  /**
   * Common timezone abbreviations mapping to UTC offsets
   */
  static timezoneOffsets: Record<string, string> = {
    // European
    'CET': '+01:00',
    'CEST': '+02:00',
    'WET': '+00:00',
    'WEST': '+01:00',
    'EET': '+02:00',
    'EEST': '+03:00',
    'GMT': '+00:00',
    'BST': '+01:00',
    // US
    'EST': '-05:00',
    'EDT': '-04:00',
    'CST': '-06:00',
    'CDT': '-05:00',
    'MST': '-07:00',
    'MDT': '-06:00',
    'PST': '-08:00',
    'PDT': '-07:00',
    // Others
    'UTC': '+00:00',
    'IST': '+05:30',
    'JST': '+09:00',
    'AEST': '+10:00',
    'AEDT': '+11:00',
  };

  /**
   * Parse a timestamp string into ISO format
   * Supports formats like:
   * - '2025-09-15 4:55 PM CEST'
   * - '2025-09-15 16:55 CEST'
   * - '2025-09-15T16:55:00+02:00'
   * - Unix timestamp (number or string)
   */
  static parseTimestamp(value: string | undefined): string | null {
    if (!value || !value.trim()) return null;

    const trimmed = value.trim();

    // Check if it's a Unix timestamp (all digits, optionally with leading minus)
    if (/^-?\d+$/.test(trimmed)) {
      const timestamp = parseInt(trimmed, 10);
      // If timestamp is less than 10 billion, assume it's in seconds, otherwise milliseconds
      const ms = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
      return new Date(ms).toISOString();
    }

    // Check if it's already an ISO format
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      const date = new Date(trimmed);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }

    // Try to parse format like '2025-09-15 4:55 PM CEST' or '2025-09-15 16:55 CEST'
    const dateTimeRegex = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*(\w+)?$/i;
    const match = trimmed.match(dateTimeRegex);

    if (match) {
      const [, datePart, hourStr, minuteStr, secondStr, ampm, tz] = match;
      let hour = parseInt(hourStr, 10);
      const minute = parseInt(minuteStr, 10);
      const second = secondStr ? parseInt(secondStr, 10) : 0;

      // Handle AM/PM
      if (ampm) {
        const isPM = ampm.toUpperCase() === 'PM';
        if (isPM && hour !== 12) {
          hour += 12;
        } else if (!isPM && hour === 12) {
          hour = 0;
        }
      }

      // Get timezone offset
      let tzOffset = '+00:00';
      if (tz && this.timezoneOffsets[tz.toUpperCase()]) {
        tzOffset = this.timezoneOffsets[tz.toUpperCase()];
      }

      // Construct ISO string
      const isoString = `${datePart}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}${tzOffset}`;
      const date = new Date(isoString);

      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }

    // Fallback: try native Date parsing
    const fallbackDate = new Date(trimmed);
    if (!isNaN(fallbackDate.getTime())) {
      return fallbackDate.toISOString();
    }

    console.warn(`Could not parse timestamp value: ${trimmed}`);
    return null;
  }

  /**
   * Process bulk attendance from CSV using the API endpoint
   */
  static async processBulkAttendance(
    rows: BulkAttendanceRow[],
    eventId: string,
    onProgress?: (current: number, total: number) => void,
    updateExisting: boolean = false
  ): Promise<BulkAttendanceResult> {
    try {
      const apiConfig = getApiConfig();
      const apiBaseUrl = apiConfig.baseUrl;
      if (!apiBaseUrl) {
        throw new Error('API base URL not configured');
      }

      // Transform rows to match API format
      const attendanceRecords = rows.map(row => {
        const record: any = {
          email: row.email,
        };

        // Parse and add attended_at timestamp if provided
        if (row.attended_at) {
          const parsedTimestamp = this.parseTimestamp(row.attended_at);
          if (parsedTimestamp) {
            record.attended_at = parsedTimestamp;
          }
        }

        if (row.check_in_method) record.check_in_method = row.check_in_method;
        if (row.check_in_location) record.check_in_location = row.check_in_location;

        return record;
      });

      // Start progress simulation
      const ESTIMATED_MS_PER_RECORD = 300;
      const totalEstimatedMs = rows.length * ESTIMATED_MS_PER_RECORD;
      let progressInterval: ReturnType<typeof setInterval> | null = null;
      let simulatedProgress = 0;

      if (onProgress) {
        onProgress(0, rows.length);

        const progressIncrementMs = 200;
        const progressPerIncrement = (rows.length * progressIncrementMs) / totalEstimatedMs;

        progressInterval = setInterval(() => {
          simulatedProgress = Math.min(simulatedProgress + progressPerIncrement, rows.length * 0.95);
          onProgress(Math.floor(simulatedProgress), rows.length);
        }, progressIncrementMs);
      }

      // Call the bulk attendance API endpoint
      const response = await fetch(`${apiBaseUrl}/api/attendance/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_id: eventId,
          update_existing: updateExisting,
          attendance_records: attendanceRecords,
        }),
      });

      // Clear the progress simulation
      if (progressInterval) {
        clearInterval(progressInterval);
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process bulk attendance');
      }

      const apiResult = await response.json();

      // Report final progress
      if (onProgress) {
        onProgress(apiResult.total, apiResult.total);
      }

      // Transform API result to match our interface
      return {
        total: apiResult.total,
        successful: apiResult.successful,
        failed: apiResult.failed + (apiResult.skipped || 0),
        errors: [
          ...(apiResult.errors || []).map((err: any) => ({
            row: err.index + 2,
            email: err.email,
            error: err.error,
          })),
          ...(apiResult.skipped || []).map((skip: any) => ({
            row: skip.index + 2,
            email: skip.email,
            error: `Skipped: ${skip.reason}`,
          })),
        ],
      };
    } catch (error: any) {
      console.error('Error processing bulk attendance:', error);
      return {
        total: rows.length,
        successful: 0,
        failed: rows.length,
        errors: [{
          row: 0,
          email: 'N/A',
          error: error.message || 'Failed to process bulk attendance',
        }],
      };
    }
  }
}
