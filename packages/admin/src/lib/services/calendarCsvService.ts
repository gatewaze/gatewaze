/**
 * Calendar CSV Service
 * Handles CSV parsing and background import for calendar members
 * Supports both standard format and Luma format detection
 * All imports are processed in the background via Edge Functions
 */

import { supabase } from '@/lib/supabase';
import { CalendarMembershipService } from './calendarMembershipService';
import { getBrandId } from '@/config/brands';

// ============================================================================
// Types
// ============================================================================

export type CsvFormat = 'standard' | 'luma';

export interface StandardCsvRow {
  email: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  membership_type?: string;
  phone?: string;
  company?: string;
}

export interface LumaCsvRow {
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  first_seen: string;
  user_api_id: string;
  tags?: string;
  revenue?: string;
  event_approved_count?: string;
  event_checked_in_count?: string;
  membership_name?: string;
  membership_status?: string;
}

export interface CsvParseResult {
  format: CsvFormat;
  headers: string[];
  rows: any[];
  rowCount: number;
}

// ============================================================================
// CSV Parsing Utilities
// ============================================================================

export class CalendarCsvService {
  /**
   * Helper to resolve calendar_id (CAL-XXX or UUID) to UUID
   */
  private static async resolveCalendarId(calendarId: string): Promise<string> {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(calendarId);
    if (isUUID) {
      return calendarId;
    }

    const { data: calendar, error } = await supabase
      .from('calendars')
      .select('id')
      .eq('calendar_id', calendarId)
      .single();

    if (error || !calendar) {
      throw new Error('Calendar not found');
    }
    return calendar.id;
  }

  /**
   * Detect CSV format based on column headers
   */
  static detectCsvFormat(headers: string[]): CsvFormat {
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

    // Luma Calendar Members CSV has 'user_api_id' and 'first_seen'
    if (
      normalizedHeaders.includes('user_api_id') &&
      normalizedHeaders.includes('first_seen')
    ) {
      return 'luma';
    }

    // Default to standard format
    return 'standard';
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
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  /**
   * Parse CSV text content
   */
  static parseCsvText(text: string): CsvParseResult {
    // Remove BOM if present
    const cleanText = text
      .replace(/^\uFEFF/, '')
      .replace(/^\xEF\xBB\xBF/, '');

    const lines = cleanText.split(/\r?\n/).filter(line => line.trim());

    if (lines.length === 0) {
      throw new Error('CSV file is empty');
    }

    // Parse header
    const headers = this.parseCsvLine(lines[0]).map(h =>
      h.trim()
        .replace(/^["']|["']$/g, '')
        .replace(/^\uFEFF/, '')
        .replace(/[\x00-\x1F]/g, '')
    );

    // Detect format
    const format = this.detectCsvFormat(headers);

    // Parse data rows
    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i]);

      const row: any = {};
      headers.forEach((col, index) => {
        row[col] = values[index]?.trim() || '';
      });

      // Skip empty rows
      if (Object.values(row).every(v => !v)) {
        continue;
      }

      rows.push(row);
    }

    return {
      format,
      headers,
      rows,
      rowCount: rows.length,
    };
  }

  /**
   * Parse CSV file
   */
  static async parseCsvFile(file: File): Promise<CsvParseResult> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const result = this.parseCsvText(text);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /**
   * Validate required fields for standard format
   */
  static validateStandardRow(row: StandardCsvRow, rowNum: number): string | null {
    if (!row.email || !row.email.includes('@')) {
      return `Row ${rowNum}: Invalid or missing email`;
    }
    return null;
  }

  /**
   * Validate required fields for Luma format
   */
  static validateLumaRow(row: LumaCsvRow, rowNum: number): string | null {
    if (!row.email || !row.email.includes('@')) {
      return `Row ${rowNum}: Invalid or missing email`;
    }
    if (!row.user_api_id) {
      return `Row ${rowNum}: Missing user_api_id`;
    }
    return null;
  }

  // ============================================================================
  // Preview and Validation
  // ============================================================================

  /**
   * Preview CSV import without actually importing
   */
  static async previewImport(
    file: File,
    calendarId: string
  ): Promise<{
    format: CsvFormat;
    rowCount: number;
    sampleRows: any[];
    existingCount: number;
    newCount: number;
    validationErrors: Array<{ row: number; error: string }>;
  }> {
    const parseResult = await this.parseCsvFile(file);
    const validationErrors: Array<{ row: number; error: string }> = [];
    let existingCount = 0;
    let newCount = 0;

    // Check first 100 rows for preview
    const sampleRows = parseResult.rows.slice(0, 100);

    for (let i = 0; i < sampleRows.length; i++) {
      const row = sampleRows[i];
      const rowNum = i + 2;

      // Validate
      const error =
        parseResult.format === 'luma'
          ? this.validateLumaRow(row as LumaCsvRow, rowNum)
          : this.validateStandardRow(row as StandardCsvRow, rowNum);

      if (error) {
        validationErrors.push({ row: rowNum, error });
        continue;
      }

      // Check if exists
      const email = row.email;
      if (email) {
        const existingResult = await CalendarMembershipService.isMember(calendarId, { email });
        if (existingResult.success && existingResult.data?.isMember) {
          existingCount++;
        } else {
          newCount++;
        }
      }
    }

    return {
      format: parseResult.format,
      rowCount: parseResult.rowCount,
      sampleRows: sampleRows.slice(0, 10), // Only return first 10 for UI preview
      existingCount,
      newCount,
      validationErrors,
    };
  }

  // ============================================================================
  // Template Generation
  // ============================================================================

  /**
   * Generate a CSV template for standard format
   */
  static generateStandardTemplate(): string {
    const headers = ['email', 'first_name', 'last_name', 'membership_type', 'phone', 'company'];
    const sampleRow = [
      'john@example.com',
      'John',
      'Doe',
      'member',
      '+1234567890',
      'Acme Inc',
    ];

    return [
      headers.join(','),
      sampleRow.join(','),
    ].join('\n');
  }

  /**
   * Generate member export as CSV string
   */
  static async exportMembersCsv(
    calendarId: string,
    options?: {
      membershipType?: 'subscriber' | 'member' | 'vip' | 'organizer' | 'admin';
      membershipStatus?: 'active' | 'pending' | 'inactive' | 'blocked';
    }
  ): Promise<string> {
    const result = await CalendarMembershipService.exportMembers(calendarId, options);

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to export members');
    }

    if (result.data.length === 0) {
      return 'No members to export';
    }

    // Get headers from first row
    const headers = Object.keys(result.data[0]);

    // Build CSV
    const lines: string[] = [headers.join(',')];

    for (const row of result.data) {
      const values = headers.map(h => {
        const value = row[h];
        if (value === null || value === undefined) return '';
        // Escape values with commas or quotes
        const strValue = String(value);
        if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
          return `"${strValue.replace(/"/g, '""')}"`;
        }
        return strValue;
      });
      lines.push(values.join(','));
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Background Processing Methods
  // ============================================================================

  /**
   * Upload CSV data for background processing
   * Returns immediately after storing the data - processing happens in Edge Function
   * @param adminProfileId - The admin_profiles.id (from useAuthContext().user.id - already the admin profile ID)
   */
  static async uploadForBackgroundProcessing(
    file: File,
    calendarId: string,
    adminProfileId: string
  ): Promise<{ uploadId: string; rowCount: number; format: CsvFormat }> {
    // Parse the CSV file
    const parseResult = await this.parseCsvFile(file);

    // Resolve calendar_id to UUID
    const calendarUuid = await this.resolveCalendarId(calendarId);

    // Insert the upload record
    // Note: user.id from useAuthContext() is already the admin_profiles.id
    const { data, error } = await supabase
      .from('luma_csv_uploads')
      .insert({
        brand_id: getBrandId(),
        file_name: file.name,
        csv_type: 'calendar_members_import',
        row_count: parseResult.rowCount,
        csv_data: parseResult.rows,
        csv_headers: parseResult.headers,
        calendar_id: calendarUuid,
        uploaded_by_admin_id: adminProfileId,
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to store CSV upload: ${error.message}`);
    }

    // Trigger background processing via Edge Function
    // Fire and forget - don't wait for processing to complete
    this.triggerBackgroundProcessing(data.id).catch(err => {
      console.error('Failed to trigger background processing:', err);
    });

    return {
      uploadId: data.id,
      rowCount: parseResult.rowCount,
      format: parseResult.format,
    };
  }

  /**
   * Trigger the Edge Function to process the upload
   * Handles chunked processing automatically by re-triggering until complete
   */
  static async triggerBackgroundProcessing(uploadId: string): Promise<void> {
    const processChunk = async (): Promise<void> => {
      try {
        const { data, error } = await supabase.functions.invoke('process-calendar-csv', {
          body: { uploadId },
        });

        if (error) {
          console.error('Edge function invocation error:', error);
          // Update the upload status to failed if we can't trigger processing
          await supabase
            .from('luma_csv_uploads')
            .update({
              status: 'failed',
              errors: [{ row: 0, error: `Failed to start processing: ${error.message}` }],
            })
            .eq('id', uploadId);

          throw error;
        }

        console.log('Chunk result:', data);

        // Check if there are more rows to process
        if (data && data.hasMoreRows) {
          console.log(`Chunk completed: ${data.processed} rows processed, continuing...`);
          // Small delay before triggering next chunk to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
          // Trigger the next chunk
          await processChunk();
        } else {
          console.log(`Import completed: ${data?.processed} rows processed`);
        }
      } catch (err) {
        console.error('Error in processChunk:', err);
        throw err;
      }
    };

    // Start processing in background (fire and forget from caller's perspective)
    processChunk().catch(err => {
      console.error('Background processing failed:', err);
    });
  }

  /**
   * Get the current status of a CSV upload
   */
  static async getUploadStatus(uploadId: string): Promise<CalendarCsvUpload | null> {
    const { data, error } = await supabase
      .from('luma_csv_uploads')
      .select('*')
      .eq('id', uploadId)
      .single();

    if (error || !data) {
      return null;
    }

    return data as CalendarCsvUpload;
  }

  /**
   * Subscribe to upload status changes
   */
  static subscribeToUploadStatus(
    uploadId: string,
    callback: (upload: CalendarCsvUpload) => void
  ): () => void {
    const channel = supabase
      .channel(`calendar-csv-upload-${uploadId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'luma_csv_uploads',
          filter: `id=eq.${uploadId}`,
        },
        (payload) => {
          callback(payload.new as CalendarCsvUpload);
        }
      )
      .subscribe();

    // Return unsubscribe function
    return () => {
      supabase.removeChannel(channel);
    };
  }

  /**
   * Get recent uploads for a calendar
   */
  static async getRecentUploads(calendarId: string, limit = 5): Promise<CalendarCsvUpload[]> {
    const calendarUuid = await this.resolveCalendarId(calendarId);

    const { data, error } = await supabase
      .from('luma_csv_uploads')
      .select('*')
      .eq('calendar_id', calendarUuid)
      .eq('csv_type', 'calendar_members_import')
      .order('uploaded_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch recent uploads:', error);
      return [];
    }

    return data as CalendarCsvUpload[];
  }
}

// ============================================================================
// Background Processing Types
// ============================================================================

export interface CalendarCsvUpload {
  id: string;
  brand_id: string;
  file_name: string;
  csv_type: 'calendar_members_import' | 'calendar_members' | 'event_guests';
  row_count: number;
  calendar_id?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  processed_rows: number;
  error_count: number;
  errors: Array<{ row: number; error: string }>;
  registrations_created: number;
  uploaded_at: string;
  processing_started_at?: string;
  processing_completed_at?: string;
}

export default CalendarCsvService;
