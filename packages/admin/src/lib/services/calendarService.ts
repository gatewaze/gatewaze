/**
 * Calendar Service
 * Handles all calendar-related CRUD operations
 */

import { supabase } from '@/lib/supabase';

// ============================================================================
// Types
// ============================================================================

/**
 * Calendar location settings
 * Used to associate a calendar with a geographic location (city, region, country)
 * or mark it as global (no specific location)
 */
export interface CalendarLocation {
  type: 'global' | 'city' | 'region' | 'country';
  city?: string;
  state?: string;        // US state or equivalent region
  country?: string;      // Full country name
  country_code?: string; // ISO 3166-1 alpha-2 code (e.g., 'US', 'GB')
  continent?: string;    // Continent name
}

export interface Calendar {
  id: string;
  calendarId: string;
  name: string;
  description?: string;
  slug?: string;
  color?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  accountId?: string;
  visibility: 'public' | 'private' | 'unlisted';
  isActive: boolean;
  lumaCalendarId?: string;
  externalUrl?: string;
  defaultScraperId?: number;
  settings: Record<string, any>;
  metadata: Record<string, any>;
  createdByAdminId?: string;
  createdAt: string;
  updatedAt: string;
  // Computed fields from views/joins
  eventCount?: number;
  memberCount?: number;
  upcomingEventCount?: number;
}

/**
 * Get the location settings from a calendar
 */
export function getCalendarLocation(calendar: Calendar): CalendarLocation | null {
  return calendar.settings?.location || null;
}

/**
 * Check if a calendar has a location set (not global)
 */
export function hasCalendarLocation(calendar: Calendar): boolean {
  const location = getCalendarLocation(calendar);
  return location !== null && location.type !== 'global';
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  eventId: string;
  sortOrder: number;
  isFeatured: boolean;
  addedVia: 'manual' | 'scraper' | 'import' | 'api';
  addedByAdminId?: string;
  addedAt: string;
  // Joined event fields
  event?: {
    eventTitle: string;
    eventStart: string;
    eventEnd: string;
    eventCity?: string;
    eventLogo?: string;
    status?: string;
  };
}

export interface CalendarStats {
  total_members: number;
  total_events: number;
  upcoming_events: number;
  past_events: number;
  total_interested: number;
  total_registered: number;
  total_attended: number;
}

export interface CreateCalendarInput {
  name: string;
  description?: string;
  slug?: string;
  color?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  accountId?: string;
  visibility?: 'public' | 'private' | 'unlisted';
  lumaCalendarId?: string;
  externalUrl?: string;
  defaultScraperId?: number;
  settings?: Record<string, any>;
  createdByAdminId?: string;
}

export interface UpdateCalendarInput {
  name?: string;
  description?: string;
  slug?: string;
  color?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  accountId?: string;
  visibility?: 'public' | 'private' | 'unlisted';
  isActive?: boolean;
  lumaCalendarId?: string;
  externalUrl?: string;
  defaultScraperId?: number;
  settings?: Record<string, any>;
}

export interface CalendarServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// Field Mapping Helpers
// ============================================================================

function mapDbToCalendar(data: any): Calendar {
  return {
    id: data.id,
    calendarId: data.calendar_id,
    name: data.name,
    description: data.description,
    slug: data.slug,
    color: data.color,
    logoUrl: data.logo_url,
    coverImageUrl: data.cover_image_url,
    accountId: data.account_id,
    visibility: data.visibility,
    isActive: data.is_active,
    lumaCalendarId: data.luma_calendar_id,
    externalUrl: data.external_url,
    defaultScraperId: data.default_scraper_id,
    settings: data.settings || {},
    metadata: data.metadata || {},
    createdByAdminId: data.created_by_admin_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    // Optional computed fields
    eventCount: data.event_count,
    memberCount: data.member_count,
    upcomingEventCount: data.upcoming_event_count,
  };
}

function mapCalendarToDb(calendar: CreateCalendarInput | UpdateCalendarInput): Record<string, any> {
  const dbFields: Record<string, any> = {};

  if ('name' in calendar && calendar.name !== undefined) dbFields.name = calendar.name;
  if ('description' in calendar) dbFields.description = calendar.description;
  if ('slug' in calendar) dbFields.slug = calendar.slug;
  if ('color' in calendar) dbFields.color = calendar.color;
  if ('logoUrl' in calendar) dbFields.logo_url = calendar.logoUrl;
  if ('coverImageUrl' in calendar) dbFields.cover_image_url = calendar.coverImageUrl;
  if ('accountId' in calendar) dbFields.account_id = calendar.accountId;
  if ('visibility' in calendar) dbFields.visibility = calendar.visibility;
  if ('isActive' in calendar) dbFields.is_active = calendar.isActive;
  if ('lumaCalendarId' in calendar) dbFields.luma_calendar_id = calendar.lumaCalendarId;
  if ('externalUrl' in calendar) dbFields.external_url = calendar.externalUrl;
  if ('defaultScraperId' in calendar) dbFields.default_scraper_id = calendar.defaultScraperId;
  if ('settings' in calendar) dbFields.settings = calendar.settings;
  if ('createdByAdminId' in calendar) dbFields.created_by_admin_id = calendar.createdByAdminId;

  return dbFields;
}

function mapDbToCalendarEvent(data: any): CalendarEvent {
  return {
    id: data.id,
    calendarId: data.calendar_id,
    eventId: data.event_id,
    sortOrder: data.sort_order,
    isFeatured: data.is_featured,
    addedVia: data.added_via,
    addedByAdminId: data.added_by_admin_id,
    addedAt: data.added_at,
    event: data.events ? {
      eventTitle: data.events.event_title,
      eventStart: data.events.event_start,
      eventEnd: data.events.event_end,
      eventCity: data.events.event_city,
      eventLogo: data.events.event_logo,
      status: data.events.status,
    } : undefined,
  };
}

// ============================================================================
// CalendarService
// ============================================================================

export class CalendarService {
  // ==========================================================================
  // Calendar CRUD
  // ==========================================================================

  /**
   * Get a calendar by ID (UUID or calendar_id)
   */
  static async getCalendarById(id: string): Promise<CalendarServiceResponse<Calendar>> {
    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const column = isUUID ? 'id' : 'calendar_id';

      const { data, error } = await supabase
        .from('calendars')
        .select('*')
        .eq(column, id)
        .single();

      if (error) {
        console.error('Error fetching calendar:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapDbToCalendar(data) };
    } catch (error) {
      console.error('Error in getCalendarById:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get all calendars with optional filtering
   */
  static async getCalendars(options?: {
    accountId?: string;
    isActive?: boolean;
    visibility?: 'public' | 'private' | 'unlisted';
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<CalendarServiceResponse<{ calendars: Calendar[]; total: number }>> {
    try {
      let query = supabase
        .from('calendars')
        .select('*, calendar_events(count)', { count: 'exact' });

      if (options?.accountId) {
        query = query.eq('account_id', options.accountId);
      }

      if (options?.isActive !== undefined) {
        query = query.eq('is_active', options.isActive);
      }

      if (options?.visibility) {
        query = query.eq('visibility', options.visibility);
      }

      if (options?.search) {
        query = query.or(`name.ilike.%${options.search}%,description.ilike.%${options.search}%`);
      }

      query = query.order('created_at', { ascending: false });

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }

      const { data, error, count } = await query;

      if (error) {
        console.error('Error fetching calendars:', error);
        return { success: false, error: error.message };
      }

      // Get member counts using the database function (includes both direct members and registrations)
      const calendarIds = (data || []).map((item: any) => item.id);
      let memberCounts: Record<string, number> = {};

      if (calendarIds.length > 0) {
        const { data: countsData, error: countsError } = await supabase.rpc(
          'get_calendar_members_counts',
          { p_calendar_ids: calendarIds }
        );

        if (!countsError && countsData) {
          memberCounts = (countsData as Array<{ calendar_id: string; member_count: number }>).reduce(
            (acc, item) => {
              acc[item.calendar_id] = item.member_count;
              return acc;
            },
            {} as Record<string, number>
          );
        }
      }

      const calendars = (data || []).map((item: any) => ({
        ...mapDbToCalendar(item),
        eventCount: item.calendar_events?.[0]?.count || 0,
        memberCount: memberCounts[item.id] || 0,
      }));

      return { success: true, data: { calendars, total: count || 0 } };
    } catch (error) {
      console.error('Error in getCalendars:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Create a new calendar
   */
  static async createCalendar(input: CreateCalendarInput): Promise<CalendarServiceResponse<Calendar>> {
    try {
      const dbData = mapCalendarToDb(input);

      const { data, error } = await supabase
        .from('calendars')
        .insert(dbData)
        .select()
        .single();

      if (error) {
        console.error('Error creating calendar:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapDbToCalendar(data) };
    } catch (error) {
      console.error('Error in createCalendar:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Update a calendar
   */
  static async updateCalendar(id: string, input: UpdateCalendarInput): Promise<CalendarServiceResponse<Calendar>> {
    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const column = isUUID ? 'id' : 'calendar_id';
      const dbData = mapCalendarToDb(input);

      const { data, error } = await supabase
        .from('calendars')
        .update(dbData)
        .eq(column, id)
        .select()
        .single();

      if (error) {
        console.error('Error updating calendar:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapDbToCalendar(data) };
    } catch (error) {
      console.error('Error in updateCalendar:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Delete a calendar (soft delete by setting is_active = false)
   */
  static async deleteCalendar(id: string): Promise<CalendarServiceResponse<void>> {
    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const column = isUUID ? 'id' : 'calendar_id';

      const { error } = await supabase
        .from('calendars')
        .update({ is_active: false })
        .eq(column, id);

      if (error) {
        console.error('Error deleting calendar:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Error in deleteCalendar:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Permanently delete a calendar
   */
  static async hardDeleteCalendar(id: string): Promise<CalendarServiceResponse<void>> {
    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const column = isUUID ? 'id' : 'calendar_id';

      const { error } = await supabase
        .from('calendars')
        .delete()
        .eq(column, id);

      if (error) {
        console.error('Error hard deleting calendar:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Error in hardDeleteCalendar:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  // ==========================================================================
  // Calendar Events Association
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

  /**
   * Get events in a calendar
   */
  static async getCalendarEvents(
    calendarId: string,
    options?: {
      limit?: number;
      offset?: number;
      featured?: boolean;
      upcoming?: boolean;
    }
  ): Promise<CalendarServiceResponse<CalendarEvent[]>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      let query = supabase
        .from('calendar_events')
        .select(`
          *,
          events (
            event_title,
            event_start,
            event_end,
            event_city,
            event_logo,
            status
          )
        `)
        .eq('calendar_id', uuid)
        .order('sort_order', { ascending: true });

      if (options?.featured !== undefined) {
        query = query.eq('is_featured', options.featured);
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching calendar events:', error);
        return { success: false, error: error.message };
      }

      let events = (data || []).map(mapDbToCalendarEvent);

      // Filter upcoming if requested (done in JS since we need join data)
      if (options?.upcoming) {
        const now = new Date().toISOString();
        events = events.filter(e => e.event && e.event.eventStart > now);
      }

      return { success: true, data: events };
    } catch (error) {
      console.error('Error in getCalendarEvents:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Add events to a calendar
   */
  static async addEventsToCalendar(
    calendarId: string,
    eventIds: string[],
    addedVia: 'manual' | 'scraper' | 'import' | 'api' = 'manual',
    addedByAdminId?: string
  ): Promise<CalendarServiceResponse<{ added: number; skipped: number }>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const records = eventIds.map(eventId => ({
        calendar_id: uuid,
        event_id: eventId,
        added_via: addedVia,
        added_by_admin_id: addedByAdminId,
      }));

      const { data, error } = await supabase
        .from('calendar_events')
        .upsert(records, { onConflict: 'calendar_id,event_id', ignoreDuplicates: true })
        .select();

      if (error) {
        console.error('Error adding events to calendar:', error);
        return { success: false, error: error.message };
      }

      return {
        success: true,
        data: {
          added: data?.length || 0,
          skipped: eventIds.length - (data?.length || 0),
        },
      };
    } catch (error) {
      console.error('Error in addEventsToCalendar:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Remove events from a calendar
   */
  static async removeEventsFromCalendar(
    calendarId: string,
    eventIds: string[]
  ): Promise<CalendarServiceResponse<{ removed: number }>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const { data, error } = await supabase
        .from('calendar_events')
        .delete()
        .eq('calendar_id', uuid)
        .in('event_id', eventIds)
        .select();

      if (error) {
        console.error('Error removing events from calendar:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: { removed: data?.length || 0 } };
    } catch (error) {
      console.error('Error in removeEventsFromCalendar:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Update event in calendar (featured status, sort order)
   */
  static async updateCalendarEvent(
    calendarId: string,
    eventId: string,
    updates: { isFeatured?: boolean; sortOrder?: number }
  ): Promise<CalendarServiceResponse<CalendarEvent>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const dbUpdates: Record<string, any> = {};
      if (updates.isFeatured !== undefined) dbUpdates.is_featured = updates.isFeatured;
      if (updates.sortOrder !== undefined) dbUpdates.sort_order = updates.sortOrder;

      const { data, error } = await supabase
        .from('calendar_events')
        .update(dbUpdates)
        .eq('calendar_id', uuid)
        .eq('event_id', eventId)
        .select()
        .single();

      if (error) {
        console.error('Error updating calendar event:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapDbToCalendarEvent(data) };
    } catch (error) {
      console.error('Error in updateCalendarEvent:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  // ==========================================================================
  // Calendar Stats
  // ==========================================================================

  /**
   * Get calendar aggregate statistics
   */
  static async getCalendarStats(calendarId: string): Promise<CalendarServiceResponse<CalendarStats>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const { data, error } = await supabase.rpc('get_calendar_stats', {
        p_calendar_id: uuid,
      });

      if (error) {
        console.error('Error fetching calendar stats:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: data as CalendarStats };
    } catch (error) {
      console.error('Error in getCalendarStats:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get events for a specific month (for calendar view)
   */
  static async getCalendarEventsForMonth(
    calendarId: string,
    year: number,
    month: number
  ): Promise<CalendarServiceResponse<any[]>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const { data, error } = await supabase.rpc('get_calendar_events_for_month', {
        p_calendar_id: uuid,
        p_year: year,
        p_month: month,
      });

      if (error) {
        console.error('Error fetching calendar events for month:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: data || [] };
    } catch (error) {
      console.error('Error in getCalendarEventsForMonth:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  // ==========================================================================
  // Scraper Association
  // ==========================================================================

  /**
   * Get scrapers associated with a calendar
   */
  static async getCalendarScrapers(calendarId: string): Promise<CalendarServiceResponse<any[]>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const { data, error } = await supabase
        .from('scraper_calendars')
        .select(`
          *,
          scrapers (
            id,
            name,
            description,
            enabled,
            last_run
          )
        `)
        .eq('calendar_id', uuid)
        .eq('is_active', true);

      if (error) {
        console.error('Error fetching calendar scrapers:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: data || [] };
    } catch (error) {
      console.error('Error in getCalendarScrapers:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Associate a scraper with a calendar
   */
  static async addScraperToCalendar(
    calendarId: string,
    scraperId: number,
    autoAddEvents: boolean = true
  ): Promise<CalendarServiceResponse<void>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const { error } = await supabase
        .from('scraper_calendars')
        .upsert({
          calendar_id: uuid,
          scraper_id: scraperId,
          is_active: true,
          auto_add_events: autoAddEvents,
        }, { onConflict: 'scraper_id,calendar_id' });

      if (error) {
        console.error('Error adding scraper to calendar:', error);
        return { success: false, error: error.message };
      }

      // Import existing events from this scraper
      if (autoAddEvents) {
        await this.importScraperEvents(calendarId, scraperId);
      }

      return { success: true };
    } catch (error) {
      console.error('Error in addScraperToCalendar:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Remove a scraper from a calendar
   */
  static async removeScraperFromCalendar(
    calendarId: string,
    scraperId: number
  ): Promise<CalendarServiceResponse<void>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      const { error } = await supabase
        .from('scraper_calendars')
        .update({ is_active: false })
        .eq('calendar_id', uuid)
        .eq('scraper_id', scraperId);

      if (error) {
        console.error('Error removing scraper from calendar:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Error in removeScraperFromCalendar:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Import all existing events from a scraper into a calendar
   */
  static async importScraperEvents(
    calendarId: string,
    scraperId: number
  ): Promise<CalendarServiceResponse<{ imported: number }>> {
    try {
      // Resolve calendar_id to UUID
      const { uuid, error: resolveError } = await this.resolveCalendarId(calendarId);
      if (!uuid) {
        return { success: false, error: resolveError };
      }

      // Get all events from this scraper (use event_id, not id)
      const { data: events, error: fetchError } = await supabase
        .from('events')
        .select('event_id')
        .eq('scraper_id', scraperId);

      if (fetchError) {
        console.error('Error fetching scraper events:', fetchError);
        return { success: false, error: fetchError.message };
      }

      if (!events || events.length === 0) {
        return { success: true, data: { imported: 0 } };
      }

      // Insert events into calendar_events (upsert to avoid duplicates)
      const records = events.map(event => ({
        calendar_id: uuid,
        event_id: event.event_id,
        added_via: 'scraper' as const,
      }));

      const { data: inserted, error: insertError } = await supabase
        .from('calendar_events')
        .upsert(records, { onConflict: 'calendar_id,event_id', ignoreDuplicates: true })
        .select();

      if (insertError) {
        console.error('Error importing scraper events:', insertError);
        return { success: false, error: insertError.message };
      }

      return { success: true, data: { imported: inserted?.length || 0 } };
    } catch (error) {
      console.error('Error in importScraperEvents:', error);
      return { success: false, error: (error as Error).message };
    }
  }
}

export default CalendarService;
