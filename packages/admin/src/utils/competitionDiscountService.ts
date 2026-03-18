// @ts-nocheck
import { supabase } from '@/lib/supabase';

// ─── Interfaces ────────────────────────────────────────────────────────────────

export type CompetitionStatus = 'active' | 'closed' | 'cancelled';
export type DiscountStatus = 'active' | 'closed' | 'cancelled';
export type CompetitionEntryStatus = 'viewed' | 'entered' | 'won';
export type DiscountClaimStatus = 'viewed' | 'accepted' | 'code-issued' | 'deposit-initiated' | 'deposit-paid' | 'sold-out';

export interface EventCompetition {
  id: string;
  eventId: string;
  title: string;
  slug: string;
  value: string;
  closeDate: string | null;
  closeDisplay: string | null;
  result: string | null;
  intro: string | null;
  content: string | null;
  isBeta: boolean;
  status: CompetitionStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventDiscount {
  id: string;
  eventId: string;
  title: string;
  slug: string;
  value: string;
  ticketDetails: string | null;
  closeDate: string | null;
  closeDisplay: string | null;
  intro: string | null;
  content: string | null;
  isBeta: boolean;
  status: DiscountStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitionEntry {
  id: string;
  competitionId: string;
  email: string;
  memberProfileId: string | null;
  status: CompetitionEntryStatus;
  referrer: string | null;
  viewedAt: string | null;
  enteredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscountClaim {
  id: string;
  discountId: string;
  email: string;
  memberProfileId: string | null;
  status: DiscountClaimStatus;
  referrer: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  codeIssuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventCompetitionWithEvent extends EventCompetition {
  eventTitle: string;
  eventCity?: string;
  eventCountryCode?: string;
  eventStart?: string;
}

export interface EventDiscountWithEvent extends EventDiscount {
  eventTitle: string;
  eventCity?: string;
  eventCountryCode?: string;
  eventStart?: string;
}

export interface CompetitionDiscountServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Input types for create/update ─────────────────────────────────────────────

export type CreateCompetitionData = Omit<EventCompetition, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateCompetitionData = Partial<Omit<EventCompetition, 'id' | 'createdAt' | 'updatedAt'>>;
export type CreateDiscountData = Omit<EventDiscount, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateDiscountData = Partial<Omit<EventDiscount, 'id' | 'createdAt' | 'updatedAt'>>;

// ─── Mapping helpers ───────────────────────────────────────────────────────────

function mapCompetitionFromDb(row: any): EventCompetition {
  return {
    id: row.id,
    eventId: row.event_id,
    title: row.title,
    slug: row.slug,
    value: row.value,
    closeDate: row.close_date,
    closeDisplay: row.close_display,
    result: row.result,
    intro: row.intro,
    content: row.content,
    isBeta: row.is_beta ?? false,
    status: row.status,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDiscountFromDb(row: any): EventDiscount {
  return {
    id: row.id,
    eventId: row.event_id,
    title: row.title,
    slug: row.slug,
    value: row.value,
    ticketDetails: row.ticket_details,
    closeDate: row.close_date,
    closeDisplay: row.close_display,
    intro: row.intro,
    content: row.content,
    isBeta: row.is_beta ?? false,
    status: row.status,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEntryFromDb(row: any): CompetitionEntry {
  return {
    id: row.id,
    competitionId: row.competition_id,
    email: row.email,
    memberProfileId: row.member_profile_id,
    status: row.status,
    referrer: row.referrer,
    viewedAt: row.viewed_at,
    enteredAt: row.entered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClaimFromDb(row: any): DiscountClaim {
  return {
    id: row.id,
    discountId: row.discount_id,
    email: row.email,
    memberProfileId: row.member_profile_id,
    status: row.status,
    referrer: row.referrer,
    viewedAt: row.viewed_at,
    acceptedAt: row.accepted_at,
    codeIssuedAt: row.code_issued_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function competitionToDbInsert(data: CreateCompetitionData): Record<string, any> {
  return {
    event_id: data.eventId,
    title: data.title,
    slug: data.slug,
    value: data.value,
    close_date: data.closeDate || null,
    close_display: data.closeDisplay || null,
    result: data.result || null,
    intro: data.intro || null,
    content: data.content || null,
    is_beta: data.isBeta ?? false,
    status: data.status || 'active',
    sort_order: data.sortOrder ?? 0,
  };
}

function competitionToDbUpdate(data: UpdateCompetitionData): Record<string, any> {
  const update: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };
  if (data.eventId !== undefined) update.event_id = data.eventId;
  if (data.title !== undefined) update.title = data.title;
  if (data.slug !== undefined) update.slug = data.slug;
  if (data.value !== undefined) update.value = data.value;
  if (data.closeDate !== undefined) update.close_date = data.closeDate || null;
  if (data.closeDisplay !== undefined) update.close_display = data.closeDisplay || null;
  if (data.result !== undefined) update.result = data.result || null;
  if (data.intro !== undefined) update.intro = data.intro || null;
  if (data.content !== undefined) update.content = data.content || null;
  if (data.isBeta !== undefined) update.is_beta = data.isBeta;
  if (data.status !== undefined) update.status = data.status;
  if (data.sortOrder !== undefined) update.sort_order = data.sortOrder;
  return update;
}

function discountToDbInsert(data: CreateDiscountData): Record<string, any> {
  return {
    event_id: data.eventId,
    title: data.title,
    slug: data.slug,
    value: data.value,
    ticket_details: data.ticketDetails || null,
    close_date: data.closeDate || null,
    close_display: data.closeDisplay || null,
    intro: data.intro || null,
    content: data.content || null,
    is_beta: data.isBeta ?? false,
    status: data.status || 'active',
    sort_order: data.sortOrder ?? 0,
  };
}

function discountToDbUpdate(data: UpdateDiscountData): Record<string, any> {
  const update: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };
  if (data.eventId !== undefined) update.event_id = data.eventId;
  if (data.title !== undefined) update.title = data.title;
  if (data.slug !== undefined) update.slug = data.slug;
  if (data.value !== undefined) update.value = data.value;
  if (data.ticketDetails !== undefined) update.ticket_details = data.ticketDetails || null;
  if (data.closeDate !== undefined) update.close_date = data.closeDate || null;
  if (data.closeDisplay !== undefined) update.close_display = data.closeDisplay || null;
  if (data.intro !== undefined) update.intro = data.intro || null;
  if (data.content !== undefined) update.content = data.content || null;
  if (data.isBeta !== undefined) update.is_beta = data.isBeta;
  if (data.status !== undefined) update.status = data.status;
  if (data.sortOrder !== undefined) update.sort_order = data.sortOrder;
  return update;
}

// ─── Service class ─────────────────────────────────────────────────────────────

export class CompetitionDiscountService {

  // ── Competitions ───────────────────────────────────────────────────────────

  static async getEventCompetitions(eventId: string): Promise<CompetitionDiscountServiceResponse<EventCompetition[]>> {
    try {
      const { data, error } = await supabase
        .from('event_competitions')
        .select('*')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('Error fetching event competitions:', error);
        return { success: false, error: error.message };
      }

      const competitions = (data || []).map(mapCompetitionFromDb);
      return { success: true, data: competitions };
    } catch (error: any) {
      console.error('Error in getEventCompetitions:', error);
      return { success: false, error: error.message };
    }
  }

  static async getCompetition(id: string): Promise<CompetitionDiscountServiceResponse<EventCompetitionWithEvent>> {
    try {
      const { data, error } = await supabase
        .from('event_competitions')
        .select('*, events!inner(event_title, event_city, event_country_code, event_start)')
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching competition:', error);
        return { success: false, error: error.message };
      }

      const competition: EventCompetitionWithEvent = {
        ...mapCompetitionFromDb(data),
        eventTitle: data.events?.event_title || '',
        eventCity: data.events?.event_city || undefined,
        eventCountryCode: data.events?.event_country_code || undefined,
        eventStart: data.events?.event_start || undefined,
      };

      return { success: true, data: competition };
    } catch (error: any) {
      console.error('Error in getCompetition:', error);
      return { success: false, error: error.message };
    }
  }

  static async createCompetition(competitionData: CreateCompetitionData): Promise<CompetitionDiscountServiceResponse<EventCompetition>> {
    try {
      const insertData = competitionToDbInsert(competitionData);

      const { data, error } = await supabase
        .from('event_competitions')
        .insert(insertData)
        .select('*')
        .single();

      if (error) {
        console.error('Error creating competition:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapCompetitionFromDb(data) };
    } catch (error: any) {
      console.error('Error in createCompetition:', error);
      return { success: false, error: error.message };
    }
  }

  static async updateCompetition(id: string, competitionData: UpdateCompetitionData): Promise<CompetitionDiscountServiceResponse<EventCompetition>> {
    try {
      const updateData = competitionToDbUpdate(competitionData);

      const { data, error } = await supabase
        .from('event_competitions')
        .update(updateData)
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        console.error('Error updating competition:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapCompetitionFromDb(data) };
    } catch (error: any) {
      console.error('Error in updateCompetition:', error);
      return { success: false, error: error.message };
    }
  }

  static async deleteCompetition(id: string): Promise<CompetitionDiscountServiceResponse<boolean>> {
    try {
      const { error } = await supabase
        .from('event_competitions')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting competition:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: true };
    } catch (error: any) {
      console.error('Error in deleteCompetition:', error);
      return { success: false, error: error.message };
    }
  }

  static async getAllCompetitions(): Promise<CompetitionDiscountServiceResponse<EventCompetitionWithEvent[]>> {
    try {
      const { data, error } = await supabase
        .from('event_competitions')
        .select('*, events!inner(event_title)')
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('Error fetching all competitions:', error);
        return { success: false, error: error.message };
      }

      const competitions: EventCompetitionWithEvent[] = (data || []).map((row: any) => ({
        ...mapCompetitionFromDb(row),
        eventTitle: row.events?.event_title || '',
      }));

      return { success: true, data: competitions };
    } catch (error: any) {
      console.error('Error in getAllCompetitions:', error);
      return { success: false, error: error.message };
    }
  }

  // ── Discounts ──────────────────────────────────────────────────────────────

  static async getEventDiscounts(eventId: string): Promise<CompetitionDiscountServiceResponse<EventDiscount[]>> {
    try {
      const { data, error } = await supabase
        .from('event_discounts')
        .select('*')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('Error fetching event discounts:', error);
        return { success: false, error: error.message };
      }

      const discounts = (data || []).map(mapDiscountFromDb);
      return { success: true, data: discounts };
    } catch (error: any) {
      console.error('Error in getEventDiscounts:', error);
      return { success: false, error: error.message };
    }
  }

  static async getDiscount(id: string): Promise<CompetitionDiscountServiceResponse<EventDiscount>> {
    try {
      const { data, error } = await supabase
        .from('event_discounts')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching discount:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapDiscountFromDb(data) };
    } catch (error: any) {
      console.error('Error in getDiscount:', error);
      return { success: false, error: error.message };
    }
  }

  static async createDiscount(discountData: CreateDiscountData): Promise<CompetitionDiscountServiceResponse<EventDiscount>> {
    try {
      const insertData = discountToDbInsert(discountData);

      const { data, error } = await supabase
        .from('event_discounts')
        .insert(insertData)
        .select('*')
        .single();

      if (error) {
        console.error('Error creating discount:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapDiscountFromDb(data) };
    } catch (error: any) {
      console.error('Error in createDiscount:', error);
      return { success: false, error: error.message };
    }
  }

  static async updateDiscount(id: string, discountData: UpdateDiscountData): Promise<CompetitionDiscountServiceResponse<EventDiscount>> {
    try {
      const updateData = discountToDbUpdate(discountData);

      const { data, error } = await supabase
        .from('event_discounts')
        .update(updateData)
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        console.error('Error updating discount:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapDiscountFromDb(data) };
    } catch (error: any) {
      console.error('Error in updateDiscount:', error);
      return { success: false, error: error.message };
    }
  }

  static async deleteDiscount(id: string): Promise<CompetitionDiscountServiceResponse<boolean>> {
    try {
      const { error } = await supabase
        .from('event_discounts')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting discount:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: true };
    } catch (error: any) {
      console.error('Error in deleteDiscount:', error);
      return { success: false, error: error.message };
    }
  }

  static async getAllDiscounts(): Promise<CompetitionDiscountServiceResponse<EventDiscountWithEvent[]>> {
    try {
      const { data, error } = await supabase
        .from('event_discounts')
        .select('*, events!inner(event_title)')
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('Error fetching all discounts:', error);
        return { success: false, error: error.message };
      }

      const discounts: EventDiscountWithEvent[] = (data || []).map((row: any) => ({
        ...mapDiscountFromDb(row),
        eventTitle: row.events?.event_title || '',
      }));

      return { success: true, data: discounts };
    } catch (error: any) {
      console.error('Error in getAllDiscounts:', error);
      return { success: false, error: error.message };
    }
  }

  // ── Competition entries ────────────────────────────────────────────────────

  static async getCompetitionEntries(competitionId: string): Promise<CompetitionDiscountServiceResponse<CompetitionEntry[]>> {
    try {
      const { data, error } = await supabase
        .from('competition_entries')
        .select('*')
        .eq('competition_id', competitionId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching competition entries:', error);
        return { success: false, error: error.message };
      }

      const entries = (data || []).map(mapEntryFromDb);
      return { success: true, data: entries };
    } catch (error: any) {
      console.error('Error in getCompetitionEntries:', error);
      return { success: false, error: error.message };
    }
  }

  static async getCompetitionEntryCount(competitionId: string): Promise<CompetitionDiscountServiceResponse<number>> {
    try {
      const { count, error } = await supabase
        .from('competition_entries')
        .select('*', { count: 'exact', head: true })
        .eq('competition_id', competitionId);

      if (error) {
        console.error('Error counting competition entries:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: count ?? 0 };
    } catch (error: any) {
      console.error('Error in getCompetitionEntryCount:', error);
      return { success: false, error: error.message };
    }
  }

  static async getCompetitionEntriesWithCustomerDetails(competitionId: string): Promise<CompetitionDiscountServiceResponse<any[]>> {
    try {
      // First, get all competition entries
      const { data: entries, error: entriesError } = await supabase
        .from('competition_entries')
        .select('id, email, entered_at, status, member_profile_id')
        .eq('competition_id', competitionId)
        .order('entered_at', { ascending: false });

      if (entriesError) {
        console.error('Error fetching competition entries:', entriesError);
        return { success: false, error: entriesError.message };
      }

      if (!entries || entries.length === 0) {
        return { success: true, data: [] };
      }

      // Get unique member profile IDs
      const memberProfileIds = entries
        .map((e: any) => e.member_profile_id)
        .filter((id: any) => id !== null);

      // Fetch member profiles with customer details if we have any
      const profilesMap = new Map();
      if (memberProfileIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('member_profiles')
          .select('id, customer_id')
          .in('id', memberProfileIds);

        if (!profilesError && profiles) {
          // Get customer IDs from profiles
          const customerIds = profiles
            .map((p: any) => p.customer_id)
            .filter((id: any) => id !== null);

          // Fetch customers with attributes if we have any
          const customersMap = new Map();
          if (customerIds.length > 0) {
            const { data: customers } = await supabase
              .from('customers')
              .select('id, cio_id, attributes')
              .in('id', customerIds);

            if (customers) {
              customers.forEach((c: any) => {
                customersMap.set(c.id, c);
              });
            }
          }

          // Build profiles map with customer data
          profiles.forEach((profile: any) => {
            const customer = profile.customer_id ? customersMap.get(profile.customer_id) : null;
            profilesMap.set(profile.id, { ...profile, customer });
          });
        }
      }

      // Map entries to CustomerProfile format
      const customerProfiles = entries.map((entry: any) => {
        const profile = entry.member_profile_id ? profilesMap.get(entry.member_profile_id) : null;
        const customer = profile?.customer;

        // Customer attributes may have profile data that member_profiles doesn't have
        const attrs = (customer?.attributes as Record<string, any>) || {};

        const mapped = {
          cio_id: customer?.cio_id || `email:${entry.email}`,
          id: customer?.id?.toString() || entry.member_profile_id || entry.email,
          email: entry.email,
          // Use member_profile data first, fall back to customer attributes
          first_name: attrs.first_name || '',
          last_name: attrs.last_name || '',
          company: attrs.company || '',
          job_title: attrs.job_title || '',
          linkedin_url: attrs.linkedin_url || '',
          city: attrs.city || '',
          country: attrs.country || '',
          continent: attrs.continent || '',
          created_at: entry.entered_at ? new Date(entry.entered_at).getTime() / 1000 : undefined,
        };

        // Debug log to see what we're getting
        if (!mapped.first_name || !mapped.last_name) {
          console.log('Missing name data for entry:', {
            email: entry.email,
            member_profile_id: entry.member_profile_id,
            hasProfile: !!profile,
            profileData: profile ? {
              first_name: profile.first_name,
              last_name: profile.last_name,
              company: profile.company,
              job_title: profile.job_title
            } : null
          });
        }

        return mapped;
      });

      return { success: true, data: customerProfiles };
    } catch (error: any) {
      console.error('Error in getCompetitionEntriesWithCustomerDetails:', error);
      return { success: false, error: error.message };
    }
  }

  // ── Discount claims ────────────────────────────────────────────────────────

  static async getDiscountClaims(discountId: string): Promise<CompetitionDiscountServiceResponse<DiscountClaim[]>> {
    try {
      const { data, error } = await supabase
        .from('discount_claims')
        .select('*')
        .eq('discount_id', discountId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching discount claims:', error);
        return { success: false, error: error.message };
      }

      const claims = (data || []).map(mapClaimFromDb);
      return { success: true, data: claims };
    } catch (error: any) {
      console.error('Error in getDiscountClaims:', error);
      return { success: false, error: error.message };
    }
  }

  static async getDiscountClaimCount(discountId: string): Promise<CompetitionDiscountServiceResponse<number>> {
    try {
      const { count, error } = await supabase
        .from('discount_claims')
        .select('*', { count: 'exact', head: true })
        .eq('discount_id', discountId);

      if (error) {
        console.error('Error counting discount claims:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: count ?? 0 };
    } catch (error: any) {
      console.error('Error in getDiscountClaimCount:', error);
      return { success: false, error: error.message };
    }
  }
}
