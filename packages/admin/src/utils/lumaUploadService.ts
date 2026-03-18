// @ts-nocheck
import { supabase } from '@/lib/supabase';

// ============================================================================
// Types for Luma CSV Processing
// ============================================================================

export type LumaCsvType = 'event_guests' | 'calendar_members' | 'calendar_members_import';

export interface LumaEventGuestRow {
  api_id: string;           // gst-XXXXX
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number?: string;
  created_at: string;       // ISO timestamp
  approval_status: string;  // 'approved', 'pending', etc.
  checked_in_at?: string;
  custom_source?: string;
  qr_code_url: string;      // Contains evt-XXXXX
  amount?: string;
  amount_tax?: string;
  amount_discount?: string;
  currency?: string;
  coupon_code?: string;
  eth_address?: string;
  solana_address?: string;
  survey_response_rating?: string;
  survey_response_feedback?: string;
  ticket_type_id?: string;  // evtticktyp-XXXXX
  ticket_name?: string;
}

export interface LumaCalendarMemberRow {
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  first_seen: string;       // ISO timestamp
  user_api_id: string;      // usr-XXXXX
  tags?: string;
  revenue?: string;
  event_approved_count?: string;
  event_checked_in_count?: string;
  membership_name?: string;
  membership_status?: string;
}

export interface LumaUploadResult {
  type: LumaCsvType;
  total: number;
  processed: number;
  skipped: number;
  errors: Array<{ row: number; error: string }>;
  lumaEventId?: string;       // For event guests CSV
  registrationsCreated: number; // Number of full registrations created
}

export interface LumaCsvUpload {
  id: string;
  brand_id: string;
  file_name: string;
  csv_type: LumaCsvType;
  row_count: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  processed_rows: number;
  error_count: number;
  errors: Array<{ row: number; error: string }>;
  registrations_created: number;
  luma_event_id?: string;
  uploaded_at: string;
  processing_started_at?: string;
  processing_completed_at?: string;
}

// ============================================================================
// Additional Types for Registration
// ============================================================================

/**
 * Additional data from Luma CSV for registration
 */
export interface LumaRegistrationData {
  ticketType?: string | null;
  ticketAmount?: number | null; // Amount in dollars (e.g., 300.00)
  currency?: string | null;
  couponCode?: string | null;
  surveyResponses?: Record<string, any>; // Survey questions and answers
}

/**
 * Known Luma CSV columns that are NOT survey questions
 */
const KNOWN_LUMA_COLUMNS = new Set([
  'api_id', 'name', 'first_name', 'last_name', 'email', 'phone_number',
  'created_at', 'approval_status', 'checked_in_at', 'custom_source',
  'qr_code_url', 'amount', 'amount_tax', 'amount_discount', 'currency',
  'coupon_code', 'eth_address', 'solana_address', 'survey_response_rating',
  'survey_response_feedback', 'ticket_type_id', 'ticket_name'
]);

/**
 * Extract survey responses from a CSV row
 * Any column not in the known Luma columns is considered a survey question
 */
function extractSurveyResponses(row: Record<string, any>): Record<string, any> {
  const surveyResponses: Record<string, any> = {};

  for (const [key, value] of Object.entries(row)) {
    // Skip known Luma columns
    if (KNOWN_LUMA_COLUMNS.has(key)) continue;

    // Skip empty values
    if (!value || value === '' || value === 'No answer provided.') continue;

    // This is a survey question - store it
    surveyResponses[key] = value;
  }

  return surveyResponses;
}

// ============================================================================
// CSV Detection and Parsing
// ============================================================================

export class LumaUploadService {
  /**
   * Detect the type of Luma CSV based on column headers
   */
  static detectCsvType(headers: string[]): LumaCsvType | null {
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

    // Event Guests CSV has 'api_id' and 'qr_code_url'
    if (normalizedHeaders.includes('api_id') && normalizedHeaders.includes('qr_code_url')) {
      return 'event_guests';
    }

    // Calendar Members CSV has 'user_api_id' and 'first_seen'
    if (normalizedHeaders.includes('user_api_id') && normalizedHeaders.includes('first_seen')) {
      return 'calendar_members';
    }

    return null;
  }

  /**
   * Parse CSV file and return rows with detected type
   */
  static async parseCsvFile(file: File): Promise<{ type: LumaCsvType; rows: any[]; headers: string[] }> {
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
   * Parse CSV text and detect type
   */
  static parseCsvText(text: string): { type: LumaCsvType; rows: any[]; headers: string[] } {
    // Remove BOM if present (handles UTF-8 BOM and other common BOMs)
    const cleanText = text.replace(/^\uFEFF/, '').replace(/^\xEF\xBB\xBF/, '');
    const lines = cleanText.split(/\r?\n/).filter(line => line.trim());

    if (lines.length === 0) {
      throw new Error('CSV file is empty');
    }

    // Parse header - also remove any remaining BOM characters and clean up
    const headers = this.parseCsvLine(lines[0]).map(h =>
      h.trim()
        .replace(/^["']|["']$/g, '')
        .replace(/^\uFEFF/, '')
        .replace(/[\x00-\x1F]/g, '') // Remove control characters
    );

    // Detect CSV type
    const type = this.detectCsvType(headers);
    if (!type) {
      console.error('CSV detection failed. Headers found:', headers);
      console.error('Normalized headers:', headers.map(h => h.toLowerCase().trim()));
      throw new Error(`Unable to detect Luma CSV type. Found columns: ${headers.slice(0, 5).join(', ')}... Expected either Event Guests CSV (with api_id, qr_code_url columns) or Calendar Members CSV (with user_api_id, first_seen columns)`);
    }

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

    return { type, rows, headers };
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
   * Extract Luma event ID from QR code URL
   * Example: https://luma.com/check-in/evt-A8hBdeYpE2NbsKm?pk=xxx
   */
  static extractLumaEventId(qrCodeUrl: string): string | null {
    const match = qrCodeUrl.match(/evt-[A-Za-z0-9]+/);
    return match ? match[0] : null;
  }

  /**
   * Parse monetary amount from Luma format (e.g., "$0.00" or "US$0.00")
   */
  static parseAmount(value: string | undefined): number | null {
    if (!value) return null;
    const numericStr = value.replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(numericStr);
    return isNaN(parsed) ? null : parsed;
  }

  // ============================================================================
  // Event Guests CSV Processing
  // ============================================================================

  /**
   * Process Event Guests CSV upload
   * - Stores all rows in luma_event_registrations
   * - Creates full registration (auth user, customer, member, event_registration) for approved rows
   */
  static async processEventGuestsUpload(
    rows: LumaEventGuestRow[],
    brandId: string,
    adminProfileId: string,
    eventId?: string, // Our internal event_id if already linked
    onProgress?: (current: number, total: number, message: string) => void
  ): Promise<LumaUploadResult> {
    const result: LumaUploadResult = {
      type: 'event_guests',
      total: rows.length,
      processed: 0,
      skipped: 0,
      errors: [],
      registrationsCreated: 0,
    };

    if (rows.length === 0) {
      return result;
    }

    // Extract Luma event ID from the first row's QR code URL
    const lumaEventId = this.extractLumaEventId(rows[0].qr_code_url);
    if (!lumaEventId) {
      result.errors.push({ row: 1, error: 'Could not extract Luma event ID from qr_code_url' });
      return result;
    }
    result.lumaEventId = lumaEventId;

    // If no internal event_id provided, try to find one linked to this Luma event
    let internalEventId = eventId;
    let eventCity: string | undefined;
    let eventCountryCode: string | undefined;

    // Fetch event details including location for customer backfill
    if (internalEventId) {
      const { data: event } = await supabase
        .from('events')
        .select('event_id, event_city, event_country_code')
        .eq('event_id', internalEventId)
        .maybeSingle();

      if (event) {
        eventCity = event.event_city || undefined;
        eventCountryCode = event.event_country_code || undefined;
      }
    } else {
      const { data: event } = await supabase
        .from('events')
        .select('event_id, event_city, event_country_code')
        .eq('luma_event_id', lumaEventId)
        .maybeSingle();

      if (event) {
        internalEventId = event.event_id;
        eventCity = event.event_city || undefined;
        eventCountryCode = event.event_country_code || undefined;
      }
    }

    // ORPHAN DETECTION: Find records marked as 'processed' but whose registration was deleted
    // This handles the case where someone deletes a registration and re-imports
    if (internalEventId) {
      const { data: processedRegs } = await supabase
        .from('luma_event_registrations')
        .select('id, created_registration_id')
        .eq('brand_id', brandId)
        .eq('luma_event_id', lumaEventId)
        .eq('status', 'processed')
        .not('created_registration_id', 'is', null);

      if (processedRegs && processedRegs.length > 0) {
        // Check which registrations still exist
        const regIds = processedRegs.map(r => r.created_registration_id).filter(Boolean);
        const { data: existingRegs } = await supabase
          .from('event_registrations')
          .select('id')
          .in('id', regIds);

        const existingRegIds = new Set(existingRegs?.map(r => r.id) || []);

        // Find orphaned records (registration was deleted)
        const orphanedIds = processedRegs
          .filter(r => r.created_registration_id && !existingRegIds.has(r.created_registration_id))
          .map(r => r.id);

        if (orphanedIds.length > 0) {
          console.log(`Resetting ${orphanedIds.length} orphaned luma_event_registrations to pending`);
          await supabase
            .from('luma_event_registrations')
            .update({
              status: 'pending',
              created_registration_id: null,
              created_customer_id: null,
              created_member_profile_id: null,
              processed_at: null,
            })
            .in('id', orphanedIds);
        }
      }
    }

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Account for header row and 0-indexing

      onProgress?.(i + 1, rows.length, `Processing ${row.email || row.name}...`);

      try {
        // Validate required fields
        if (!row.api_id || !row.email) {
          result.errors.push({ row: rowNum, error: 'Missing required field: api_id or email' });
          result.skipped++;
          continue;
        }

        // Upsert into luma_event_registrations
        const lumaRegData = {
          brand_id: brandId,
          luma_guest_id: row.api_id,
          luma_event_id: lumaEventId,
          email: row.email,
          name: row.name,
          first_name: row.first_name,
          last_name: row.last_name,
          phone_number: row.phone_number || null,
          luma_approval_status: row.approval_status,
          luma_checked_in_at: row.checked_in_at ? new Date(row.checked_in_at).toISOString() : null,
          luma_qr_code_url: row.qr_code_url,
          luma_custom_source: row.custom_source || null,
          luma_ticket_type_id: row.ticket_type_id || null,
          luma_ticket_name: row.ticket_name || null,
          luma_registered_at: row.created_at ? new Date(row.created_at).toISOString() : null,
          amount: this.parseAmount(row.amount),
          amount_tax: this.parseAmount(row.amount_tax),
          amount_discount: this.parseAmount(row.amount_discount),
          currency: row.currency || null,
          coupon_code: row.coupon_code || null,
          uploaded_by_admin_id: adminProfileId,
          raw_csv_row: row,
        };

        const { data: lumaReg, error: lumaRegError } = await supabase
          .from('luma_event_registrations')
          .upsert(lumaRegData, {
            onConflict: 'brand_id,luma_event_id,luma_guest_id',
          })
          .select()
          .single();

        if (lumaRegError) {
          result.errors.push({ row: rowNum, error: `Database error: ${lumaRegError.message}` });
          result.skipped++;
          continue;
        }

        result.processed++;

        // If approval_status is 'approved' and we have an internal event, create full registration
        if (row.approval_status?.toLowerCase() === 'approved' && internalEventId) {
          // Extract ticket info and survey responses
          const lumaData: LumaRegistrationData = {
            ticketType: row.ticket_name || null,
            ticketAmount: this.parseAmount(row.amount),
            currency: row.currency || null,
            couponCode: row.coupon_code || null,
            surveyResponses: extractSurveyResponses(row),
          };

          const regResult = await this.createFullRegistration(
            row.email,
            row.first_name,
            row.last_name,
            row.name,
            internalEventId,
            lumaReg.id,
            row.qr_code_url, // Use Luma QR code as external_qr_code
            row.phone_number, // Pass phone number to enrich customer data
            eventCity, // Pass event city for location backfill
            eventCountryCode, // Pass event country code for location backfill
            lumaData // Pass ticket type, amount, and survey responses
          );

          if (regResult.success) {
            result.registrationsCreated++;

            // Update the luma_event_registrations record with created IDs
            await supabase
              .from('luma_event_registrations')
              .update({
                status: 'processed',
                processed_at: new Date().toISOString(),
                created_customer_id: regResult.customerId,
                created_member_profile_id: regResult.memberProfileId,
                created_registration_id: regResult.registrationId,
              })
              .eq('id', lumaReg.id);
          } else {
            // Still mark as processed but note the error in skip_reason
            await supabase
              .from('luma_event_registrations')
              .update({
                status: 'skipped',
                skip_reason: regResult.error,
              })
              .eq('id', lumaReg.id);
          }
        } else if (row.approval_status?.toLowerCase() !== 'approved') {
          // Mark as skipped with reason
          await supabase
            .from('luma_event_registrations')
            .update({
              status: 'skipped',
              skip_reason: `approval_status is '${row.approval_status}', not 'approved'`,
            })
            .eq('id', lumaReg.id);
        }
      } catch (error: any) {
        result.errors.push({ row: rowNum, error: error.message || 'Unknown error' });
        result.skipped++;
      }
    }

    onProgress?.(rows.length, rows.length, 'Complete');
    return result;
  }

  // ============================================================================
  // Calendar Members CSV Processing
  // ============================================================================

  /**
   * Process Calendar Members CSV upload
   * - Stores all rows in luma_calendar_members (usr-XXX → email mapping)
   * - Attempts to match any pending registrations that were waiting for this data
   */
  static async processCalendarMembersUpload(
    rows: LumaCalendarMemberRow[],
    brandId: string,
    adminProfileId: string,
    lumaCalendarId?: string,
    onProgress?: (current: number, total: number, message: string) => void
  ): Promise<LumaUploadResult> {
    const result: LumaUploadResult = {
      type: 'calendar_members',
      total: rows.length,
      processed: 0,
      skipped: 0,
      errors: [],
      registrationsCreated: 0,
    };

    if (rows.length === 0) {
      return result;
    }

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      onProgress?.(i + 1, rows.length, `Processing ${row.email || row.name}...`);

      try {
        // Validate required fields
        if (!row.user_api_id || !row.email) {
          result.errors.push({ row: rowNum, error: 'Missing required field: user_api_id or email' });
          result.skipped++;
          continue;
        }

        // Upsert into luma_calendar_members
        const memberData = {
          brand_id: brandId,
          luma_user_id: row.user_api_id,
          luma_calendar_id: lumaCalendarId || null,
          email: row.email,
          name: row.name,
          first_name: row.first_name,
          last_name: row.last_name,
          first_seen_at: row.first_seen ? new Date(row.first_seen).toISOString() : null,
          tags: row.tags ? row.tags.split(',').map(t => t.trim()) : null,
          revenue: row.revenue || null,
          event_approved_count: row.event_approved_count ? parseInt(row.event_approved_count, 10) : 0,
          event_checked_in_count: row.event_checked_in_count ? parseInt(row.event_checked_in_count, 10) : 0,
          membership_name: row.membership_name || null,
          membership_status: row.membership_status || null,
          uploaded_by_admin_id: adminProfileId,
          raw_csv_row: row,
        };

        const { error: memberError } = await supabase
          .from('luma_calendar_members')
          .upsert(memberData, {
            onConflict: 'brand_id,luma_user_id',
          });

        if (memberError) {
          result.errors.push({ row: rowNum, error: `Database error: ${memberError.message}` });
          result.skipped++;
          continue;
        }

        result.processed++;
      } catch (error: any) {
        result.errors.push({ row: rowNum, error: error.message || 'Unknown error' });
        result.skipped++;
      }
    }

    // After uploading, attempt to match pending registrations
    onProgress?.(rows.length, rows.length, 'Matching pending registrations...');
    const matchedCount = await this.matchPendingRegistrations(brandId);
    result.registrationsCreated = matchedCount;

    onProgress?.(rows.length, rows.length, 'Complete');
    return result;
  }

  // ============================================================================
  // Registration Creation
  // ============================================================================

  /**
   * Create full registration (auth user, customer, member profile, event registration)
   * When processing from CSV upload, this also updates customer attributes (first_name, last_name, phone, city, country_code)
   */
  static async createFullRegistration(
    email: string,
    firstName: string | undefined,
    lastName: string | undefined,
    fullName: string | undefined,
    eventId: string,
    lumaRegistrationId: string,
    externalQrCode?: string,
    phoneNumber?: string,
    eventCity?: string,
    eventCountryCode?: string,
    lumaData?: LumaRegistrationData
  ): Promise<{ success: boolean; error?: string; customerId?: number; memberProfileId?: string; registrationId?: string }> {
    try {
      // Use first_name/last_name if provided, otherwise split full name
      let first = firstName;
      let last = lastName;

      if ((!first || !last) && fullName) {
        const parts = fullName.trim().split(/\s+/);
        if (parts.length === 1) {
          first = first || parts[0];
          last = last || '';
        } else {
          last = last || parts[parts.length - 1];
          first = first || parts.slice(0, -1).join(' ');
        }
      }

      // Check if customer already exists
      let { data: customer } = await supabase
        .from('customers')
        .select('id, cio_id, attributes')
        .eq('email', email)
        .maybeSingle();

      // If no customer, create auth user which triggers customer creation
      if (!customer) {
        // Create auth user (this triggers the auth webhook to create customer)
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            first_name: first,
            last_name: last,
          },
        });

        if (authError) {
          // Check if user already exists
          if (authError.message?.includes('already been registered')) {
            // User exists, fetch the customer
            const { data: existingCustomer } = await supabase
              .from('customers')
              .select('id, cio_id, attributes')
              .eq('email', email)
              .maybeSingle();

            if (existingCustomer) {
              customer = existingCustomer;
            } else {
              return { success: false, error: `Auth user exists but no customer found for ${email}` };
            }
          } else {
            return { success: false, error: `Failed to create auth user: ${authError.message}` };
          }
        } else if (authData.user) {
          // Poll for customer to be created by webhook
          for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const { data: newCustomer } = await supabase
              .from('customers')
              .select('id, cio_id, attributes')
              .eq('email', email)
              .maybeSingle();

            if (newCustomer) {
              customer = newCustomer;
              break;
            }
          }

          if (!customer) {
            return { success: false, error: 'Customer creation timed out' };
          }
        }
      }

      if (!customer) {
        return { success: false, error: 'Could not find or create customer' };
      }

      // Update customer attributes if we have better data from the CSV or event location
      // This enriches customer records when event owner uploads the Event Guests CSV
      const currentAttrs = customer.attributes || {};
      const attrUpdates: Record<string, any> = {};

      // Update first_name if we have it and customer doesn't
      if (first && !currentAttrs.first_name) {
        attrUpdates.first_name = first;
      }

      // Update last_name if we have it and customer doesn't
      if (last && !currentAttrs.last_name) {
        attrUpdates.last_name = last;
      }

      // Update phone if we have it and customer doesn't
      if (phoneNumber && !currentAttrs.phone) {
        attrUpdates.phone = phoneNumber;
      }

      // Backfill location from event if customer doesn't have it
      if (eventCity && !currentAttrs.city) {
        attrUpdates.city = eventCity;
      }

      if (eventCountryCode && !currentAttrs.country_code) {
        attrUpdates.country_code = eventCountryCode;
      }

      // Apply updates if any
      if (Object.keys(attrUpdates).length > 0) {
        await supabase
          .from('customers')
          .update({
            attributes: { ...currentAttrs, ...attrUpdates }
          })
          .eq('id', customer.id);
      }

      // Get or create member profile
      const { data: memberProfileId, error: memberError } = await supabase
        .rpc('get_or_create_member_from_customer', {
          p_customer_id: customer.id,
        });

      if (memberError) {
        return { success: false, error: `Failed to create member profile: ${memberError.message}` };
      }

      // Determine registration type and payment status based on ticket amount
      const isPaid = lumaData?.ticketAmount && lumaData.ticketAmount > 0;
      const registrationType = isPaid ? 'paid' : 'free';
      const paymentStatus = isPaid ? 'paid' : 'comp';

      // Check if already registered
      const { data: existingReg } = await supabase
        .from('event_registrations')
        .select('id, registration_metadata')
        .eq('event_id', eventId)
        .eq('member_profile_id', memberProfileId)
        .maybeSingle();

      if (existingReg) {
        // Already registered, update with Luma data if provided
        const updateData: Record<string, any> = {};
        if (externalQrCode) updateData.external_qr_code = externalQrCode;
        if (lumaData?.ticketType) updateData.ticket_type = lumaData.ticketType;
        if (lumaData?.ticketAmount) {
          updateData.amount_paid = lumaData.ticketAmount;
          updateData.registration_type = registrationType;
          updateData.payment_status = paymentStatus;
        }
        if (lumaData?.surveyResponses && Object.keys(lumaData.surveyResponses).length > 0) {
          const currentMetadata = (existingReg.registration_metadata as Record<string, any>) || {};
          updateData.registration_metadata = {
            ...currentMetadata,
            luma_survey_responses: lumaData.surveyResponses,
          };
        }

        if (Object.keys(updateData).length > 0) {
          await supabase
            .from('event_registrations')
            .update(updateData)
            .eq('id', existingReg.id);
        }
        return {
          success: true,
          customerId: customer.id,
          memberProfileId,
          registrationId: existingReg.id,
        };
      }

      // Build registration metadata with survey responses
      const registrationMetadata: Record<string, any> = {};
      if (lumaData?.surveyResponses && Object.keys(lumaData.surveyResponses).length > 0) {
        registrationMetadata.luma_survey_responses = lumaData.surveyResponses;
      }

      // Create event registration
      const { data: registration, error: regError } = await supabase
        .from('event_registrations')
        .insert({
          event_id: eventId,
          member_profile_id: memberProfileId,
          registration_type: registrationType,
          registration_source: 'luma_csv_upload',
          payment_status: paymentStatus,
          status: 'confirmed',
          external_qr_code: externalQrCode || null,
          ticket_type: lumaData?.ticketType || null,
          amount_paid: lumaData?.ticketAmount || null,
          registration_metadata: Object.keys(registrationMetadata).length > 0 ? registrationMetadata : {},
        })
        .select('id')
        .single();

      if (regError) {
        return { success: false, error: `Failed to create registration: ${regError.message}` };
      }

      return {
        success: true,
        customerId: customer.id,
        memberProfileId,
        registrationId: registration.id,
      };
    } catch (error: any) {
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  // ============================================================================
  // Pending Registration Matching
  // ============================================================================

  /**
   * Match pending registrations with newly uploaded calendar members
   * Called after calendar members CSV upload
   */
  static async matchPendingRegistrations(brandId: string): Promise<number> {
    let matchedCount = 0;

    // Get all pending registrations for this brand
    const { data: pendingRegs, error: pendingError } = await supabase
      .from('luma_pending_registrations')
      .select('*')
      .eq('brand_id', brandId)
      .eq('status', 'pending');

    if (pendingError || !pendingRegs || pendingRegs.length === 0) {
      return 0;
    }

    for (const pending of pendingRegs) {
      // Try to find the user in calendar members
      const { data: member } = await supabase
        .from('luma_calendar_members')
        .select('email, name, first_name, last_name')
        .eq('brand_id', brandId)
        .eq('luma_user_id', pending.luma_user_id)
        .maybeSingle();

      if (!member) {
        continue; // Still can't match, keep as pending
      }

      // Found the email! Now try to find the event
      const { data: event } = await supabase
        .from('events')
        .select('event_id, event_city, event_country_code')
        .eq('luma_event_id', pending.luma_event_id)
        .maybeSingle();

      if (!event) {
        // Update pending registration with matched email but mark as no_event
        await supabase
          .from('luma_pending_registrations')
          .update({
            status: 'no_event',
            matched_email: member.email,
            matched_via: 'calendar_member',
            matched_at: new Date().toISOString(),
            error_message: `No event found with luma_event_id: ${pending.luma_event_id}`,
          })
          .eq('id', pending.id);
        continue;
      }

      // Create full registration
      const regResult = await this.createFullRegistration(
        member.email,
        member.first_name,
        member.last_name,
        member.name,
        event.event_id,
        pending.id,
        undefined, // externalQrCode
        undefined, // phoneNumber
        event.event_city || undefined, // eventCity for location backfill
        event.event_country_code || undefined // eventCountryCode for location backfill
      );

      if (regResult.success) {
        matchedCount++;
        await supabase
          .from('luma_pending_registrations')
          .update({
            status: 'processed',
            matched_email: member.email,
            matched_via: 'calendar_member',
            matched_at: new Date().toISOString(),
            processed_at: new Date().toISOString(),
            created_customer_id: regResult.customerId,
            created_member_profile_id: regResult.memberProfileId,
            created_registration_id: regResult.registrationId,
          })
          .eq('id', pending.id);
      } else {
        await supabase
          .from('luma_pending_registrations')
          .update({
            status: 'failed',
            matched_email: member.email,
            matched_via: 'calendar_member',
            matched_at: new Date().toISOString(),
            error_message: regResult.error,
          })
          .eq('id', pending.id);
      }
    }

    return matchedCount;
  }

  // ============================================================================
  // Unified Upload Handler
  // ============================================================================

  /**
   * Main entry point for Luma CSV uploads
   * Auto-detects CSV type and processes accordingly
   */
  static async processUpload(
    file: File,
    brandId: string,
    adminProfileId: string,
    options?: {
      eventId?: string;           // Internal event_id (for event guests)
      lumaCalendarId?: string;    // Luma calendar ID (for calendar members)
      onProgress?: (current: number, total: number, message: string) => void;
    }
  ): Promise<LumaUploadResult> {
    const { type, rows } = await this.parseCsvFile(file);

    if (type === 'event_guests') {
      return this.processEventGuestsUpload(
        rows as LumaEventGuestRow[],
        brandId,
        adminProfileId,
        options?.eventId,
        options?.onProgress
      );
    } else {
      return this.processCalendarMembersUpload(
        rows as LumaCalendarMemberRow[],
        brandId,
        adminProfileId,
        options?.lumaCalendarId,
        options?.onProgress
      );
    }
  }

  // ============================================================================
  // Background Upload Methods (New Flow)
  // ============================================================================

  /**
   * Upload CSV data for background processing
   * Returns immediately after storing the data - processing happens in Edge Function
   */
  static async uploadForBackgroundProcessing(
    file: File,
    brandId: string,
    adminProfileId: string,
    options?: {
      eventId?: string;
      lumaCalendarId?: string;
    }
  ): Promise<{ uploadId: string; rowCount: number; csvType: LumaCsvType }> {
    // Parse the CSV file
    const { type, rows, headers } = await this.parseCsvFile(file);

    // Extract Luma event ID for event_guests CSVs
    let lumaEventId: string | null = null;
    if (type === 'event_guests' && rows.length > 0) {
      lumaEventId = this.extractLumaEventId(rows[0].qr_code_url);
    }

    // Insert the upload record
    const { data, error } = await supabase
      .from('luma_csv_uploads')
      .insert({
        brand_id: brandId,
        file_name: file.name,
        csv_type: type,
        row_count: rows.length,
        csv_data: rows,
        csv_headers: headers,
        event_id: options?.eventId || null,
        luma_calendar_id: options?.lumaCalendarId || null,
        luma_event_id: lumaEventId,
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
      rowCount: rows.length,
      csvType: type,
    };
  }

  /**
   * Trigger the Edge Function to process the upload
   */
  static async triggerBackgroundProcessing(uploadId: string): Promise<void> {
    const { error } = await supabase.functions.invoke('process-luma-csv', {
      body: { uploadId },
    });

    if (error) {
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
  }

  /**
   * Get the current status of a CSV upload
   */
  static async getUploadStatus(uploadId: string): Promise<LumaCsvUpload | null> {
    const { data, error } = await supabase
      .from('luma_csv_uploads')
      .select('*')
      .eq('id', uploadId)
      .single();

    if (error || !data) {
      return null;
    }

    return data as LumaCsvUpload;
  }

  /**
   * Subscribe to upload status changes
   */
  static subscribeToUploadStatus(
    uploadId: string,
    callback: (upload: LumaCsvUpload) => void
  ): () => void {
    const channel = supabase
      .channel(`luma-upload-${uploadId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'luma_csv_uploads',
          filter: `id=eq.${uploadId}`,
        },
        (payload) => {
          callback(payload.new as LumaCsvUpload);
        }
      )
      .subscribe();

    // Return unsubscribe function
    return () => {
      supabase.removeChannel(channel);
    };
  }

  /**
   * Get recent uploads for a brand
   * Optionally filter by event_id for event-specific views
   * Optionally filter by calendar_id for calendar-specific views
   */
  static async getRecentUploads(
    brandId: string,
    limit = 10,
    eventId?: string,
    calendarId?: string
  ): Promise<LumaCsvUpload[]> {
    let query = supabase
      .from('luma_csv_uploads')
      .select('*')
      .eq('brand_id', brandId)
      .order('uploaded_at', { ascending: false })
      .limit(limit);

    // Filter by event_id if provided (only for event_guests type)
    if (eventId) {
      query = query.eq('event_id', eventId);
    }

    // Filter by calendar_id if provided (only for calendar_members_import type)
    if (calendarId) {
      query = query.eq('calendar_id', calendarId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch recent uploads:', error);
      return [];
    }

    return data as LumaCsvUpload[];
  }
}
