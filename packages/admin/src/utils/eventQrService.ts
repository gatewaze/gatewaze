import { supabase } from '@/lib/supabase';

// Types for the QR system
export interface EventSponsor {
  id: string;
  event_id: string;
  sponsor_id: string;
  sponsorship_tier: 'platinum' | 'gold' | 'silver' | 'bronze' | 'partner' | 'exhibitor' | null;
  booth_number: string | null;
  booth_size: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  team_member_count?: number; // Count of team members for this sponsor
  badge_scan_count?: number; // Total badge scans performed by team members
  // Joined sponsor data
  sponsor?: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    website: string | null;
    description: string | null;
    contact_email: string | null;
    contact_phone: string | null;
  };
}

export interface EventRegistration {
  id: string;
  people_profile_id: string;
  event_id: string;
  registration_type: 'standard' | 'vip' | 'speaker' | 'sponsor_staff' | null;
  ticket_type: string | null;
  ticket_quantity: number;
  registration_source: string | null;
  status: 'confirmed' | 'cancelled' | 'waitlist';
  registered_at: string;
  // Payment fields
  amount_paid?: number | null;
  currency?: string | null;
  payment_status?: string | null;
  // New bulk upload fields
  sponsor_permission?: boolean;
  external_qr_code?: string | null;
  source?: string | null;
  // Registration metadata (answers, tracking, etc.)
  registration_metadata?: {
    registration_answers?: Array<{
      label: string;
      value: any;
      answer: any;
      question_type?: string;
      question_id?: string;
    }>;
    luma_survey_responses?: Record<string, string>;
    luma_guest_id?: string;
    tracking_session_id?: string;
  } | null;
  // Joined member data
  qr_code_id?: string;
  person_id?: number;
  full_name?: string;
  email?: string;
  company?: string;
  job_title?: string;
  linkedin_url?: string | null;
}

export interface EventAttendance {
  id: string;
  people_profile_id: string;
  event_id: string;
  event_registration_id: string | null;
  checked_in_at: string;
  checked_out_at: string | null;
  check_in_method: 'qr_scan' | 'manual' | 'badge_print' | null;
  badge_printed_on_site: boolean;
  // Joined member data
  qr_code_id?: string;
  person_id?: number;
  full_name?: string;
  email?: string;
  company?: string;
}

export interface DiscountCodeClaim {
  id: string;
  customer_id: number;
  discount_code_id: number;
  event_id: string;
  claimed_at: string;
  used_for_purchase: boolean;
  // Joined customer data
  email?: string;
  full_name?: string;
  company?: string;
}

export interface Sponsor {
  id: string;
  account_id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  website: string | null;
  description: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
}

/**
 * Service for managing event QR/badge system data
 */
export class EventQrService {
  /**
   * Resolve a varchar event_id (e.g. "fv1l2f") to the UUID primary key.
   * Many core tables use UUID event_id FK, but the app routes use the short varchar.
   */
  private static async resolveEventUuid(eventId: string): Promise<string | null> {
    // If it already looks like a UUID, return as-is
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
      return eventId;
    }
    const { data } = await supabase
      .from('events')
      .select('id')
      .eq('event_id', eventId)
      .single();
    return data?.id ?? null;
  }

  /**
   * Get all sponsors for an event
   */
  static async getEventSponsors(eventId: string): Promise<EventSponsor[]> {
    try {
      const { data, error } = await supabase
        .from('events_sponsors')
        .select(`
          *,
          sponsor:events_sponsor_profiles (
            id,
            name,
            slug,
            logo_url,
            website,
            description,
            contact_email,
            contact_phone
          )
        `)
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // If we have sponsors, fetch team member counts and badge scan counts for each
      if (data && data.length > 0) {
        const sponsorIds = data.map(s => s.id);

        // Count team members for each sponsor
        const { data: teamCounts, error: countError } = await supabase
          .from('events_registrations')
          .select('sponsor_team_id')
          .eq('event_id', eventId)
          .in('sponsor_team_id', sponsorIds)
          .not('sponsor_team_id', 'is', null);

        // Get team member profile IDs for badge scan counting and primary contacts
        const { data: teamMembers, error: teamMembersError } = await supabase
          .from('events_registrations_with_people')
          .select('sponsor_team_id, people_profile_id, is_primary_contact, full_name, email')
          .eq('event_id', eventId)
          .in('sponsor_team_id', sponsorIds)
          .not('sponsor_team_id', 'is', null);

        if (teamMembersError) {
          console.error('❌ Error fetching team members:', teamMembersError);
        }

        // Get all badge scans for this event by team members
        let scanCountMap: Record<string, number> = {};
        if (teamMembers && teamMembers.length > 0) {
          const memberProfileIds = teamMembers.map(tm => tm.people_profile_id);

          const { data: scans } = await supabase
            .from('people_contact_scans')
            .select('scanner_people_profile_id')
            .eq('event_id', eventId)
            .in('scanner_people_profile_id', memberProfileIds);

          if (scans) {
            // Create a map of people_profile_id -> scan count
            const memberScanCounts = scans.reduce((acc, scan) => {
              acc[scan.scanner_people_profile_id] = (acc[scan.scanner_people_profile_id] || 0) + 1;
              return acc;
            }, {} as Record<string, number>);

            // Sum up scans by sponsor team
            scanCountMap = teamMembers.reduce((acc, member) => {
              const scanCount = memberScanCounts[member.people_profile_id] || 0;
              acc[member.sponsor_team_id] = (acc[member.sponsor_team_id] || 0) + scanCount;
              return acc;
            }, {} as Record<string, number>);
          }
        }

        if (!countError && teamCounts) {
          // Create a map of sponsor_id -> count
          const countMap = teamCounts.reduce((acc, reg) => {
            acc[reg.sponsor_team_id] = (acc[reg.sponsor_team_id] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          // Create a map of sponsor_id -> primary contact
          const primaryContactMap = teamMembers?.reduce((acc, member) => {
            if (member.is_primary_contact && member.full_name && member.email) {
              acc[member.sponsor_team_id] = {
                full_name: member.full_name,
                email: member.email,
              };
            }
            return acc;
          }, {} as Record<string, { full_name: string; email: string }>) || {};

          console.log('📊 Primary contact map:', primaryContactMap);
          console.log('📊 Team members with primary contact info:', teamMembers?.map(m => ({
            sponsor_team_id: m.sponsor_team_id,
            name: m.full_name,
            is_primary_contact: m.is_primary_contact
          })));

          // Add counts and primary contact to each sponsor
          return data.map(sponsor => ({
            ...sponsor,
            team_member_count: countMap[sponsor.id] || 0,
            badge_scan_count: scanCountMap[sponsor.id] || 0,
            primary_contact: primaryContactMap[sponsor.id] || null,
          }));
        }
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching event sponsors:', error);
      throw error;
    }
  }

  /**
   * Get all available sponsors (for assignment to events)
   */
  static async getAllSponsors(): Promise<Sponsor[]> {
    try {
      const { data, error } = await supabase
        .from('events_sponsor_profiles')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching sponsors:', error);
      throw error;
    }
  }

  /**
   * Create a new sponsor
   */
  static async createSponsor(params: {
    name: string;
    account_id?: string;
  }): Promise<Sponsor> {
    try {
      // Generate slug from name
      const slug = params.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      const { data, error } = await supabase
        .from('events_sponsor_profiles')
        .insert([{
          name: params.name,
          slug,
          account_id: params.account_id || null,
          is_active: true,
        }])
        .select('*')
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating sponsor:', error);
      throw error;
    }
  }

  /**
   * Add a sponsor to an event
   */
  static async addEventSponsor(params: {
    event_id: string;
    sponsor_id: string;
    sponsorship_tier?: 'platinum' | 'gold' | 'silver' | 'bronze' | 'partner' | 'exhibitor';
    booth_number?: string;
    booth_size?: string;
  }): Promise<EventSponsor> {
    try {
      const { data, error } = await supabase
        .from('events_sponsors')
        .insert([params])
        .select(`
          *,
          sponsor:events_sponsor_profiles (
            id,
            name,
            slug,
            logo_url,
            website,
            description,
            contact_email,
            contact_phone
          )
        `)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error adding event sponsor:', error);
      throw error;
    }
  }

  /**
   * Update an event sponsor
   */
  static async updateEventSponsor(
    id: string,
    updates: Partial<Omit<EventSponsor, 'id' | 'event_id' | 'sponsor_id' | 'created_at' | 'updated_at'>>
  ): Promise<EventSponsor> {
    try {
      const { data, error } = await supabase
        .from('events_sponsors')
        .update(updates)
        .eq('id', id)
        .select(`
          *,
          sponsor:events_sponsor_profiles (
            id,
            name,
            slug,
            logo_url,
            website,
            description,
            contact_email,
            contact_phone
          )
        `)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating event sponsor:', error);
      throw error;
    }
  }

  /**
   * Update sponsor name (in the sponsors table)
   */
  static async updateSponsorName(sponsorId: string, name: string): Promise<Sponsor> {
    try {
      const { data, error } = await supabase
        .from('events_sponsor_profiles')
        .update({ name })
        .eq('id', sponsorId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating sponsor name:', error);
      throw error;
    }
  }

  /**
   * Remove a sponsor from an event
   */
  static async removeEventSponsor(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('events_sponsors')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } catch (error) {
      console.error('Error removing event sponsor:', error);
      throw error;
    }
  }

  /**
   * Get all registrations for an event
   * Supports both:
   * 1. discount_codes table (for discount events with registered = true)
   * 2. event_registrations_with_members view (for QR-based registrations)
   */
  static async getEventRegistrations(eventId: string, options?: { hasDiscountCodes?: boolean }): Promise<EventRegistration[]> {
    try {
      // Only query discount_codes table if the module is enabled
      if (options?.hasDiscountCodes !== false) {
      // First, check if this event has discount_codes with registration data
      const { data: discountCodes, error: codesError } = await supabase
        .from('events_discount_codes')
        .select(`
          id,
          code,
          issued_to,
          registered_at,
          member_profile_id,
          event_registration_id,
          events_registrations!inner(sponsor_team_id)
        `)
        .eq('event_id', eventId)
        .eq('registered', true)
        .order('registered_at', { ascending: false });

      // If we have discount codes registration data, use that
      if (!codesError && discountCodes && discountCodes.length > 0) {
        // Get unique email addresses
        const emails = [...new Set(discountCodes.map((c: any) => c.issued_to).filter(Boolean))];

        // Fetch customer details by email (batched to avoid URL length limits)
        const BATCH_SIZE = 100;
        const emailBatches = this.batchArray(emails, BATCH_SIZE);
        let allCustomers: any[] = [];

        for (const batch of emailBatches) {
          const { data: customers, error: customersError } = await supabase
            .from('people')
            .select('email, cio_id, attributes')
            .in('email', batch);

          if (customersError) {
            console.warn('Error fetching customer data for registrations:', customersError);
          } else if (customers) {
            allCustomers = allCustomers.concat(customers);
          }
        }

        // Create a map of customers by email for quick lookup
        const customerMap = new Map(allCustomers.map((c: any) => [c.email, c]));

        // Transform to EventRegistration format
        return discountCodes.map((code: any) => {
          const customer = customerMap.get(code.issued_to);
          return {
            id: code.id,
            people_profile_id: code.member_profile_id || customer?.cio_id || code.issued_to,
            event_id: eventId,
            registration_type: null,
            ticket_type: 'discount_code',
            registration_source: 'discount_code',
            status: 'confirmed',
            registered_at: code.registered_at,
            qr_code_id: code.code,
            full_name: customer?.attributes?.first_name && customer?.attributes?.last_name
              ? `${customer.attributes.first_name} ${customer.attributes.last_name}`
              : customer?.attributes?.first_name || code.issued_to,
            email: code.issued_to,
            company: customer?.attributes?.company,
            job_title: customer?.attributes?.job_title,
            sponsor_team_id: code.events_registrations?.sponsor_team_id || null,
          };
        });
      }
      } // end hasDiscountCodes guard

      // Fall back to events_registrations_with_people view
      // The view's event_id is a UUID, so resolve the varchar event_id first
      const eventUuid = await this.resolveEventUuid(eventId);
      if (!eventUuid) return [];

      let allData: EventRegistration[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('events_registrations_with_people')
          .select('*')
          .eq('event_id', eventUuid)
          .order('registered_at', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allData = allData.concat(data);
          hasMore = data.length === pageSize;
          page++;
        } else {
          hasMore = false;
        }
      }

      return allData;
    } catch (error) {
      console.error('Error fetching event registrations:', error);
      return [];
    }
  }

  /**
   * Get all attendance records for an event
   * Supports both:
   * 1. discount_codes table (for discount events with attended = true)
   * 2. event_attendance_with_details view (for QR-based check-ins)
   */
  static async getEventAttendance(eventId: string, options?: { hasDiscountCodes?: boolean; hasBadgeScanning?: boolean }): Promise<EventAttendance[]> {
    try {
      // Only query discount_codes table if the module is enabled
      if (options?.hasDiscountCodes !== false) {
      // Try discount_codes table first (only exists when discount module is installed)
      const { data: discountCodes, error: codesError } = await supabase
        .from('events_discount_codes')
        .select('id, code, issued_to, attended_at, member_profile_id, event_registration_id')
        .eq('event_id', eventId)
        .eq('attended', true)
        .order('attended_at', { ascending: false });

      // If the table exists and has data, use it
      if (!codesError && discountCodes && discountCodes.length > 0) {
        // Get unique email addresses
        const emails = [...new Set(discountCodes.map((c: any) => c.issued_to).filter(Boolean))];

        // Fetch customer details by email (batched to avoid URL length limits)
        const BATCH_SIZE = 100;
        const emailBatches = this.batchArray(emails, BATCH_SIZE);
        let allCustomers: any[] = [];

        for (const batch of emailBatches) {
          const { data: customers, error: customersError } = await supabase
            .from('people')
            .select('email, cio_id, attributes')
            .in('email', batch);

          if (customersError) {
            console.warn('Error fetching customer data for attendance:', customersError);
          } else if (customers) {
            allCustomers = allCustomers.concat(customers);
          }
        }

        // Create a map of customers by email for quick lookup
        const customerMap = new Map(allCustomers.map((c: any) => [c.email, c]));

        // Transform to EventAttendance format
        return discountCodes.map((code: any) => {
          const customer = customerMap.get(code.issued_to);
          return {
            id: code.id,
            people_profile_id: code.member_profile_id || customer?.cio_id || code.issued_to,
            event_id: eventId,
            event_registration_id: code.event_registration_id,
            checked_in_at: code.attended_at,
            checked_out_at: null,
            check_in_method: 'manual',
            badge_printed_on_site: false,
            qr_code_id: code.code,
            full_name: customer?.attributes?.first_name && customer?.attributes?.last_name
              ? `${customer.attributes.first_name} ${customer.attributes.last_name}`
              : customer?.attributes?.first_name || code.issued_to,
            email: code.issued_to,
            company: customer?.attributes?.company,
          };
        });
      }
      } // end hasDiscountCodes guard

      // Try events_attendance_with_details view (only exists with badge-scanning module)
      if (options?.hasBadgeScanning !== false) {
      const { data: viewData, error: viewError } = await supabase
        .from('events_attendance_with_details')
        .select('*')
        .eq('event_id', eventId)
        .order('checked_in_at', { ascending: false })
        .limit(1);

      if (!viewError) {
        // View exists — fetch all records with pagination
        let allData: EventAttendance[] = viewData && viewData.length > 0 ? [...viewData] : [];
        if (viewData && viewData.length > 0) {
          let page = 1;
          const pageSize = 1000;
          let hasMore = true;
          while (hasMore) {
            const { data, error } = await supabase
              .from('events_attendance_with_details')
              .select('*')
              .eq('event_id', eventId)
              .order('checked_in_at', { ascending: false })
              .range(page * pageSize, (page + 1) * pageSize - 1);
            if (error) throw error;
            if (data && data.length > 0) {
              allData = allData.concat(data);
              hasMore = data.length === pageSize;
              page++;
            } else {
              hasMore = false;
            }
          }
        }
        return allData;
      }
      } // end hasBadgeScanning guard

      // Final fallback: core events_attendance table (always exists)
      // events_attendance.event_id is a UUID FK, so resolve the varchar first
      const eventUuid = await this.resolveEventUuid(eventId);
      if (!eventUuid) return [];

      const { data: coreData, error: coreError } = await supabase
        .from('events_attendance')
        .select('*')
        .eq('event_id', eventUuid)
        .order('checked_in_at', { ascending: false });

      if (coreError) throw coreError;
      return (coreData || []) as EventAttendance[];
    } catch (error) {
      console.error('Error fetching event attendance:', error);
      return [];
    }
  }

  /**
   * Get all discount code claims for an event
   * Supports both data models:
   * 1. discount_codes table (older events with issued_to email)
   * 2. discount_interactions table (newer events with customer_cio_id)
   */
  static async getDiscountCodeClaims(eventId: string): Promise<DiscountCodeClaim[]> {
    try {
      // Try the discount_codes approach first (older data model)
      const { data: codes, error: codesError } = await supabase
        .from('events_discount_codes')
        .select('id, code, issued_to, issued_at')
        .eq('event_id', eventId)
        .eq('issued', true)
        .order('issued_at', { ascending: false });

      // If we have discount codes data, use that
      if (!codesError && codes && codes.length > 0) {
        // Get unique email addresses
        const emails = [...new Set(codes.map((c: any) => c.issued_to).filter(Boolean))];

        // Fetch customer details by email
        const { data: customers, error: customersError } = await supabase
          .from('people')
          .select('email, cio_id, attributes')
          .in('email', emails);

        if (customersError) {
          console.warn('Error fetching customer data:', customersError);
        }

        // Create a map of customers by email for quick lookup
        const customerMap = new Map((customers || []).map((c: any) => [c.email, c]));

        // Transform the data to include parsed customer info
        return codes.map((code: any) => {
          const customer = customerMap.get(code.issued_to);
          return {
            id: code.id,
            customer_id: customer?.cio_id || code.issued_to,
            discount_code_id: code.id,
            event_id: eventId,
            claimed_at: code.issued_at,
            used_for_purchase: false, // Not tracked in discount_codes table
            email: code.issued_to,
            full_name: customer?.attributes?.first_name && customer?.attributes?.last_name
              ? `${customer.attributes.first_name} ${customer.attributes.last_name}`
              : customer?.attributes?.first_name || code.issued_to,
            company: customer?.attributes?.company,
          };
        });
      }

      // If no discount codes, try the discount_interactions approach (newer data model)
      // First get the event to find its offer_id (offerSlug)
      const { data: event, error: eventError } = await supabase
        .from('events')
        .select('offer_slug')
        .eq('event_id', eventId)
        .single();

      if (eventError) throw eventError;
      if (!event?.offer_slug) return [];

      // Get all interactions for this offer where status indicates they claimed it
      const { data, error } = await supabase
        .from('events_discount_interactions')
        .select(`
          *
        `)
        .eq('offer_id', event.offer_slug)
        .in('offer_status', ['claimed', 'converted', 'viewed'])
        .order('timestamp', { ascending: false });

      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Get unique customer IDs
      const customerCioIds = [...new Set(data.map((d: any) => d.customer_cio_id))];

      // Fetch customer details
      const { data: customers, error: customersError } = await supabase
        .from('people')
        .select('cio_id, email, attributes')
        .in('cio_id', customerCioIds);

      if (customersError) throw customersError;

      // Create a map of customers by cio_id for quick lookup
      const customerMap = new Map((customers || []).map((c: any) => [c.cio_id, c]));

      // Transform the data to include parsed customer info
      return data.map((interaction: any) => {
        const customer = customerMap.get(interaction.customer_cio_id);
        return {
          id: interaction.id,
          customer_id: interaction.customer_cio_id,
          discount_code_id: null, // Not used in this data model
          event_id: eventId,
          claimed_at: interaction.timestamp,
          used_for_purchase: interaction.offer_status === 'converted',
          email: customer?.email,
          full_name: customer?.attributes?.first_name && customer?.attributes?.last_name
            ? `${customer.attributes.first_name} ${customer.attributes.last_name}`
            : customer?.attributes?.first_name || customer?.email,
          company: customer?.attributes?.company,
        };
      });
    } catch (error) {
      console.error('Error fetching discount code claims:', error);
      return [];
    }
  }

  /**
   * Get registration statistics for an event
   */
  static async getEventRegistrationStats(eventId: string): Promise<{
    total: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
  }> {
    try {
      const { data, error } = await supabase
        .rpc('events_get_registration_stats', { p_event_id: eventId });

      if (error) throw error;
      return data || { total: 0, by_status: {}, by_type: {} };
    } catch (error) {
      console.error('Error fetching registration stats:', error);
      // Return default values if the RPC function doesn't exist yet
      return { total: 0, by_status: {}, by_type: {} };
    }
  }

  /**
   * Get attendance statistics for an event
   */
  static async getEventAttendanceStats(eventId: string): Promise<{
    total_registered: number;
    total_attended: number;
    attendance_rate: number;
    checked_in_today: number;
  }> {
    try {
      const { data, error } = await supabase
        .rpc('events_get_attendance_stats', { p_event_id: eventId });

      if (error) throw error;
      return data || { total_registered: 0, total_attended: 0, attendance_rate: 0, checked_in_today: 0 };
    } catch (error) {
      console.error('Error fetching attendance stats:', error);
      // Return default values if the RPC function doesn't exist yet
      return { total_registered: 0, total_attended: 0, attendance_rate: 0, checked_in_today: 0 };
    }
  }

  /**
   * Get sponsor team members and their scan statistics
   */
  static async getSponsorTeamStats(eventSponsorId: string): Promise<Array<{
    people_profile_id: string;
    full_name: string;
    email: string;
    registration_type: string;
    scan_count: number;
    latest_scan_at: string | null;
  }>> {
    try {
      const { data, error } = await supabase.rpc('events_get_sponsor_scan_stats', {
        p_event_sponsor_id: eventSponsorId,
      });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching sponsor team stats:', error);
      // Fallback to manual query if RPC doesn't exist
      return this.getSponsorTeamStatsFallback(eventSponsorId);
    }
  }

  /**
   * Fallback method to get sponsor team stats without RPC function
   */
  private static async getSponsorTeamStatsFallback(eventSponsorId: string): Promise<Array<{
    people_profile_id: string;
    full_name: string;
    email: string;
    registration_type: string;
    scan_count: number;
    latest_scan_at: string | null;
  }>> {
    try {
      // Get team members
      const { data: teamMembers, error: teamError } = await supabase
        .from('events_registrations')
        .select(`
          id,
          people_profile_id,
          registration_type,
          people_profiles!event_registrations_member_profile_id_fkey (
            id,
            customers!member_profiles_customer_id_fkey (
              email,
              attributes
            )
          )
        `)
        .eq('sponsor_team_id', eventSponsorId);

      if (teamError) {
        console.error('Error fetching team members:', teamError);
        throw teamError;
      }

      if (!teamMembers || teamMembers.length === 0) {
        return [];
      }

      // Get scan counts for each team member
      const memberIds = teamMembers.map((m: any) => m.people_profile_id);

      const { data: scans, error: scansError } = await supabase
        .from('people_contact_scans')
        .select('scanner_people_profile_id, scanned_at')
        .in('scanner_people_profile_id', memberIds);

      if (scansError) {
        console.error('Error fetching scans:', scansError);
        // Don't throw, just continue with 0 counts
      }

      // Aggregate results
      const scansByMember = (scans || []).reduce((acc: any, scan: any) => {
        if (!acc[scan.scanner_people_profile_id]) {
          acc[scan.scanner_people_profile_id] = { count: 0, latest: null };
        }
        acc[scan.scanner_people_profile_id].count++;
        if (!acc[scan.scanner_people_profile_id].latest || scan.scanned_at > acc[scan.scanner_people_profile_id].latest) {
          acc[scan.scanner_people_profile_id].latest = scan.scanned_at;
        }
        return acc;
      }, {});

      return teamMembers.map((member: any) => {
        const profile = Array.isArray(member.people_profiles) ? member.people_profiles[0] : member.people_profiles;
        const customer = Array.isArray(profile?.customers) ? profile.customers[0] : profile?.customers;
        const attributes = customer?.attributes || {};
        const scanStats = scansByMember[member.people_profile_id] || { count: 0, latest: null };

        const firstName = attributes.first_name || '';
        const lastName = attributes.last_name || '';
        const fullName = firstName && lastName
          ? `${firstName} ${lastName}`
          : firstName || customer?.email || 'Unknown';

        return {
          people_profile_id: member.people_profile_id,
          full_name: fullName,
          email: customer?.email || '',
          registration_type: member.registration_type,
          scan_count: scanStats.count,
          latest_scan_at: scanStats.latest,
        };
      });
    } catch (error) {
      console.error('Error in fallback sponsor team stats:', error);
      return [];
    }
  }

  /**
   * Get all contact scans for a sponsor team
   */
  static async getSponsorTeamScans(eventSponsorId: string, filters?: {
    scannerId?: string;
    interestLevel?: string;
    minRating?: number;
  }): Promise<Array<any>> {
    try {
      // Get all team members for this sponsor
      const { data: teamMembers, error: teamError } = await supabase
        .from('events_registrations')
        .select('people_profile_id')
        .eq('sponsor_team_id', eventSponsorId);

      if (teamError) throw teamError;

      if (!teamMembers || teamMembers.length === 0) {
        console.log('No team members found for this sponsor');
        return [];
      }

      const memberProfileIds = teamMembers.map((m: any) => m.people_profile_id);

      // Get all scans by these team members (includes historical scans from before they joined the team)
      let query = supabase
        .from('people_contact_scans')
        .select(`
          *,
          scanner:people_profiles!contact_scans_scanner_profile_id_fkey(
            id,
            qr_code_id,
            customer:customers!member_profiles_customer_id_fkey(
              email,
              attributes
            )
          ),
          scanned:people_profiles!contact_scans_scanned_profile_id_fkey(
            id,
            qr_code_id,
            customer:customers!member_profiles_customer_id_fkey(
              email,
              attributes
            )
          ),
          scanner_registration:events_registrations!contact_scans_scanner_registration_id_fkey(
            id,
            registration_type,
            sponsor_team_id
          )
        `)
        .in('scanner_people_profile_id', memberProfileIds)
        .order('scanned_at', { ascending: false });

      // Apply filters
      if (filters?.scannerId) {
        query = query.eq('scanner_people_profile_id', filters.scannerId);
      }
      if (filters?.interestLevel) {
        query = query.eq('interest_level', filters.interestLevel);
      }
      if (filters?.minRating) {
        query = query.gte('rating', filters.minRating);
      }

      const { data, error } = await query;
      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching sponsor team scans:', error);
      return [];
    }
  }

  /**
   * Export sponsor team scans as CSV
   */
  static async exportSponsorScansCSV(
    eventSponsorId: string,
    filters?: {
      scannerId?: string;
      interestLevel?: string;
      minRating?: number;
    }
  ): Promise<string> {
    try {
      const scans = await this.getSponsorTeamScans(eventSponsorId, filters);

      console.log(`exportSponsorScansCSV: Found ${scans.length} scans for sponsor ${eventSponsorId}`);
      if (scans.length > 0) {
        console.log('Sample scan:', scans[0]);
      }

      // CSV headers
      const headers = [
        'Scan Date',
        'Scanner Name',
        'Scanner Email',
        'Scanned Name',
        'Scanned Email',
        'Scanned Company',
        'Scanned Job Title',
        'Interest Level',
        'Rating',
        'Notes',
        'Tags',
        'Follow Up Required',
        'Location',
      ];

      // Convert scans to CSV rows
      const rows = scans.map((scan: any) => {
        const scannerCustomer = scan.scanner?.customer;
        const scannedCustomer = scan.scanned?.customer;

        return [
          scan.scanned_at ? new Date(scan.scanned_at).toLocaleString() : '',
          scannerCustomer?.attributes?.first_name && scannerCustomer?.attributes?.last_name
            ? `${scannerCustomer.attributes.first_name} ${scannerCustomer.attributes.last_name}`
            : scannerCustomer?.attributes?.first_name || '',
          scannerCustomer?.email || '',
          scannedCustomer?.attributes?.first_name && scannedCustomer?.attributes?.last_name
            ? `${scannedCustomer.attributes.first_name} ${scannedCustomer.attributes.last_name}`
            : scannedCustomer?.attributes?.first_name || '',
          scannedCustomer?.email || '',
          scannedCustomer?.attributes?.company || '',
          scannedCustomer?.attributes?.job_title || '',
          scan.interest_level || '',
          scan.rating || '',
          scan.notes || '',
          scan.tags ? scan.tags.join(', ') : '',
          scan.follow_up_required ? 'Yes' : 'No',
          scan.location || '',
        ];
      });

      // Build CSV string
      const csvContent = [
        headers.join(','),
        ...rows.map((row: any[]) =>
          row.map((cell: any) => {
            // Escape quotes and wrap in quotes if contains comma or quote
            const cellStr = String(cell || '');
            if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
              return `"${cellStr.replace(/"/g, '""')}"`;
            }
            return cellStr;
          }).join(',')
        ),
      ].join('\n');

      return csvContent;
    } catch (error) {
      console.error('Error exporting sponsor scans:', error);
      throw error;
    }
  }

  /**
   * Assign event registrations to a sponsor team
   */
  static async assignRegistrationsToSponsorTeam(
    registrationIds: string[],
    eventSponsorId: string
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('events_registrations')
        .update({
          sponsor_team_id: eventSponsorId,
          registration_type: 'sponsor_staff',
        })
        .in('id', registrationIds);

      if (error) throw error;
    } catch (error) {
      console.error('Error assigning registrations to sponsor team:', error);
      throw error;
    }
  }

  /**
   * Remove registrations from a sponsor team
   */
  static async removeRegistrationsFromSponsorTeam(
    registrationIds: string[]
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('events_registrations')
        .update({
          sponsor_team_id: null,
          registration_type: 'free', // Reset to default
          is_primary_contact: false, // Clear primary contact flag
        })
        .in('id', registrationIds);

      if (error) throw error;
    } catch (error) {
      console.error('Error removing registrations from sponsor team:', error);
      throw error;
    }
  }

  /**
   * Set primary contact for a sponsor team
   */
  static async setPrimaryContact(
    registrationId: string,
    eventSponsorId: string
  ): Promise<void> {
    try {
      console.log('🔧 setPrimaryContact called:', { registrationId, eventSponsorId });

      // First, clear any existing primary contact for this sponsor team
      const { error: clearError } = await supabase
        .from('events_registrations')
        .update({ is_primary_contact: false })
        .eq('sponsor_team_id', eventSponsorId);

      if (clearError) {
        console.error('❌ Error clearing previous primary contacts:', clearError);
        throw clearError;
      }
      console.log('✅ Cleared previous primary contacts for sponsor:', eventSponsorId);

      // Then set the new primary contact
      const { data, error } = await supabase
        .from('events_registrations')
        .update({ is_primary_contact: true })
        .eq('id', registrationId)
        .eq('sponsor_team_id', eventSponsorId) // Ensure they're part of the team
        .select();

      if (error) {
        console.error('❌ Error setting new primary contact:', error);
        throw error;
      }
      console.log('✅ Set new primary contact. Updated rows:', data?.length, data);
    } catch (error) {
      console.error('Error setting primary contact:', error);
      throw error;
    }
  }

  /**
   * Clear primary contact for a sponsor team
   */
  static async clearPrimaryContact(eventSponsorId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('events_registrations')
        .update({ is_primary_contact: false })
        .eq('sponsor_team_id', eventSponsorId);

      if (error) throw error;
    } catch (error) {
      console.error('Error clearing primary contact:', error);
      throw error;
    }
  }

  /**
   * Helper function to batch array into chunks
   */
  private static batchArray<T>(array: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Get attendance with scan counts for each attendee
   */
  static async getAttendanceWithScanCounts(eventId: string, options?: { hasDiscountCodes?: boolean; hasBadgeScanning?: boolean }): Promise<Array<any>> {
    try {
      // Get attendance records
      const attendance = await this.getEventAttendance(eventId, options);

      // Get scan counts for all attendees
      const memberIds = attendance.map((a: any) => a.people_profile_id);

      if (memberIds.length === 0) {
        return [];
      }

      // Batch the member IDs to avoid URL length limits (max ~100 UUIDs per batch)
      const BATCH_SIZE = 100;
      const memberIdBatches = this.batchArray(memberIds, BATCH_SIZE);

      // Fetch scans in batches (table only exists when badge-scanning module is installed)
      let allScans: any[] = [];
      if (options?.hasBadgeScanning !== false) {
        for (const batch of memberIdBatches) {
          const { data: scans, error: scansError } = await supabase
            .from('people_contact_scans')
            .select('scanner_people_profile_id')
            .eq('event_id', eventId)
            .in('scanner_people_profile_id', batch);

          // If the table doesn't exist, skip scan counts entirely
          if (scansError) break;
          if (scans) allScans = allScans.concat(scans);
        }
      }

      // Count scans per member
      const scanCounts = allScans.reduce((acc: any, scan: any) => {
        acc[scan.scanner_people_profile_id] = (acc[scan.scanner_people_profile_id] || 0) + 1;
        return acc;
      }, {});

      // Get registration IDs to fetch sponsor_permission data
      const registrationIds = attendance
        .map((a: any) => a.event_registration_id)
        .filter(Boolean);

      let registrationData: any = {};
      if (registrationIds.length > 0) {
        // Batch registration ID queries as well
        const registrationBatches = this.batchArray(registrationIds, BATCH_SIZE);
        let allRegistrations: any[] = [];

        for (const batch of registrationBatches) {
          const { data: registrations, error: regError } = await supabase
            .from('events_registrations')
            .select('id, sponsor_permission')
            .in('id', batch);

          if (!regError && registrations) {
            allRegistrations = allRegistrations.concat(registrations);
          }
        }

        registrationData = allRegistrations.reduce((acc: any, reg: any) => {
          acc[reg.id] = reg;
          return acc;
        }, {});

        // Debug logging
        console.log('📊 Attendance with registrations debug:', {
          totalAttendance: attendance.length,
          registrationIds: registrationIds.length,
          registrationsWithPermission: allRegistrations.filter((r: any) => r.sponsor_permission === true).length,
          registrationsWithoutPermission: allRegistrations.filter((r: any) => r.sponsor_permission === false).length,
          registrationsWithNull: allRegistrations.filter((r: any) => r.sponsor_permission === null).length,
        });
      }

      // Add scan counts and sponsor permission to attendance records
      return attendance.map((record: any) => {
        const registration = record.event_registration_id ? registrationData[record.event_registration_id] : null;
        // Use the sponsor_permission from the view if available, otherwise from registration lookup
        const sponsorPermission = record.sponsor_permission !== undefined
          ? record.sponsor_permission
          : (registration?.sponsor_permission ?? false);

        return {
          ...record,
          scan_count: scanCounts[record.people_profile_id] || 0,
          sponsor_permission: sponsorPermission,
        };
      });
    } catch (error) {
      console.error('Error fetching attendance with scan counts:', error);
      throw error;
    }
  }

  /**
   * Export scans performed by a specific attendee
   */
  static async exportAttendeeScansCSV(eventId: string, memberProfileId: string): Promise<string> {
    try {
      const { data: scans, error } = await supabase
        .from('people_contact_scans')
        .select(`
          *,
          scanned:people_profiles!contact_scans_scanned_profile_id_fkey(
            id,
            qr_code_id,
            customer:customers!member_profiles_customer_id_fkey(
              email,
              attributes
            )
          )
        `)
        .eq('event_id', eventId)
        .eq('scanner_people_profile_id', memberProfileId)
        .order('scanned_at', { ascending: false });

      // Table may not exist if badge-scanning module isn't installed
      if (error) return '';

      // CSV headers
      const headers = [
        'Scan Date',
        'Scanned Name',
        'Scanned Email',
        'Scanned Company',
        'Scanned Job Title',
        'Interest Level',
        'Rating',
        'Notes',
        'Tags',
        'Follow Up Required',
        'Location',
      ];

      // Convert scans to CSV rows
      const rows = (scans || []).map((scan: any) => {
        const scannedCustomer = scan.scanned?.customer;

        return [
          scan.scanned_at ? new Date(scan.scanned_at).toLocaleString() : '',
          scannedCustomer?.attributes?.first_name && scannedCustomer?.attributes?.last_name
            ? `${scannedCustomer.attributes.first_name} ${scannedCustomer.attributes.last_name}`
            : scannedCustomer?.attributes?.first_name || '',
          scannedCustomer?.email || '',
          scannedCustomer?.attributes?.company || '',
          scannedCustomer?.attributes?.job_title || '',
          scan.interest_level || '',
          scan.rating || '',
          scan.notes || '',
          scan.tags ? scan.tags.join(', ') : '',
          scan.follow_up_required ? 'Yes' : 'No',
          scan.location || '',
        ];
      });

      // Build CSV string
      const csvContent = [
        headers.join(','),
        ...rows.map((row: any[]) =>
          row.map((cell: any) => {
            // Escape quotes and wrap in quotes if contains comma or quote
            const cellStr = String(cell || '');
            if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
              return `"${cellStr.replace(/"/g, '""')}"`;
            }
            return cellStr;
          }).join(',')
        ),
      ].join('\n');

      return csvContent;
    } catch (error) {
      console.error('Error exporting attendee scans CSV:', error);
      throw error;
    }
  }

  /**
   * Export event attendance as CSV
   */
  static async exportAttendanceCSV(eventId: string): Promise<string> {
    try {
      const attendance = await this.getAttendanceWithScanCounts(eventId);

      // CSV headers
      const headers = [
        'Full Name',
        'Email',
        'Company',
        'Check-in Method',
        'Check-in Time',
        'Badge Printed',
        'Badge Printed At',
        'QR Code ID',
        'Scans Performed',
      ];

      // Convert attendance to CSV rows
      const rows = attendance.map((record: any) => [
        record.full_name || '',
        record.email || '',
        record.company || '',
        record.check_in_method || '',
        record.checked_in_at ? new Date(record.checked_in_at).toLocaleString() : '',
        record.badge_printed_on_site ? 'Yes' : 'No',
        record.badge_printed_at ? new Date(record.badge_printed_at).toLocaleString() : '',
        record.qr_code_id || '',
        record.scan_count || 0,
      ]);

      // Build CSV string
      const csvContent = [
        headers.join(','),
        ...rows.map((row: any[]) =>
          row.map((cell: any) => {
            // Escape quotes and wrap in quotes if contains comma or quote
            const cellStr = String(cell || '');
            if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
              return `"${cellStr.replace(/"/g, '""')}"`;
            }
            return cellStr;
          }).join(',')
        ),
      ].join('\n');

      return csvContent;
    } catch (error) {
      console.error('Error exporting attendance CSV:', error);
      throw error;
    }
  }

  /**
   * Update registration fields (registration_type and ticket_type)
   */
  static async updateRegistration(
    registrationId: string,
    updates: {
      registration_type?: string;
      ticket_type?: string;
    }
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('events_registrations')
        .update(updates)
        .eq('id', registrationId);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Error updating registration:', error);
      throw error;
    }
  }

  /**
   * Delete a registration
   */
  static async deleteRegistration(registrationId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('events_registrations')
        .delete()
        .eq('id', registrationId);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Error deleting registration:', error);
      throw error;
    }
  }

  /**
   * Delete an attendance record
   */
  static async deleteAttendance(attendanceId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('events_attendance')
        .delete()
        .eq('id', attendanceId);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Error deleting attendance:', error);
      throw error;
    }
  }

  /**
   * Get badge scan statistics and timeline for an event
   */
  static async getBadgeScanStats(eventId: string, options?: { hasBadgeScanning?: boolean }): Promise<{
    totalScans: number;
    uniqueScanners: number;
    uniqueScanned: number;
    avgScansPerScanner: number;
    topScanners: Array<{
      scanner_people_profile_id: string;
      scanner_name: string;
      scanner_email: string;
      scanner_company: string | null;
      scan_count: number;
    }>;
    timeline: Array<{
      date: string;
      count: number;
      cumulative: number;
    }>;
  }> {
    try {
      // Skip entirely if badge-scanning module is not installed
      if (options?.hasBadgeScanning === false) {
        return { totalScans: 0, uniqueScanners: 0, uniqueScanned: 0, avgScansPerScanner: 0, topScanners: [], timeline: [] };
      }

      // Get all scans for this event (table only exists when badge-scanning module is installed)
      const { data: scans, error } = await supabase
        .from('people_contact_scans')
        .select(`
          *,
          scanner:people_profiles!contact_scans_scanner_profile_id_fkey(
            id,
            qr_code_id,
            customer:customers!member_profiles_customer_id_fkey(
              email,
              attributes
            )
          )
        `)
        .eq('event_id', eventId)
        .order('scanned_at', { ascending: true });

      // Table may not exist if badge-scanning module isn't installed
      if (error) {
        return {
          totalScans: 0,
          uniqueScanners: 0,
          uniqueScanned: 0,
          avgScansPerScanner: 0,
          topScanners: [],
          timeline: [],
        };
      }

      if (!scans || scans.length === 0) {
        return {
          totalScans: 0,
          uniqueScanners: 0,
          uniqueScanned: 0,
          avgScansPerScanner: 0,
          topScanners: [],
          timeline: [],
        };
      }

      // Calculate statistics
      const uniqueScanners = new Set(scans.map(s => s.scanner_people_profile_id)).size;
      const uniqueScanned = new Set(scans.map(s => s.scanned_people_profile_id)).size;
      const avgScansPerScanner = scans.length / uniqueScanners;

      // Get top scanners
      const scannerStats = scans.reduce((acc: any, scan: any) => {
        const scannerId = scan.scanner_people_profile_id;
        if (!acc[scannerId]) {
          const customer = scan.scanner?.customer;
          acc[scannerId] = {
            scanner_people_profile_id: scannerId,
            scanner_name: customer?.attributes?.first_name && customer?.attributes?.last_name
              ? `${customer.attributes.first_name} ${customer.attributes.last_name}`
              : customer?.attributes?.first_name || 'Unknown',
            scanner_email: customer?.email || '',
            scanner_company: customer?.attributes?.company || null,
            scan_count: 0,
          };
        }
        acc[scannerId].scan_count++;
        return acc;
      }, {});

      const topScanners = Object.values(scannerStats)
        .sort((a: any, b: any) => b.scan_count - a.scan_count)
        .slice(0, 10);

      // Create timeline grouped by 1-minute intervals
      const groupedByInterval = scans.reduce((acc: { [key: string]: number }, scan) => {
        if (scan.scanned_at) {
          const timestamp = new Date(scan.scanned_at);
          // Round down to the nearest 1-minute interval
          timestamp.setSeconds(0, 0);
          const intervalKey = timestamp.toISOString();
          acc[intervalKey] = (acc[intervalKey] || 0) + 1;
        }
        return acc;
      }, {});

      const sortedIntervals = Object.keys(groupedByInterval).sort();
      let cumulative = 0;
      const timeline = sortedIntervals.map(interval => {
        cumulative += groupedByInterval[interval];
        return {
          date: interval,
          count: groupedByInterval[interval],
          cumulative,
        };
      });

      return {
        totalScans: scans.length,
        uniqueScanners,
        uniqueScanned,
        avgScansPerScanner: Math.round(avgScansPerScanner * 10) / 10,
        topScanners: topScanners as any,
        timeline,
      };
    } catch (error) {
      console.error('Error getting badge scan stats:', error);
      throw error;
    }
  }

  /**
   * Check in a registrant to an event
   */
  static async checkInRegistrant(params: {
    eventId: string;
    registrationId: string;
    memberProfileId: string;
    checkInMethod?: 'qr_scan' | 'manual_entry' | 'badge_scan' | 'mobile_app' | 'sponsor_booth';
  }): Promise<EventAttendance> {
    try {
      // Check if already checked in
      const { data: existing } = await supabase
        .from('events_attendance')
        .select('*')
        .eq('event_id', params.eventId)
        .eq('people_profile_id', params.memberProfileId)
        .maybeSingle();

      if (existing) {
        throw new Error('Attendee is already checked in');
      }

      // Create attendance record
      const { data, error } = await supabase
        .from('events_attendance')
        .insert({
          event_id: params.eventId,
          people_profile_id: params.memberProfileId,
          event_registration_id: params.registrationId,
          check_in_method: params.checkInMethod || 'manual_entry',
          badge_printed_on_site: false,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error checking in registrant:', error);
      throw error;
    }
  }

  /**
   * Get calendar interactions for an event
   */
  static async getCalendarInteractions(eventId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('calendars_interactions')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching calendar interactions:', error);
      throw error;
    }
  }

  /**
   * Get calendar interaction statistics for an event
   */
  static async getCalendarStats(eventId: string): Promise<{
    totalInteractions: number;
    uniqueUsers: number;
    byType: Record<string, number>;
    byEmail: Array<{ email: string; count: number; types: string[] }>;
  }> {
    try {
      const interactions = await this.getCalendarInteractions(eventId);

      // Calculate statistics
      const uniqueEmails = new Set(interactions.map(i => i.email));
      const byType: Record<string, number> = {};
      const emailMap: Map<string, { count: number; types: Set<string> }> = new Map();

      interactions.forEach(interaction => {
        // Count by type
        const type = interaction.interaction_type || 'unknown';
        byType[type] = (byType[type] || 0) + 1;

        // Track by email
        if (!emailMap.has(interaction.email)) {
          emailMap.set(interaction.email, { count: 0, types: new Set() });
        }
        const emailData = emailMap.get(interaction.email)!;
        emailData.count++;
        emailData.types.add(type);
      });

      // Convert email map to sorted array
      const byEmail = Array.from(emailMap.entries())
        .map(([email, data]) => ({
          email,
          count: data.count,
          types: Array.from(data.types)
        }))
        .sort((a, b) => b.count - a.count);

      return {
        totalInteractions: interactions.length,
        uniqueUsers: uniqueEmails.size,
        byType,
        byEmail
      };
    } catch (error) {
      console.error('Error calculating calendar stats:', error);
      throw error;
    }
  }

  /**
   * Get Luma payment statistics for an event
   */
  static async getLumaPaymentStats(eventId: string): Promise<{
    totalRevenue: number;
    totalTax: number;
    totalDiscount: number;
    netRevenue: number;
    currency: string | null;
    paidRegistrations: number;
    freeRegistrations: number;
    ticketTypes: Array<{
      name: string;
      count: number;
      revenue: number;
    }>;
    couponCodes: Array<{
      code: string;
      count: number;
      totalDiscount: number;
    }>;
    jobTitles: Array<{
      title: string;
      count: number;
      revenue: number;
      avgTicketPrice: number;
    }>;
    byFunction: Array<{
      function: string;
      count: number;
      revenue: number;
      avgTicketPrice: number;
      jobTitles: string[];
    }>;
    bySeniority: Array<{
      seniority: string;
      count: number;
      revenue: number;
      avgTicketPrice: number;
      jobTitles: string[];
    }>;
    paidAttendees: Array<{
      email: string;
      name: string;
      amount: number;
      ticketType: string;
      couponCode: string | null;
      jobTitle: string | null;
      jobFunction: string | null;
      jobSeniority: string | null;
    }>;
  } | null> {
    try {
      // First get the luma_event_id(s) from luma_csv_uploads for this event
      const { data: uploads, error: uploadsError } = await supabase
        .from('integrations_luma_csv_uploads')
        .select('luma_event_id')
        .eq('event_id', eventId)
        .not('luma_event_id', 'is', null);

      if (uploadsError) throw uploadsError;

      if (!uploads || uploads.length === 0) {
        return null; // No Luma data for this event
      }

      // Get unique luma_event_ids
      const lumaEventIds = [...new Set(uploads.map(u => u.luma_event_id))];

      // Get all luma registrations for these events
      const { data: registrations, error: regError } = await supabase
        .from('integrations_luma_event_registrations')
        .select('email, first_name, last_name, amount, amount_tax, amount_discount, currency, coupon_code, luma_ticket_name, luma_approval_status')
        .in('luma_event_id', lumaEventIds)
        .eq('luma_approval_status', 'approved');

      if (regError) throw regError;

      if (!registrations || registrations.length === 0) {
        return null;
      }

      // Filter to paid registrations (amount > 0)
      const paidRegistrations = registrations.filter(r => r.amount && parseFloat(r.amount) > 0);
      const freeRegistrations = registrations.filter(r => !r.amount || parseFloat(r.amount) === 0);

      if (paidRegistrations.length === 0) {
        return null; // No paid registrations
      }

      // Fetch job titles, function, seniority for paid registrations from customers table
      const paidEmails = paidRegistrations.map(r => r.email);
      const { data: customers } = await supabase
        .from('people')
        .select('email, attributes')
        .in('email', paidEmails);

      const customerDataMap = new Map(
        (customers || []).map((c: any) => [c.email, {
          job_title: c.attributes?.job_title || null,
          job_function: c.attributes?.job_function || null,
          job_seniority: c.attributes?.job_seniority || null,
        }])
      );

      // Calculate totals
      let totalRevenue = 0;
      let totalTax = 0;
      let totalDiscount = 0;
      let currency = paidRegistrations[0]?.currency || null;

      const ticketTypeMap: Record<string, { count: number; revenue: number }> = {};
      const couponCodeMap: Record<string, { count: number; totalDiscount: number }> = {};
      const jobTitleMap: Record<string, { count: number; revenue: number }> = {};
      const functionMap: Record<string, { count: number; revenue: number; jobTitles: Set<string> }> = {};
      const seniorityMap: Record<string, { count: number; revenue: number; jobTitles: Set<string> }> = {};

      const paidAttendees = paidRegistrations.map(reg => {
        const amount = parseFloat(reg.amount) || 0;
        const tax = parseFloat(reg.amount_tax) || 0;
        const discount = parseFloat(reg.amount_discount) || 0;
        const customerData = customerDataMap.get(reg.email);
        const jobTitle = customerData?.job_title || null;
        const jobFunction = customerData?.job_function || null;
        const jobSeniority = customerData?.job_seniority || null;

        totalRevenue += amount;
        totalTax += tax;
        totalDiscount += discount;

        // Track ticket types
        const ticketName = reg.luma_ticket_name || 'Unknown';
        if (!ticketTypeMap[ticketName]) {
          ticketTypeMap[ticketName] = { count: 0, revenue: 0 };
        }
        ticketTypeMap[ticketName].count++;
        ticketTypeMap[ticketName].revenue += amount;

        // Track coupon codes
        if (reg.coupon_code) {
          if (!couponCodeMap[reg.coupon_code]) {
            couponCodeMap[reg.coupon_code] = { count: 0, totalDiscount: 0 };
          }
          couponCodeMap[reg.coupon_code].count++;
          couponCodeMap[reg.coupon_code].totalDiscount += discount;
        }

        // Track job titles
        const titleKey = jobTitle || 'Not specified';
        if (!jobTitleMap[titleKey]) {
          jobTitleMap[titleKey] = { count: 0, revenue: 0 };
        }
        jobTitleMap[titleKey].count++;
        jobTitleMap[titleKey].revenue += amount;

        // Track job function
        const functionKey = jobFunction || 'Not classified';
        if (!functionMap[functionKey]) {
          functionMap[functionKey] = { count: 0, revenue: 0, jobTitles: new Set() };
        }
        functionMap[functionKey].count++;
        functionMap[functionKey].revenue += amount;
        if (jobTitle) functionMap[functionKey].jobTitles.add(jobTitle);

        // Track job seniority
        const seniorityKey = jobSeniority || 'Not classified';
        if (!seniorityMap[seniorityKey]) {
          seniorityMap[seniorityKey] = { count: 0, revenue: 0, jobTitles: new Set() };
        }
        seniorityMap[seniorityKey].count++;
        seniorityMap[seniorityKey].revenue += amount;
        if (jobTitle) seniorityMap[seniorityKey].jobTitles.add(jobTitle);

        return {
          email: reg.email,
          name: [reg.first_name, reg.last_name].filter(Boolean).join(' ') || reg.email,
          amount,
          ticketType: ticketName,
          couponCode: reg.coupon_code || null,
          jobTitle,
          jobFunction,
          jobSeniority,
        };
      });

      // Convert maps to sorted arrays
      const ticketTypes = Object.entries(ticketTypeMap)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.revenue - a.revenue);

      const couponCodes = Object.entries(couponCodeMap)
        .map(([code, data]) => ({ code, ...data }))
        .sort((a, b) => b.count - a.count);

      const jobTitles = Object.entries(jobTitleMap)
        .map(([title, data]) => ({
          title,
          ...data,
          avgTicketPrice: data.count > 0 ? data.revenue / data.count : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);

      const byFunction = Object.entries(functionMap)
        .map(([fn, data]) => ({
          function: fn,
          count: data.count,
          revenue: data.revenue,
          avgTicketPrice: data.count > 0 ? data.revenue / data.count : 0,
          jobTitles: Array.from(data.jobTitles).sort(),
        }))
        .sort((a, b) => b.revenue - a.revenue);

      const bySeniority = Object.entries(seniorityMap)
        .map(([seniority, data]) => ({
          seniority,
          count: data.count,
          revenue: data.revenue,
          avgTicketPrice: data.count > 0 ? data.revenue / data.count : 0,
          jobTitles: Array.from(data.jobTitles).sort(),
        }))
        .sort((a, b) => b.revenue - a.revenue);

      return {
        totalRevenue,
        totalTax,
        totalDiscount,
        netRevenue: totalRevenue - totalDiscount,
        currency,
        paidRegistrations: paidRegistrations.length,
        freeRegistrations: freeRegistrations.length,
        ticketTypes,
        couponCodes,
        jobTitles,
        byFunction,
        bySeniority,
        paidAttendees: paidAttendees.sort((a, b) => b.amount - a.amount),
      };
    } catch (error) {
      console.error('Error fetching Luma payment stats:', error);
      throw error;
    }
  }

  /**
   * Get job function and seniority breakdown for event registrations
   */
  static async getRegistrationJobClassifications(eventId: string): Promise<{
    byFunction: Array<{ function: string; count: number; jobTitles: string[] }>;
    bySeniority: Array<{ seniority: string; count: number; jobTitles: string[] }>;
  }> {
    try {
      // Get all registrations with member profile data
      const { data: registrations, error } = await supabase
        .from('events_registrations')
        .select('people_profile_id')
        .eq('event_id', eventId)
        .eq('status', 'confirmed');

      if (error) throw error;
      if (!registrations || registrations.length === 0) {
        return { byFunction: [], bySeniority: [] };
      }

      // Get member profiles with customer data
      const memberProfileIds = registrations.map(r => r.people_profile_id);
      const BATCH_SIZE = 100;
      const batches = this.batchArray(memberProfileIds, BATCH_SIZE);

      let allProfiles: any[] = [];
      for (const batch of batches) {
        const { data: profiles, error: profileError } = await supabase
          .from('people_profiles')
          .select('person_id')
          .in('id', batch);
        if (profileError) throw profileError;
        if (profiles) allProfiles = allProfiles.concat(profiles);
      }

      // Get customer attributes (job_function, job_seniority, job_title)
      const customerIds = allProfiles.map(p => p.person_id).filter(Boolean);
      const customerBatches = this.batchArray(customerIds, BATCH_SIZE);

      let allCustomers: any[] = [];
      for (const batch of customerBatches) {
        const { data: customers, error: custError } = await supabase
          .from('people')
          .select('attributes')
          .in('id', batch);
        if (custError) throw custError;
        if (customers) allCustomers = allCustomers.concat(customers);
      }

      // Aggregate by function and seniority, including job titles
      const functionMap: Record<string, { count: number; jobTitles: Set<string> }> = {};
      const seniorityMap: Record<string, { count: number; jobTitles: Set<string> }> = {};

      allCustomers.forEach(customer => {
        const fn = customer.attributes?.job_function || 'Not classified';
        const seniority = customer.attributes?.job_seniority || 'Not classified';
        const jobTitle = customer.attributes?.job_title || '';

        if (!functionMap[fn]) {
          functionMap[fn] = { count: 0, jobTitles: new Set() };
        }
        functionMap[fn].count++;
        if (jobTitle) functionMap[fn].jobTitles.add(jobTitle);

        if (!seniorityMap[seniority]) {
          seniorityMap[seniority] = { count: 0, jobTitles: new Set() };
        }
        seniorityMap[seniority].count++;
        if (jobTitle) seniorityMap[seniority].jobTitles.add(jobTitle);
      });

      return {
        byFunction: Object.entries(functionMap)
          .map(([function_, data]) => ({
            function: function_,
            count: data.count,
            jobTitles: Array.from(data.jobTitles).sort()
          }))
          .sort((a, b) => b.count - a.count),
        bySeniority: Object.entries(seniorityMap)
          .map(([seniority, data]) => ({
            seniority,
            count: data.count,
            jobTitles: Array.from(data.jobTitles).sort()
          }))
          .sort((a, b) => b.count - a.count),
      };
    } catch (error) {
      console.error('Error getting registration job classifications:', error);
      throw error;
    }
  }

  /**
   * Get job function and seniority breakdown for event attendees
   */
  static async getAttendanceJobClassifications(eventId: string): Promise<{
    byFunction: Array<{ function: string; count: number; jobTitles: string[] }>;
    bySeniority: Array<{ seniority: string; count: number; jobTitles: string[] }>;
  }> {
    try {
      // Get all attendance records
      const { data: attendance, error } = await supabase
        .from('events_attendance')
        .select('people_profile_id')
        .eq('event_id', eventId);

      if (error) throw error;
      if (!attendance || attendance.length === 0) {
        return { byFunction: [], bySeniority: [] };
      }

      // Get member profiles with customer data
      const memberProfileIds = attendance.map(a => a.people_profile_id);
      const BATCH_SIZE = 100;
      const batches = this.batchArray(memberProfileIds, BATCH_SIZE);

      let allProfiles: any[] = [];
      for (const batch of batches) {
        const { data: profiles, error: profileError } = await supabase
          .from('people_profiles')
          .select('person_id')
          .in('id', batch);
        if (profileError) throw profileError;
        if (profiles) allProfiles = allProfiles.concat(profiles);
      }

      // Get customer attributes (job_function, job_seniority, job_title)
      const customerIds = allProfiles.map(p => p.person_id).filter(Boolean);
      const customerBatches = this.batchArray(customerIds, BATCH_SIZE);

      let allCustomers: any[] = [];
      for (const batch of customerBatches) {
        const { data: customers, error: custError } = await supabase
          .from('people')
          .select('attributes')
          .in('id', batch);
        if (custError) throw custError;
        if (customers) allCustomers = allCustomers.concat(customers);
      }

      // Aggregate by function and seniority, including job titles
      const functionMap: Record<string, { count: number; jobTitles: Set<string> }> = {};
      const seniorityMap: Record<string, { count: number; jobTitles: Set<string> }> = {};

      allCustomers.forEach(customer => {
        const fn = customer.attributes?.job_function || 'Not classified';
        const seniority = customer.attributes?.job_seniority || 'Not classified';
        const jobTitle = customer.attributes?.job_title || '';

        if (!functionMap[fn]) {
          functionMap[fn] = { count: 0, jobTitles: new Set() };
        }
        functionMap[fn].count++;
        if (jobTitle) functionMap[fn].jobTitles.add(jobTitle);

        if (!seniorityMap[seniority]) {
          seniorityMap[seniority] = { count: 0, jobTitles: new Set() };
        }
        seniorityMap[seniority].count++;
        if (jobTitle) seniorityMap[seniority].jobTitles.add(jobTitle);
      });

      return {
        byFunction: Object.entries(functionMap)
          .map(([function_, data]) => ({
            function: function_,
            count: data.count,
            jobTitles: Array.from(data.jobTitles).sort()
          }))
          .sort((a, b) => b.count - a.count),
        bySeniority: Object.entries(seniorityMap)
          .map(([seniority, data]) => ({
            seniority,
            count: data.count,
            jobTitles: Array.from(data.jobTitles).sort()
          }))
          .sort((a, b) => b.count - a.count),
      };
    } catch (error) {
      console.error('Error getting attendance job classifications:', error);
      throw error;
    }
  }

  /**
   * Get calendar interactions with registration and attendance data
   */
  static async getCalendarInteractionsWithAttendance(eventId: string): Promise<any[]> {
    try {
      // Get calendar interactions
      const interactions = await this.getCalendarInteractions(eventId);

      if (interactions.length === 0) return [];

      // Get unique emails
      const uniqueEmails = [...new Set(interactions.map(i => i.email))];

      // Batch size to avoid URL length limits
      const BATCH_SIZE = 100;

      // Get customers by email (batched)
      const emailBatches = this.batchArray(uniqueEmails, BATCH_SIZE);
      let allCustomers: any[] = [];
      for (const batch of emailBatches) {
        const { data: customers, error: customerError } = await supabase
          .from('people')
          .select('id, email')
          .in('email', batch);
        if (customerError) throw customerError;
        if (customers) allCustomers = allCustomers.concat(customers);
      }

      const customerMap = new Map(allCustomers.map(c => [c.email, c.id]));

      // Get member profiles for these customers (batched)
      const customerIds = Array.from(customerMap.values());
      const customerIdBatches = this.batchArray(customerIds, BATCH_SIZE);
      let allMemberProfiles: any[] = [];
      for (const batch of customerIdBatches) {
        const { data: memberProfiles, error: profileError } = await supabase
          .from('people_profiles')
          .select('id, person_id')
          .in('person_id', batch);
        if (profileError) throw profileError;
        if (memberProfiles) allMemberProfiles = allMemberProfiles.concat(memberProfiles);
      }

      const profileMap = new Map(allMemberProfiles.map(p => [p.person_id, p.id]));

      // Get registrations and attendance in parallel (both batched)
      const memberProfileIds = Array.from(profileMap.values());
      const memberIdBatches = this.batchArray(memberProfileIds, BATCH_SIZE);

      // Fetch registrations and attendance in parallel batches
      const [allRegistrations, allAttendance] = await Promise.all([
        // Registrations
        (async () => {
          let results: any[] = [];
          for (const batch of memberIdBatches) {
            const { data, error } = await supabase
              .from('events_registrations')
              .select('people_profile_id, status, registered_at')
              .eq('event_id', eventId)
              .in('people_profile_id', batch);
            if (error) throw error;
            if (data) results = results.concat(data);
          }
          return results;
        })(),
        // Attendance
        (async () => {
          let results: any[] = [];
          for (const batch of memberIdBatches) {
            const { data, error } = await supabase
              .from('events_attendance')
              .select('people_profile_id, checked_in_at')
              .eq('event_id', eventId)
              .in('people_profile_id', batch);
            if (error) throw error;
            if (data) results = results.concat(data);
          }
          return results;
        })(),
      ]);

      const registrationMap = new Map(allRegistrations.map(r => [r.people_profile_id, r]));
      const attendanceMap = new Map(allAttendance.map(a => [a.people_profile_id, a]));

      // Combine all data
      const emailDataMap = new Map();

      interactions.forEach(interaction => {
        const email = interaction.email;
        if (!emailDataMap.has(email)) {
          const customerId = customerMap.get(email);
          const memberProfileId = customerId ? profileMap.get(customerId) : undefined;
          const registration = memberProfileId ? registrationMap.get(memberProfileId) : undefined;
          const attendanceRecord = memberProfileId ? attendanceMap.get(memberProfileId) : undefined;

          emailDataMap.set(email, {
            email,
            interactions: [],
            hasRegistration: !!registration,
            registrationStatus: registration?.status,
            hasAttended: !!attendanceRecord,
            checkedInAt: attendanceRecord?.checked_in_at
          });
        }

        emailDataMap.get(email).interactions.push({
          type: interaction.interaction_type,
          createdAt: interaction.created_at
        });
      });

      return Array.from(emailDataMap.values());
    } catch (error) {
      console.error('Error fetching calendar interactions with attendance:', error);
      throw error;
    }
  }
}
