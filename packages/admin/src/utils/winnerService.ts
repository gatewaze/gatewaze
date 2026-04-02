// Competition Winners Service
// Fetches winner counts from Supabase competition_winners table

import { supabase } from '@/lib/supabase';

export interface WinnerCount {
  eventId: string;
  count: number;
}

export class WinnerService {
  /**
   * Get winner counts for multiple events
   */
  static async getWinnerCountsForEvents(eventIds: string[]): Promise<Map<string, number>> {
    try {
      const winnerCounts = new Map<string, number>();

      // Initialize all counts to 0
      eventIds.forEach(eventId => {
        winnerCounts.set(eventId, 0);
      });

      if (eventIds.length === 0) {
        return winnerCounts;
      }

      const { data, error } = await supabase
        .from('events_competition_winners')
        .select('event_id')
        .in('event_id', eventIds);

      if (error) {
        console.error('Error fetching winner counts:', error);
        return winnerCounts;
      }

      // Count winners per event
      data?.forEach(winner => {
        const currentCount = winnerCounts.get(winner.event_id) || 0;
        winnerCounts.set(winner.event_id, currentCount + 1);
      });

      console.log(`✅ Fetched winner counts for ${eventIds.length} events`);
      return winnerCounts;

    } catch (error) {
      console.error('Unexpected error fetching winner counts:', error);
      // Return initialized counts on error
      const winnerCounts = new Map<string, number>();
      eventIds.forEach(eventId => {
        winnerCounts.set(eventId, 0);
      });
      return winnerCounts;
    }
  }

  /**
   * Get winner count for a single event
   */
  static async getWinnerCount(eventId: string): Promise<number> {
    const counts = await this.getWinnerCountsForEvents([eventId]);
    return counts.get(eventId) || 0;
  }
}
