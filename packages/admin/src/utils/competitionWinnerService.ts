import { supabase } from '@/lib/supabase';

// Competition Winners table interface
export type WinnerStatus = 'selected' | 'notified' | 'accepted' | 'declined' | 'not_replied';

export interface CompetitionWinner {
  id?: number;
  email: string;
  event_id: string;
  status: WinnerStatus;
  created_at?: string;
  notified_at?: string;
  accepted_at?: string;
  declined_at?: string;
  not_replied_at?: string;
  winner_image_url?: string;
  winner_image_storage_path?: string;
  social_post_url?: string;
  social_post_platform?: string;
  notes?: string;
  media_updated_at?: string;
}

// Service class for competition winners
export class CompetitionWinnerService {

  /**
   * Log a competition winner to the database with 'notified' status
   */
  static async logWinner(email: string, eventId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('events_competition_winners')
        .insert([
          {
            email: email,
            event_id: eventId,
            status: 'notified',
            created_at: new Date().toISOString(),
            notified_at: new Date().toISOString(),
            accepted_at: null,
            declined_at: null,
            not_replied_at: null
          }
        ])
        .select();

      if (error) {
        console.error('Error logging winner to Supabase:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Winner logged successfully:', data);
      return { success: true };

    } catch (error) {
      console.error('Unexpected error logging winner:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update winner status to 'notified'
   */
  static async markWinnerNotified(email: string, eventId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('events_competition_winners')
        .update({
          status: 'notified',
          notified_at: new Date().toISOString()
        })
        .eq('email', email)
        .eq('event_id', eventId)
        .select();

      if (error) {
        console.error('Error marking winner as notified:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Winner marked as notified:', data);
      return { success: true };

    } catch (error) {
      console.error('Unexpected error marking winner as notified:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update winner status to 'accepted' (to be set manually in Supabase)
   */
  static async markWinnerAccepted(email: string, eventId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('events_competition_winners')
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString()
        })
        .eq('email', email)
        .eq('event_id', eventId)
        .select();

      if (error) {
        console.error('Error marking winner as accepted:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Winner marked as accepted:', data);
      return { success: true };

    } catch (error) {
      console.error('Unexpected error marking winner as accepted:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update winner status to 'declined' (to be set manually in Supabase)
   */
  static async markWinnerDeclined(email: string, eventId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('events_competition_winners')
        .update({
          status: 'declined',
          declined_at: new Date().toISOString()
        })
        .eq('email', email)
        .eq('event_id', eventId)
        .select();

      if (error) {
        console.error('Error marking winner as declined:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Winner marked as declined:', data);
      return { success: true };

    } catch (error) {
      console.error('Unexpected error marking winner as declined:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update winner status to 'not_replied' (to be set manually in Supabase)
   */
  static async markWinnerNotReplied(email: string, eventId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('events_competition_winners')
        .update({
          status: 'not_replied',
          not_replied_at: new Date().toISOString()
        })
        .eq('email', email)
        .eq('event_id', eventId)
        .select();

      if (error) {
        console.error('Error marking winner as not replied:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Winner marked as not replied:', data);
      return { success: true };

    } catch (error) {
      console.error('Unexpected error marking winner as not replied:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get all winners for a specific event
   */
  static async getWinnersForEvent(eventId: string): Promise<CompetitionWinner[]> {
    try {
      const { data, error } = await supabase
        .from('events_competition_winners')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching winners:', error);
        return [];
      }

      return data || [];

    } catch (error) {
      console.error('Unexpected error fetching winners:', error);
      return [];
    }
  }

  /**
   * Get all winners across all competitions
   */
  static async getAllWinners(): Promise<CompetitionWinner[]> {
    try {
      const { data, error } = await supabase
        .from('events_competition_winners')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching all winners:', error);
        return [];
      }

      return data || [];

    } catch (error) {
      console.error('Unexpected error fetching all winners:', error);
      return [];
    }
  }

  /**
   * Check if a user has already won a specific competition
   */
  static async hasUserWonEvent(email: string, eventId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('events_competition_winners')
        .select('id')
        .eq('email', email)
        .eq('event_id', eventId)
        .limit(1);

      if (error) {
        console.error('Error checking if user won:', error);
        return false;
      }

      return (data?.length ?? 0) > 0;

    } catch (error) {
      console.error('Unexpected error checking winner status:', error);
      return false;
    }
  }

  /**
   * Get winner count for a specific event
   */
  static async getWinnerCountForEvent(eventId: string): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('events_competition_winners')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', eventId);

      if (error) {
        console.error('Error fetching winner count:', error);
        return 0;
      }

      return count || 0;

    } catch (error) {
      console.error('Unexpected error fetching winner count:', error);
      return 0;
    }
  }

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

      return winnerCounts;

    } catch (error) {
      console.error('Unexpected error fetching winner counts:', error);
      return new Map<string, number>();
    }
  }

  /**
   * Delete a winner entry by ID
   */
  static async deleteWinner(winnerId: number): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('events_competition_winners')
        .delete()
        .eq('id', winnerId);

      if (error) {
        console.error('Error deleting winner:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Winner deleted successfully');
      return { success: true };

    } catch (error) {
      console.error('Unexpected error deleting winner:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update winner media (images and social posts)
   */
  static async updateWinnerMedia(
    winnerId: number,
    updates: {
      winner_image_url?: string;
      winner_image_storage_path?: string;
      social_post_url?: string;
      social_post_platform?: string;
      notes?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('events_competition_winners')
        .update({
          ...updates,
          media_updated_at: new Date().toISOString()
        })
        .eq('id', winnerId)
        .select();

      if (error) {
        console.error('Error updating winner media:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Winner media updated successfully:', data);
      return { success: true };

    } catch (error) {
      console.error('Unexpected error updating winner media:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Upload winner image to Supabase Storage
   */
  static async uploadWinnerImage(
    winnerId: number,
    file: File
  ): Promise<{ success: boolean; url?: string; path?: string; error?: string }> {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${winnerId}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      // Upload file to storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('media')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        console.error('Error uploading image:', uploadError);
        return { success: false, error: uploadError.message };
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(filePath);

      // Update winner record with image URL
      const updateResult = await this.updateWinnerMedia(winnerId, {
        winner_image_url: publicUrl,
        winner_image_storage_path: filePath
      });

      if (!updateResult.success) {
        return { success: false, error: updateResult.error };
      }

      console.log('✅ Winner image uploaded successfully');
      return { success: true, url: publicUrl, path: filePath };

    } catch (error) {
      console.error('Unexpected error uploading winner image:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Delete winner image from storage
   */
  static async deleteWinnerImage(storagePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase.storage
        .from('media')
        .remove([storagePath]);

      if (error) {
        console.error('Error deleting image:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Winner image deleted successfully');
      return { success: true };

    } catch (error) {
      console.error('Unexpected error deleting winner image:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
