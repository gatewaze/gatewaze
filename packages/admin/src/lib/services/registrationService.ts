/**
 * Event Registration Service
 * Handles event registrations, check-ins, and attendance tracking
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { MemberService } from './memberService';

export interface RegisterAttendee {
  eventId: string;
  memberProfileId: string;
  registrationType: 'free' | 'paid' | 'comp' | 'sponsor' | 'speaker' | 'staff' | 'vip';
  ticketType?: string;
  registrationSource: string;
  paymentStatus?: 'pending' | 'paid' | 'refunded' | 'comp';
  amountPaid?: number;
  currency?: string;
  discountCodeId?: string;
  registrationMetadata?: any;
}

export interface CheckInAttendee {
  eventId: string;
  memberProfileId: string;
  checkInMethod?: 'qr_scan' | 'manual_entry' | 'badge_scan' | 'mobile_app';
  checkInLocation?: string;
  checkedInBy?: string;
}

export class RegistrationService {
  private memberService: MemberService;

  constructor(private supabase: SupabaseClient) {
    this.memberService = new MemberService(supabase);
  }

  /**
   * Register a member for an event
   */
  async registerForEvent(data: RegisterAttendee) {
    const { data: registration, error } = await this.supabase
      .from('event_registrations')
      .insert({
        event_id: data.eventId,
        member_profile_id: data.memberProfileId,
        registration_type: data.registrationType,
        ticket_type: data.ticketType,
        registration_source: data.registrationSource,
        payment_status: data.paymentStatus || 'comp',
        amount_paid: data.amountPaid,
        currency: data.currency || 'USD',
        discount_code_id: data.discountCodeId,
        registration_metadata: data.registrationMetadata || {},
        status: 'confirmed',
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Unique violation - already registered
        throw new Error('Member is already registered for this event');
      }
      throw error;
    }

    // Update discount code if applicable
    if (data.discountCodeId) {
      await this.supabase
        .from('discount_codes')
        .update({
          member_profile_id: data.memberProfileId,
          event_registration_id: registration.id,
        })
        .eq('id', data.discountCodeId);
    }

    return registration;
  }

  /**
   * Bulk register attendees from CSV/array
   */
  async bulkRegisterAttendees(eventId: string, attendees: Array<{
    email: string;
    fullName: string;
    company?: string;
    jobTitle?: string;
    registrationType?: string;
    ticketType?: string;
  }>) {
    const results = {
      successful: 0,
      failed: 0,
      errors: [] as any[],
    };

    for (const attendee of attendees) {
      try {
        // Get or create member profile
        let member = await this.memberService.getMemberByEmail(attendee.email);

        if (!member) {
          member = await this.memberService.createMemberProfile({
            email: attendee.email,
            fullName: attendee.fullName,
            company: attendee.company,
            jobTitle: attendee.jobTitle,
          });
        }

        // Register for event
        await this.registerForEvent({
          eventId,
          memberProfileId: member.id,
          registrationType: (attendee.registrationType as any) || 'free',
          ticketType: attendee.ticketType,
          registrationSource: 'admin_upload',
        });

        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          email: attendee.email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Get event registrations with filters
   */
  async getEventRegistrations(eventId: string, filters?: {
    status?: string;
    registrationType?: string;
    badgePrintStatus?: string;
    limit?: number;
    offset?: number;
  }) {
    let query = this.supabase
      .from('event_registrations_with_members')
      .select('*', { count: 'exact' })
      .eq('event_id', eventId);

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.registrationType) {
      query = query.eq('registration_type', filters.registrationType);
    }

    if (filters?.badgePrintStatus) {
      query = query.eq('badge_print_status', filters.badgePrintStatus);
    }

    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    if (filters?.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 100) - 1);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    return { data, count };
  }

  /**
   * Check in attendee at event
   */
  async checkInAttendee(data: CheckInAttendee) {
    // Get registration
    const { data: registration, error: regError } = await this.supabase
      .from('event_registrations')
      .select('*')
      .eq('event_id', data.eventId)
      .eq('member_profile_id', data.memberProfileId)
      .eq('status', 'confirmed')
      .single();

    if (regError || !registration) {
      throw new Error('No confirmed registration found for this member');
    }

    // Check if already checked in
    const { data: existing } = await this.supabase
      .from('event_attendance')
      .select('id')
      .eq('event_id', data.eventId)
      .eq('member_profile_id', data.memberProfileId)
      .single();

    if (existing) {
      return { alreadyCheckedIn: true, attendance: existing };
    }

    // Create attendance record
    const { data: attendance, error } = await this.supabase
      .from('event_attendance')
      .insert({
        event_id: data.eventId,
        member_profile_id: data.memberProfileId,
        event_registration_id: registration.id,
        check_in_method: data.checkInMethod || 'manual_entry',
        check_in_location: data.checkInLocation,
        checked_in_by: data.checkedInBy,
      })
      .select()
      .single();

    if (error) throw error;

    // Update discount code if applicable
    if (registration.discount_code_id) {
      await this.supabase
        .from('discount_codes')
        .update({
          registered: true,
          attended: true,
          registered_at: registration.registered_at,
          attended_at: new Date().toISOString(),
        })
        .eq('id', registration.discount_code_id);
    }

    return { alreadyCheckedIn: false, attendance };
  }

  /**
   * Get event attendance with filters
   */
  async getEventAttendance(eventId: string, filters?: {
    limit?: number;
    offset?: number;
    checkedInAfter?: string;
  }) {
    let query = this.supabase
      .from('event_attendance_with_details')
      .select('*', { count: 'exact' })
      .eq('event_id', eventId);

    if (filters?.checkedInAfter) {
      query = query.gte('checked_in_at', filters.checkedInAfter);
    }

    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    if (filters?.offset) {
      query = query.range(filters?.offset, filters.offset + (filters.limit || 100) - 1);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    return { data, count };
  }

  /**
   * Get registration statistics for an event
   */
  async getRegistrationStats(eventId: string) {
    const { data, error } = await this.supabase
      .rpc('get_event_registration_stats', {
        p_event_id: eventId,
      });

    if (error) throw error;
    return data;
  }

  /**
   * Get attendance statistics for an event
   */
  async getAttendanceStats(eventId: string) {
    const { data, error } = await this.supabase
      .rpc('get_event_attendance_stats', {
        p_event_id: eventId,
      });

    if (error) throw error;
    return data;
  }

  /**
   * Cancel registration
   */
  async cancelRegistration(registrationId: string) {
    const { data, error } = await this.supabase
      .from('event_registrations')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', registrationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get member's registrations
   */
  async getMemberRegistrations(memberProfileId: string, filters?: {
    upcoming?: boolean;
    past?: boolean;
  }) {
    let query = this.supabase
      .from('event_registrations_with_members')
      .select('*')
      .eq('member_profile_id', memberProfileId)
      .eq('status', 'confirmed');

    if (filters?.upcoming) {
      query = query.gte('event_start', new Date().toISOString());
    }

    if (filters?.past) {
      query = query.lt('event_end', new Date().toISOString());
    }

    const { data, error } = await query.order('event_start', { ascending: true });

    if (error) throw error;
    return data;
  }
}
