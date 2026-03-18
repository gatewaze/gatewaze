// @ts-nocheck
import { supabase } from '@/lib/supabase';
import { getApiConfig } from '@/config/brands';

export interface BulkRegistrationRow {
  email: string;
  first_name?: string;
  last_name?: string;
  name?: string; // Alternative to first_name/last_name - will be split
  job_title?: string;
  company?: string;
  linkedin_url?: string;
  registration_type?: string;
  ticket_type?: string;
  cio_id?: string;
  phone?: string;
  sponsor_permission?: string | boolean; // Can be string from CSV
  external_qr_code?: string;
  source?: string;
  registered_at?: string; // Timestamp from external system - supports formats like '2025-09-15 4:55 PM CEST' or Unix timestamp
}

export interface BulkRegistrationResult {
  total: number;
  successful: number;
  failed: number;
  errors: Array<{ row: number; email: string; error: string }>;
}

export class BulkRegistrationService {
  /**
   * Parse CSV file and return rows
   */
  static parseCsvFile(file: File): Promise<BulkRegistrationRow[]> {
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
   * Now supports flexible column order - reads headers from first row
   * Only email is required
   */
  static parseCsvText(text: string): BulkRegistrationRow[] {
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
    const supportedColumns = [
      'email', 'first_name', 'last_name', 'name', 'job_title', 'company',
      'linkedin_url', 'registration_type', 'ticket_type', 'cio_id',
      'phone', 'sponsor_permission', 'external_qr_code', 'source', 'registered_at'
    ];

    // Warn about unrecognized columns
    const unrecognizedColumns = header.filter(col => col && !supportedColumns.includes(col));
    if (unrecognizedColumns.length > 0) {
      console.warn(`Unrecognized columns will be ignored: ${unrecognizedColumns.join(', ')}`);
    }

    // Parse data rows
    const rows: BulkRegistrationRow[] = [];
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

      rows.push(row as BulkRegistrationRow);
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
   * Now only email is required - all other fields are optional
   */
  static validateRow(row: BulkRegistrationRow, rowIndex: number): string | null {
    // Validate required field: email
    if (!row.email || !row.email.trim()) {
      return `Row ${rowIndex}: Email is required`;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(row.email)) {
      return `Row ${rowIndex}: Invalid email format`;
    }

    // Validate LinkedIn URL if provided
    if (row.linkedin_url && row.linkedin_url.trim()) {
      if (!row.linkedin_url.includes('linkedin.com')) {
        return `Row ${rowIndex}: LinkedIn URL must contain 'linkedin.com'`;
      }
    }

    return null;
  }

  /**
   * Split a full name into first and last name
   * Handles various formats:
   * - "John Doe" -> {first: "John", last: "Doe"}
   * - "John" -> {first: "John", last: ""}
   * - "John Michael Doe" -> {first: "John Michael", last: "Doe"}
   */
  static splitName(fullName: string): { first_name: string; last_name: string } {
    const trimmed = fullName.trim();
    if (!trimmed) {
      return { first_name: '', last_name: '' };
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return { first_name: parts[0], last_name: '' };
    }

    // Last part is last name, everything else is first name
    const lastName = parts[parts.length - 1];
    const firstName = parts.slice(0, -1).join(' ');
    return { first_name: firstName, last_name: lastName };
  }

  /**
   * Normalize boolean values from CSV
   */
  static normalizeBoolean(value: string | boolean | undefined): boolean {
    if (typeof value === 'boolean') return value;
    if (!value) return false;
    const str = String(value).toLowerCase().trim();
    return ['true', '1', 'yes', 'y'].includes(str);
  }

  /**
   * Common timezone abbreviations mapping to UTC offsets
   */
  static timezoneOffsets: Record<string, string> = {
    // European
    'CET': '+01:00',    // Central European Time
    'CEST': '+02:00',   // Central European Summer Time
    'WET': '+00:00',    // Western European Time
    'WEST': '+01:00',   // Western European Summer Time
    'EET': '+02:00',    // Eastern European Time
    'EEST': '+03:00',   // Eastern European Summer Time
    'GMT': '+00:00',    // Greenwich Mean Time
    'BST': '+01:00',    // British Summer Time
    // US
    'EST': '-05:00',    // Eastern Standard Time
    'EDT': '-04:00',    // Eastern Daylight Time
    'CST': '-06:00',    // Central Standard Time
    'CDT': '-05:00',    // Central Daylight Time
    'MST': '-07:00',    // Mountain Standard Time
    'MDT': '-06:00',    // Mountain Daylight Time
    'PST': '-08:00',    // Pacific Standard Time
    'PDT': '-07:00',    // Pacific Daylight Time
    // Others
    'UTC': '+00:00',
    'IST': '+05:30',    // Indian Standard Time
    'JST': '+09:00',    // Japan Standard Time
    'AEST': '+10:00',   // Australian Eastern Standard Time
    'AEDT': '+11:00',   // Australian Eastern Daylight Time
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
    // Pattern: YYYY-MM-DD HH:MM[:SS] [AM/PM] [TZ]
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
   * Create customer via user-signup edge function
   * This creates the auth user, customer record in Supabase, and syncs to CIO server-side
   * Returns the customer record directly (no polling needed)
   */
  static async createCustomerViaSignup(email: string, metadata?: Record<string, any>): Promise<any | null> {
    try {
      const { data, error } = await supabase.functions.invoke('user-signup', {
        body: {
          email,
          source: 'admin_bulk_registration',
          user_metadata: metadata || {},
        },
      });

      if (error) {
        console.error('Failed to create customer via user-signup:', error);
        return null;
      }

      if (!data?.success) {
        console.error('Failed to create customer via user-signup:', data?.error);
        return null;
      }

      // Fetch the full customer record from Supabase
      const { data: customer } = await supabase
        .from('customers')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      return customer;
    } catch (error) {
      console.error('Error creating customer:', error);
      return null;
    }
  }

  /**
   * @deprecated Use createCustomerViaSignup instead
   */
  static async createCustomerInCIO(email: string): Promise<string | null> {
    const customer = await this.createCustomerViaSignup(email);
    return customer ? email : null;
  }

  /**
   * @deprecated No longer needed — createCustomerViaSignup creates the customer directly
   */
  static async pollForCustomer(email: string, maxAttempts: number = 30): Promise<any | null> {
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    return customer;
  }

  /**
   * Update customer attributes in Customer.io via edge function
   */
  static async updateCustomerInCIO(
    cioId: string,
    attributes: {
      first_name: string;
      last_name: string;
      company: string;
      job_title: string;
      linkedin_url?: string;
    }
  ): Promise<boolean> {
    try {
      // Look up the customer's email from cio_id
      const { data: customer } = await supabase
        .from('customers')
        .select('email')
        .eq('cio_id', cioId)
        .maybeSingle();

      if (!customer?.email) {
        console.error('Could not find customer email for cio_id:', cioId);
        return false;
      }

      const { data, error } = await supabase.functions.invoke('sync-customer-to-cio', {
        body: {
          email: customer.email,
          attributes,
        },
      });

      if (error) {
        console.error('Error updating customer in CIO:', error);
        return false;
      }

      return data?.success ?? false;
    } catch (error) {
      console.error('Error updating customer in CIO:', error);
      return false;
    }
  }

  /**
   * Update customer attributes in Supabase
   */
  static async updateCustomerAttributes(
    customerId: number,
    attributes: {
      first_name: string;
      last_name: string;
      company: string;
      job_title: string;
      linkedin_url?: string;
    }
  ): Promise<boolean> {
    try {
      const payload: any = {
        p_customer_id: customerId,
        p_first_name: attributes.first_name,
        p_last_name: attributes.last_name,
        p_company: attributes.company,
        p_job_title: attributes.job_title,
      };

      if (attributes.linkedin_url) {
        payload.p_linkedin_url = attributes.linkedin_url;
      }

      const { error } = await supabase.rpc('update_customer_attributes', payload);

      if (error) {
        console.error('Error updating customer attributes:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error updating customer attributes:', error);
      return false;
    }
  }

  /**
   * Get or create member profile for customer
   */
  static async getOrCreateMemberProfile(customerId: number): Promise<any | null> {
    try {
      // Use the RPC function that properly handles QR code generation
      const { data: memberProfileId, error: rpcError } = await supabase
        .rpc('get_or_create_member_from_customer', {
          p_customer_id: customerId,
        });

      if (rpcError) {
        console.error('Error calling get_or_create_member_from_customer:', rpcError);
        return null;
      }

      // Get the full member profile data
      const { data: member, error: selectError } = await supabase
        .from('member_profiles')
        .select('*')
        .eq('id', memberProfileId)
        .single();

      if (selectError) {
        console.error('Error fetching member profile:', selectError);
        return null;
      }

      return member;
    } catch (error) {
      console.error('Error getting/creating member profile:', error);
      return null;
    }
  }

  /**
   * Register user for event (without check-in)
   */
  static async registerForEvent(
    eventId: string,
    memberProfileId: string
  ): Promise<boolean> {
    try {
      // Check if already registered
      const { data: existing } = await supabase
        .from('event_registrations')
        .select('id')
        .eq('event_id', eventId)
        .eq('member_profile_id', memberProfileId)
        .maybeSingle();

      if (existing) {
        console.log('User already registered for event');
        return true; // Already registered is considered success
      }

      // Create registration
      const { error } = await supabase
        .from('event_registrations')
        .insert({
          event_id: eventId,
          member_profile_id: memberProfileId,
          registration_type: 'individual',
          registration_source: 'csv_upload',
          payment_status: 'comp',
          status: 'confirmed',
        });

      if (error) {
        console.error('Error creating registration:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error registering for event:', error);
      return false;
    }
  }

  /**
   * Process a single registration row
   */
  static async processSingleRegistration(
    row: BulkRegistrationRow,
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if customer already exists
      let { data: customer } = await supabase
        .from('customers')
        .select('*')
        .eq('email', row.email)
        .maybeSingle();

      // If customer doesn't exist, create in Customer.io and wait for webhook
      if (!customer) {
        console.log(`Creating new customer: ${row.email}`);

        const cioId = await this.createCustomerInCIO(row.email);
        if (!cioId) {
          return { success: false, error: 'Failed to create customer in Customer.io' };
        }

        // Poll for customer to appear in Supabase
        customer = await this.pollForCustomer(row.email);
        if (!customer) {
          return { success: false, error: 'Customer creation timed out' };
        }
      }

      // Update customer attributes in both CIO and Supabase
      const attributes = {
        first_name: row.first_name,
        last_name: row.last_name,
        company: row.company,
        job_title: row.job_title,
        linkedin_url: row.linkedin_url,
      };

      await Promise.all([
        this.updateCustomerInCIO(customer.cio_id, attributes),
        this.updateCustomerAttributes(customer.id, attributes),
      ]);

      // Get or create member profile
      const member = await this.getOrCreateMemberProfile(customer.id);
      if (!member) {
        return { success: false, error: 'Failed to create member profile' };
      }

      // Register for event
      const registered = await this.registerForEvent(eventId, member.id);
      if (!registered) {
        return { success: false, error: 'Failed to register for event' };
      }

      return { success: true };
    } catch (error: any) {
      console.error('Error processing registration:', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Process bulk registrations from CSV using the API endpoint
   */
  static async processBulkRegistrations(
    rows: BulkRegistrationRow[],
    eventId: string,
    onProgress?: (current: number, total: number) => void,
    updateExisting: boolean = false
  ): Promise<BulkRegistrationResult> {
    try {
      const apiConfig = getApiConfig();
      // The baseUrl already doesn't have /api suffix, so we can use it directly
      const apiBaseUrl = apiConfig.baseUrl;
      if (!apiBaseUrl) {
        throw new Error('API base URL not configured');
      }

      // Transform rows to match API format
      const registrations = rows.map((row, rowIndex) => {
        // Handle name splitting if 'name' field is provided instead of first_name/last_name
        let firstName = row.first_name;
        let lastName = row.last_name;

        if (row.name && (!firstName || !lastName)) {
          const splitName = this.splitName(row.name);
          firstName = firstName || splitName.first_name;
          lastName = lastName || splitName.last_name;
        }

        // Build registration object with only provided fields
        const registration: any = {
          email: row.email,
        };

        // Add optional fields only if they have values
        if (firstName) registration.first_name = firstName;
        if (lastName) registration.last_name = lastName;
        if (row.job_title) registration.job_title = row.job_title;
        if (row.company) registration.company = row.company;
        if (row.linkedin_url) registration.linkedin_url = row.linkedin_url;
        if (row.registration_type) registration.registration_type = row.registration_type;
        if (row.ticket_type) registration.ticket_type = row.ticket_type;
        if (row.cio_id) registration.cio_id = row.cio_id;
        if (row.phone) registration.phone = row.phone;

        // Add new metadata fields
        if (row.sponsor_permission !== undefined && row.sponsor_permission !== '') {
          registration.sponsor_permission = this.normalizeBoolean(row.sponsor_permission);
        }
        if (row.external_qr_code) registration.external_qr_code = row.external_qr_code;

        // Source field: blank values should clear existing data (set to null)
        // - If field has a value, include it
        // - If field is empty string (blank in CSV), include null to clear it
        // - If field is undefined (column not in CSV), don't include it
        if (row.source !== undefined) {
          registration.source = row.source || null;
        }

        // Parse and add registered_at timestamp if provided
        if (row.registered_at) {
          const parsedTimestamp = this.parseTimestamp(row.registered_at);
          if (parsedTimestamp) {
            registration.registered_at = parsedTimestamp;
          }
        }

        // DEBUG: Log new fields for first row
        if (rowIndex === 0) {
          console.log('🔍 DEBUG Frontend: First row CSV values:', {
            sponsor_permission_raw: row.sponsor_permission,
            external_qr_code_raw: row.external_qr_code,
            source_raw: row.source,
            registered_at_raw: row.registered_at,
          });
          console.log('🔍 DEBUG Frontend: First registration object being sent:', {
            sponsor_permission: registration.sponsor_permission,
            external_qr_code: registration.external_qr_code,
            source: registration.source,
            registered_at: registration.registered_at,
          });
        }

        return registration;
      });

      // Start progress simulation - the API processes in batches of 50
      // Estimate ~500ms per registration on average
      const BATCH_SIZE = 50;
      const ESTIMATED_MS_PER_REGISTRATION = 500;
      const totalEstimatedMs = rows.length * ESTIMATED_MS_PER_REGISTRATION;
      let progressInterval: ReturnType<typeof setInterval> | null = null;
      let simulatedProgress = 0;

      if (onProgress) {
        // Report initial progress
        onProgress(0, rows.length);

        // Simulate progress based on estimated time
        const progressIncrementMs = 200; // Update every 200ms
        const progressPerIncrement = (rows.length * progressIncrementMs) / totalEstimatedMs;

        progressInterval = setInterval(() => {
          simulatedProgress = Math.min(simulatedProgress + progressPerIncrement, rows.length * 0.95); // Cap at 95%
          onProgress(Math.floor(simulatedProgress), rows.length);
        }, progressIncrementMs);
      }

      // Call the bulk registration API endpoint
      const response = await fetch(`${apiBaseUrl}/api/registrations/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_id: eventId,
          update_existing: updateExisting,
          registrations,
        }),
      });

      // Clear the progress simulation
      if (progressInterval) {
        clearInterval(progressInterval);
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process bulk registration');
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
            row: err.index + 2, // +2 for header and 0-indexing
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
      console.error('Error processing bulk registrations:', error);
      return {
        total: rows.length,
        successful: 0,
        failed: rows.length,
        errors: [{
          row: 0,
          email: 'N/A',
          error: error.message || 'Failed to process bulk registration',
        }],
      };
    }
  }
}
