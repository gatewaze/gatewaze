import { supabase } from '@/lib/supabase';

export interface AgendaTrack {
  id: string;
  event_uuid: string;
  name: string;
  description?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Entry types for different agenda items
export type AgendaEntryType = 'session' | 'break' | 'spacer';

export interface AgendaEntry {
  id: string;
  event_uuid: string;
  track_id: string;
  start_time: string;
  end_time: string;
  title: string;
  description?: string;
  location?: string;
  entry_type: AgendaEntryType;
  talk_id?: string;
  created_at: string;
  updated_at: string;
}

// Timeline configuration for visual display
export interface TimelineConfig {
  pixelsPerMinute: number;
  startTime: Date;
  endTime: Date;
  snapInterval: number; // minutes
}

// Computed position for rendering entries on timeline
export interface AgendaEntryPosition {
  entry: AgendaEntry;
  top: number;
  height: number;
}

export interface CreateAgendaTrackInput {
  event_uuid: string;
  name: string;
  description?: string;
  sort_order?: number;
}

export interface UpdateAgendaTrackInput {
  name?: string;
  description?: string;
  sort_order?: number;
}

export interface CreateAgendaEntryInput {
  event_uuid: string;
  track_id: string;
  start_time: string;
  end_time: string;
  title: string;
  description?: string;
  location?: string;
  entry_type?: AgendaEntryType;
  talk_id?: string;
}

export interface UpdateAgendaEntryInput {
  track_id?: string;
  start_time?: string;
  end_time?: string;
  title?: string;
  description?: string;
  location?: string;
  entry_type?: AgendaEntryType;
  talk_id?: string;
}

export class AgendaService {
  // ============ TRACKS ============

  static async getTracksByEvent(eventUuid: string): Promise<AgendaTrack[]> {
    const { data, error } = await supabase
      .from('events_agenda_tracks')
      .select('*')
      .eq('event_uuid', eventUuid)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching agenda tracks:', error);
      throw error;
    }

    return data || [];
  }

  static async createTrack(input: CreateAgendaTrackInput): Promise<AgendaTrack> {
    const { data, error } = await supabase
      .from('events_agenda_tracks')
      .insert([{
        event_uuid: input.event_uuid,
        name: input.name,
        description: input.description,
        sort_order: input.sort_order ?? 0,
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating agenda track:', error);
      throw error;
    }

    return data;
  }

  static async updateTrack(trackId: string, input: UpdateAgendaTrackInput): Promise<AgendaTrack> {
    const { data, error } = await supabase
      .from('events_agenda_tracks')
      .update(input)
      .eq('id', trackId)
      .select()
      .single();

    if (error) {
      console.error('Error updating agenda track:', error);
      throw error;
    }

    return data;
  }

  static async deleteTrack(trackId: string): Promise<void> {
    const { error } = await supabase
      .from('events_agenda_tracks')
      .delete()
      .eq('id', trackId);

    if (error) {
      console.error('Error deleting agenda track:', error);
      throw error;
    }
  }

  // ============ ENTRIES ============

  static async getEntriesByEvent(eventUuid: string): Promise<AgendaEntry[]> {
    const { data, error } = await supabase
      .from('events_agenda_entries')
      .select('*')
      .eq('event_uuid', eventUuid)
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Error fetching agenda entries:', error);
      throw error;
    }

    return data || [];
  }

  static async getEntriesByTrack(trackId: string): Promise<AgendaEntry[]> {
    const { data, error } = await supabase
      .from('events_agenda_entries')
      .select('*')
      .eq('track_id', trackId)
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Error fetching agenda entries by track:', error);
      throw error;
    }

    return data || [];
  }

  static async createEntry(input: CreateAgendaEntryInput): Promise<AgendaEntry> {
    const { data, error } = await supabase
      .from('events_agenda_entries')
      .insert([input])
      .select()
      .single();

    if (error) {
      console.error('Error creating agenda entry:', error);
      throw error;
    }

    return data;
  }

  static async updateEntry(entryId: string, input: UpdateAgendaEntryInput): Promise<AgendaEntry> {
    const { data, error } = await supabase
      .from('events_agenda_entries')
      .update(input)
      .eq('id', entryId)
      .select()
      .single();

    if (error) {
      console.error('Error updating agenda entry:', error);
      throw error;
    }

    return data;
  }

  static async deleteEntry(entryId: string): Promise<void> {
    const { error } = await supabase
      .from('events_agenda_entries')
      .delete()
      .eq('id', entryId);

    if (error) {
      console.error('Error deleting agenda entry:', error);
      throw error;
    }
  }

  // ============ UTILITY METHODS ============

  /**
   * Get the overall start and end times for an event based on its agenda entries
   * Returns null if no agenda entries exist
   */
  static async getEventTimeRange(eventUuid: string): Promise<{ start_time: string; end_time: string } | null> {
    const { data, error } = await supabase
      .from('events_agenda_entries')
      .select('start_time, end_time')
      .eq('event_uuid', eventUuid)
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Error fetching event time range:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      return null;
    }

    const startTime = data[0].start_time;
    const endTime = data.reduce((latest, entry) => {
      return new Date(entry.end_time) > new Date(latest) ? entry.end_time : latest;
    }, data[0].end_time);

    return { start_time: startTime, end_time: endTime };
  }

  // ============ TIMELINE UTILITIES ============

  /**
   * Create timeline configuration from event/entry data
   */
  static createTimelineConfig(
    eventStart: string | undefined,
    eventEnd: string | undefined,
    entries: AgendaEntry[],
    pixelsPerMinute: number = 2
  ): TimelineConfig {
    let startTime: Date;
    let endTime: Date;

    if (eventStart) {
      startTime = new Date(eventStart);
    } else if (entries.length > 0) {
      const earliest = Math.min(...entries.map(e => new Date(e.start_time).getTime()));
      startTime = new Date(earliest);
      startTime.setMinutes(0, 0, 0); // Round down to hour
    } else {
      startTime = new Date();
      startTime.setHours(9, 0, 0, 0);
    }

    if (eventEnd) {
      endTime = new Date(eventEnd);
    } else if (entries.length > 0) {
      const latest = Math.max(...entries.map(e => new Date(e.end_time).getTime()));
      endTime = new Date(latest);
      endTime.setMinutes(0, 0, 0);
      endTime.setHours(endTime.getHours() + 1); // Round up to next hour
    } else {
      endTime = new Date(startTime);
      endTime.setHours(18, 0, 0, 0);
    }

    return {
      pixelsPerMinute,
      startTime,
      endTime,
      snapInterval: 5,
    };
  }

  /**
   * Convert a time to pixel position on the timeline
   */
  static timeToPixels(time: Date, config: TimelineConfig): number {
    const minutesFromStart = (time.getTime() - config.startTime.getTime()) / 60000;
    return minutesFromStart * config.pixelsPerMinute;
  }

  /**
   * Convert pixel position to time
   */
  static pixelsToTime(pixels: number, config: TimelineConfig): Date {
    const minutesFromStart = pixels / config.pixelsPerMinute;
    return new Date(config.startTime.getTime() + minutesFromStart * 60000);
  }

  /**
   * Snap time to nearest interval
   */
  static snapToInterval(time: Date, intervalMinutes: number): Date {
    const ms = intervalMinutes * 60000;
    return new Date(Math.round(time.getTime() / ms) * ms);
  }

  /**
   * Calculate entry position for timeline rendering
   */
  static calculateEntryPosition(entry: AgendaEntry, config: TimelineConfig): AgendaEntryPosition {
    const startTime = new Date(entry.start_time);
    const endTime = new Date(entry.end_time);
    const durationMinutes = (endTime.getTime() - startTime.getTime()) / 60000;

    return {
      entry,
      top: this.timeToPixels(startTime, config),
      height: Math.max(durationMinutes * config.pixelsPerMinute, 30), // Min 30px height
    };
  }

  /**
   * Generate time slots for the timeline ruler
   */
  static generateTimeSlots(config: TimelineConfig, intervalMinutes: number = 30): Array<{
    time: Date;
    label: string;
    top: number;
  }> {
    const slots: Array<{ time: Date; label: string; top: number }> = [];
    const current = new Date(config.startTime);

    while (current <= config.endTime) {
      slots.push({
        time: new Date(current),
        label: current.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }),
        top: this.timeToPixels(current, config),
      });
      current.setMinutes(current.getMinutes() + intervalMinutes);
    }

    return slots;
  }

  /**
   * Calculate total timeline height in pixels
   */
  static calculateTimelineHeight(config: TimelineConfig): number {
    return this.timeToPixels(config.endTime, config);
  }

  /**
   * Get display label for entry type
   */
  static getEntryTypeLabel(entryType: AgendaEntryType): string {
    const labels: Record<AgendaEntryType, string> = {
      session: 'Session',
      break: 'Break',
      spacer: 'Spacer',
    };
    return labels[entryType] || 'Session';
  }
}
