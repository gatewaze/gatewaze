/**
 * Calendar Membership Service
 * Handles calendar member operations including CRUD, bulk operations, and status management
 */

import { supabase } from '@/lib/supabase';

// ============================================================================
// Types
// ============================================================================

export interface CalendarMember {
  id: string;
  calendarId: string;
  customerId?: number;
  email?: string;
  memberProfileId?: string;
  membershipType: 'subscriber' | 'member' | 'vip' | 'organizer' | 'admin';
  membershipStatus: 'active' | 'pending' | 'inactive' | 'blocked';
  emailNotifications: boolean;
  pushNotifications: boolean;
  importSource?: string;
  sourceType?: 'direct' | 'registration' | 'interest' | 'attendance';
  lumaUserId?: string;
  lumaRevenue?: string;
  lumaEventApprovedCount: number;
  lumaEventCheckedInCount: number;
  lumaMembershipName?: string;
  lumaMembershipStatus?: string;
  lumaTags?: string[];
  importMetadata: Record<string, any>;
  firstSeenAt?: string;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
  eventCount?: number;
  // Joined fields
  customer?: {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  };
  memberProfile?: {
    fullName?: string;
    company?: string;
    jobTitle?: string;
    avatarUrl?: string;
  };
}

export interface CreateCalendarMemberInput {
  calendarId: string;
  customerId?: number;
  email?: string;
  memberProfileId?: string;
  membershipType?: 'subscriber' | 'member' | 'vip' | 'organizer' | 'admin';
  membershipStatus?: 'active' | 'pending' | 'inactive' | 'blocked';
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  importSource?: string;
  importMetadata?: Record<string, any>;
}

export interface UpdateCalendarMemberInput {
  membershipType?: 'subscriber' | 'member' | 'vip' | 'organizer' | 'admin';
  membershipStatus?: 'active' | 'pending' | 'inactive' | 'blocked';
  emailNotifications?: boolean;
  pushNotifications?: boolean;
}

export interface BulkAddMembersInput {
  calendarId: string;
  members: Array<{
    email?: string;
    customerId?: number;
    membershipType?: 'subscriber' | 'member' | 'vip' | 'organizer' | 'admin';
  }>;
  importSource?: string;
}

export interface CalendarMembershipServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// Field Mapping Helpers
// ============================================================================

function mapDbToCalendarMember(data: any): CalendarMember {
  return {
    id: data.id,
    calendarId: data.calendar_id,
    customerId: data.customer_id,
    email: data.email,
    memberProfileId: data.member_profile_id,
    membershipType: data.membership_type,
    membershipStatus: data.membership_status,
    emailNotifications: data.email_notifications ?? true,
    pushNotifications: data.push_notifications ?? false,
    importSource: data.import_source || data.source,
    sourceType: data.source_type,
    lumaUserId: data.luma_user_id,
    lumaRevenue: data.luma_revenue,
    lumaEventApprovedCount: data.luma_event_approved_count || 0,
    lumaEventCheckedInCount: data.luma_event_checked_in_count || 0,
    lumaMembershipName: data.luma_membership_name,
    lumaMembershipStatus: data.luma_membership_status,
    lumaTags: data.luma_tags,
    importMetadata: data.import_metadata || {},
    firstSeenAt: data.first_seen_at,
    joinedAt: data.joined_at,
    createdAt: data.created_at || data.joined_at,
    updatedAt: data.updated_at || data.joined_at,
    eventCount: data.event_count,
    customer: data.customers ? {
      email: data.customers.email,
      // first_name, last_name, phone are stored in attributes JSONB
      firstName: data.customers.attributes?.first_name,
      lastName: data.customers.attributes?.last_name,
      phone: data.customers.attributes?.phone,
    } : (data.first_name || data.last_name ? {
      email: data.email,
      firstName: data.first_name,
      lastName: data.last_name,
    } : undefined),
    // Profile data comes from customers.attributes, not member_profiles table
    memberProfile: data.customers?.attributes ? {
      fullName: data.customers.attributes.name ||
        [data.customers.attributes.first_name, data.customers.attributes.last_name].filter(Boolean).join(' ') || undefined,
      company: data.customers.attributes.company,
      jobTitle: data.customers.attributes.job_title,
      avatarUrl: data.customers.attributes.avatar_url,
    } : (data.first_name || data.last_name || data.company ? {
      fullName: [data.first_name, data.last_name].filter(Boolean).join(' ') || undefined,
      company: data.company,
      jobTitle: data.job_title,
      avatarUrl: data.avatar_url,
    } : undefined),
  };
}

function mapMemberToDb(member: CreateCalendarMemberInput | UpdateCalendarMemberInput): Record<string, any> {
  const dbFields: Record<string, any> = {};

  if ('calendarId' in member && member.calendarId !== undefined) dbFields.calendar_id = member.calendarId;
  if ('customerId' in member) dbFields.customer_id = member.customerId;
  if ('email' in member) dbFields.email = member.email;
  if ('memberProfileId' in member) dbFields.member_profile_id = member.memberProfileId;
  if ('membershipType' in member) dbFields.membership_type = member.membershipType;
  if ('membershipStatus' in member) dbFields.membership_status = member.membershipStatus;
  if ('emailNotifications' in member) dbFields.email_notifications = member.emailNotifications;
  if ('pushNotifications' in member) dbFields.push_notifications = member.pushNotifications;
  if ('importSource' in member) dbFields.import_source = member.importSource;
  if ('importMetadata' in member) dbFields.import_metadata = member.importMetadata;

  return dbFields;
}

// ============================================================================
// CalendarMembershipService
// ============================================================================

export class CalendarMembershipService {
  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Helper to resolve calendar_id (CAL-XXX) to UUID
   */
  private static async resolveCalendarId(calendarId: string): Promise<{ uuid: string | null; error?: string }> {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(calendarId);
    if (isUUID) {
      return { uuid: calendarId };
    }

    const { data: calendar, error } = await supabase
      .from('calendars')
      .select('id')
      .eq('calendar_id', calendarId)
      .single();

    if (error || !calendar) {
      return { uuid: null, error: 'Calendar not found' };
    }
    return { uuid: calendar.id };
  }

  // ==========================================================================
  // Member CRUD
  // ==========================================================================

  /**
   * Get a calendar member by ID
   */
  static async getMemberById(id: string): Promise<CalendarMembershipServiceResponse<CalendarMember>> {
    try {
      const { data, error } = await supabase
        .from('calendar_members')
        .select(`
          *,
          customers (email, attributes)
        `)
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching calendar member:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapDbToCalendarMember(data) };
    } catch (error) {
      console.error('Error in getMemberById:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get all members for a calendar with pagination and filtering
   * Uses dynamic query that combines direct members + event registrations
   */
  static async getCalendarMembers(
    calendarId: string,
    options?: {
      membershipType?: 'subscriber' | 'member' | 'vip' | 'organizer' | 'admin';
      membershipStatus?: 'active' | 'pending' | 'inactive' | 'blocked';
      search?: string;
      importSource?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<CalendarMembershipServiceResponse<{ members: CalendarMember[]; total: number }>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      // Use the dynamic RPC function that combines direct members + registrations
      const { data, error } = await supabase.rpc('get_calendar_members_dynamic', {
        p_calendar_id: uuid,
        p_membership_type: options?.membershipType || null,
        p_search: options?.search || null,
        p_limit: options?.limit || 100,
        p_offset: options?.offset || 0,
      });

      if (error) {
        console.error('Error fetching calendar members:', error);
        return { success: false, error: error.message };
      }

      // Get total count
      const { data: countData, error: countError } = await supabase.rpc(
        'get_calendar_members_count',
        { p_calendar_id: uuid }
      );

      if (countError) {
        console.error('Error fetching member count:', countError);
      }

      const members = (data || []).map(mapDbToCalendarMember);
      return { success: true, data: { members, total: countData || members.length } };
    } catch (error) {
      console.error('Error in getCalendarMembers:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Add a member to a calendar
   */
  static async addMember(input: CreateCalendarMemberInput): Promise<CalendarMembershipServiceResponse<CalendarMember>> {
    try {
      // Validate that at least one identity is provided
      if (!input.customerId && !input.email) {
        return { success: false, error: 'Either customerId or email must be provided' };
      }

      const dbData = mapMemberToDb(input);

      const { data, error } = await supabase
        .from('calendar_members')
        .insert(dbData)
        .select(`
          *,
          customers (email, attributes)
        `)
        .single();

      if (error) {
        // Check for unique constraint violation
        if (error.code === '23505') {
          return { success: false, error: 'Member already exists in this calendar' };
        }
        console.error('Error adding calendar member:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapDbToCalendarMember(data) };
    } catch (error) {
      console.error('Error in addMember:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Update a calendar member
   */
  static async updateMember(
    id: string,
    input: UpdateCalendarMemberInput
  ): Promise<CalendarMembershipServiceResponse<CalendarMember>> {
    try {
      const dbData = mapMemberToDb(input);

      const { data, error } = await supabase
        .from('calendar_members')
        .update(dbData)
        .eq('id', id)
        .select(`
          *,
          customers (email, attributes)
        `)
        .single();

      if (error) {
        console.error('Error updating calendar member:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapDbToCalendarMember(data) };
    } catch (error) {
      console.error('Error in updateMember:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Remove a member from a calendar
   */
  static async removeMember(id: string): Promise<CalendarMembershipServiceResponse<void>> {
    try {
      const { error } = await supabase
        .from('calendar_members')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error removing calendar member:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Error in removeMember:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  /**
   * Add multiple members to a calendar
   */
  static async bulkAddMembers(
    input: BulkAddMembersInput
  ): Promise<CalendarMembershipServiceResponse<{ added: number; skipped: number; errors: string[] }>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(input.calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const results = {
        added: 0,
        skipped: 0,
        errors: [] as string[],
      };

      for (const member of input.members) {
        if (!member.email && !member.customerId) {
          results.skipped++;
          results.errors.push('Member missing both email and customerId');
          continue;
        }

        const dbData = {
          calendar_id: uuid,
          email: member.email,
          customer_id: member.customerId,
          membership_type: member.membershipType || 'subscriber',
          import_source: input.importSource || 'manual',
        };

        const { error } = await supabase
          .from('calendar_members')
          .upsert(dbData, {
            onConflict: member.customerId
              ? 'calendar_id,customer_id'
              : 'calendar_id,email',
            ignoreDuplicates: true,
          });

        if (error) {
          results.skipped++;
          results.errors.push(`Failed to add ${member.email || member.customerId}: ${error.message}`);
        } else {
          results.added++;
        }
      }

      return { success: true, data: results };
    } catch (error) {
      console.error('Error in bulkAddMembers:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Remove multiple members from a calendar
   */
  static async bulkRemoveMembers(
    calendarId: string,
    memberIds: string[]
  ): Promise<CalendarMembershipServiceResponse<{ removed: number }>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const { data, error } = await supabase
        .from('calendar_members')
        .delete()
        .eq('calendar_id', uuid)
        .in('id', memberIds)
        .select();

      if (error) {
        console.error('Error in bulk remove members:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: { removed: data?.length || 0 } };
    } catch (error) {
      console.error('Error in bulkRemoveMembers:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Update status for multiple members
   */
  static async bulkUpdateStatus(
    calendarId: string,
    memberIds: string[],
    status: 'active' | 'pending' | 'inactive' | 'blocked'
  ): Promise<CalendarMembershipServiceResponse<{ updated: number }>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const { data, error } = await supabase
        .from('calendar_members')
        .update({ membership_status: status })
        .eq('calendar_id', uuid)
        .in('id', memberIds)
        .select();

      if (error) {
        console.error('Error in bulk update status:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: { updated: data?.length || 0 } };
    } catch (error) {
      console.error('Error in bulkUpdateStatus:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Update membership type for multiple members
   */
  static async bulkUpdateMembershipType(
    calendarId: string,
    memberIds: string[],
    membershipType: 'subscriber' | 'member' | 'vip' | 'organizer' | 'admin'
  ): Promise<CalendarMembershipServiceResponse<{ updated: number }>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const { data, error } = await supabase
        .from('calendar_members')
        .update({ membership_type: membershipType })
        .eq('calendar_id', uuid)
        .in('id', memberIds)
        .select();

      if (error) {
        console.error('Error in bulk update membership type:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: { updated: data?.length || 0 } };
    } catch (error) {
      console.error('Error in bulkUpdateMembershipType:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  // ==========================================================================
  // Search and Lookup
  // ==========================================================================

  /**
   * Check if a customer/email is a member of a calendar
   */
  static async isMember(
    calendarId: string,
    identifier: { customerId?: number; email?: string }
  ): Promise<CalendarMembershipServiceResponse<{ isMember: boolean; member?: CalendarMember }>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      let query = supabase
        .from('calendar_members')
        .select(`
          *,
          customers (email, attributes)
        `)
        .eq('calendar_id', uuid);

      if (identifier.customerId) {
        query = query.eq('customer_id', identifier.customerId);
      } else if (identifier.email) {
        query = query.eq('email', identifier.email);
      } else {
        return { success: false, error: 'Either customerId or email must be provided' };
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        console.error('Error checking membership:', error);
        return { success: false, error: error.message };
      }

      if (!data) {
        return { success: true, data: { isMember: false } };
      }

      return {
        success: true,
        data: {
          isMember: true,
          member: mapDbToCalendarMember(data),
        },
      };
    } catch (error) {
      console.error('Error in isMember:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get all calendars a customer/email is a member of
   */
  static async getCustomerCalendars(
    identifier: { customerId?: number; email?: string }
  ): Promise<CalendarMembershipServiceResponse<CalendarMember[]>> {
    try {
      let query = supabase
        .from('calendar_members')
        .select(`
          *,
          calendars (id, calendar_id, name, description, logo_url, color)
        `);

      if (identifier.customerId) {
        query = query.eq('customer_id', identifier.customerId);
      } else if (identifier.email) {
        query = query.eq('email', identifier.email);
      } else {
        return { success: false, error: 'Either customerId or email must be provided' };
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching customer calendars:', error);
        return { success: false, error: error.message };
      }

      const members = (data || []).map(mapDbToCalendarMember);
      return { success: true, data: members };
    } catch (error) {
      console.error('Error in getCustomerCalendars:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get membership statistics for a calendar
   */
  static async getMemberStats(
    calendarId: string
  ): Promise<CalendarMembershipServiceResponse<{
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    bySource: Record<string, number>;
  }>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const { data, error } = await supabase
        .from('calendar_members')
        .select('membership_type, membership_status, import_source')
        .eq('calendar_id', uuid);

      if (error) {
        console.error('Error fetching member stats:', error);
        return { success: false, error: error.message };
      }

      const stats = {
        total: data?.length || 0,
        byType: {} as Record<string, number>,
        byStatus: {} as Record<string, number>,
        bySource: {} as Record<string, number>,
      };

      for (const member of data || []) {
        // Count by type
        const type = member.membership_type || 'unknown';
        stats.byType[type] = (stats.byType[type] || 0) + 1;

        // Count by status
        const status = member.membership_status || 'unknown';
        stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

        // Count by source
        const source = member.import_source || 'unknown';
        stats.bySource[source] = (stats.bySource[source] || 0) + 1;
      }

      return { success: true, data: stats };
    } catch (error) {
      console.error('Error in getMemberStats:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  // ==========================================================================
  // Export
  // ==========================================================================

  /**
   * Export calendar members as CSV-ready data
   * Uses dynamic query to include both direct members + registrations
   */
  static async exportMembers(
    calendarId: string,
    options?: {
      membershipType?: 'subscriber' | 'member' | 'vip' | 'organizer' | 'admin';
      membershipStatus?: 'active' | 'pending' | 'inactive' | 'blocked';
    }
  ): Promise<CalendarMembershipServiceResponse<any[]>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      // Use the dynamic RPC function for consistent export
      const { data, error } = await supabase.rpc('get_calendar_members_dynamic', {
        p_calendar_id: uuid,
        p_membership_type: options?.membershipType || null,
        p_search: null,
        p_limit: 10000, // Large limit for export
        p_offset: 0,
      });

      if (error) {
        console.error('Error exporting members:', error);
        return { success: false, error: error.message };
      }

      // Map to export format
      const exportData = (data || []).map((member: any) => ({
        email: member.email || '',
        first_name: member.first_name || '',
        last_name: member.last_name || '',
        full_name: [member.first_name, member.last_name].filter(Boolean).join(' ') || '',
        company: member.company || '',
        job_title: member.job_title || '',
        membership_type: member.membership_type,
        membership_status: member.membership_status,
        source: member.source,
        source_type: member.source_type,
        joined_at: member.joined_at,
        event_count: member.event_count || 0,
        luma_user_id: member.luma_user_id || '',
      }));

      return { success: true, data: exportData };
    } catch (error) {
      console.error('Error in exportMembers:', error);
      return { success: false, error: (error as Error).message };
    }
  }

}

export default CalendarMembershipService;
