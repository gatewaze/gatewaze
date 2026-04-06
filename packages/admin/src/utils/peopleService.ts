import { supabase } from '@/lib/supabase';
import md5 from 'md5';

// Person interface matching Supabase table
export interface Person {
  id?: number;
  cio_id: string;
  email?: string;
  phone?: string;
  attributes?: Record<string, any>;
  attribute_timestamps?: Record<string, number>; // Unix timestamps for when each attribute was changed
  auth_user_id?: string | null;
  is_guest?: boolean;
  last_synced_at?: string;
  created_at?: string;
  updated_at?: string;
  has_gravatar?: boolean;
  avatar_source?: 'uploaded' | 'linkedin' | 'gravatar' | null;
  avatar_storage_path?: string | null;
  linkedin_avatar_url?: string | null;
  avatar_updated_at?: string | null;
}

// Person activity interface
export interface PersonActivity {
  id?: number;
  customer_cio_id: string;
  activity_type: string;
  activity_name?: string;
  activity_data?: Record<string, any>;
  timestamp: string;
  created_at?: string;
}

// Service class for people data operations
export class PeopleService {

  /**
   * Upsert person data (insert or update if exists)
   * Requires auth user to exist for the email
   */
  static async upsertPerson(
    cioId: string,
    email?: string,
    attributes?: Record<string, any>
  ): Promise<{ success: boolean; error?: string; person?: Person }> {
    try {
      if (!email) {
        return { success: false, error: 'Email is required to create person' };
      }

      // Use the database function that ensures auth user exists
      const { data, error } = await supabase.rpc('people_upsert_with_auth', {
        p_cio_id: cioId,
        p_email: email,
        p_attributes: attributes || {}
      });

      if (error) {
        console.error('Error upserting person:', error);
        // If no auth user exists, provide helpful error message
        if (error.message?.includes('no auth user found')) {
          return {
            success: false,
            error: `Cannot create person: user with email ${email} must create an account first`
          };
        }
        return { success: false, error: error.message };
      }

      // Check and update Gravatar status asynchronously (don't wait for it)
      if (data?.id && email) {
        this.checkAndUpdateGravatar(data.id, email).catch(err =>
          console.error('Error checking gravatar:', err)
        );
      }

      return { success: true, person: data };

    } catch (error) {
      console.error('Unexpected error upserting person:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check if email has Gravatar and update database
   */
  private static async checkAndUpdateGravatar(personId: number, email: string): Promise<void> {
    try {
      // Dynamic import to avoid bundling md5 in all cases
      const md5 = (await import('md5')).default;
      const trimmedEmail = email.trim().toLowerCase();
      const hash = md5(trimmedEmail);
      const checkUrl = `https://www.gravatar.com/avatar/${hash}?d=404`;

      const response = await fetch(checkUrl, { method: 'HEAD' });
      const hasGravatar = response.ok;

      // Update database
      await this.updateGravatarStatus(personId, hasGravatar);
    } catch (error) {
      // Silently fail - gravatar check is not critical
      console.error('Error checking gravatar:', error);
    }
  }

  /**
   * Get person by Customer.io ID
   */
  static async getPerson(cioId: string): Promise<Person | null> {
    try {
      const { data, error } = await supabase
        .from('people')
        .select('*')
        .eq('cio_id', cioId)
        .single();

      if (error) {
        console.error('Error fetching person:', error);
        return null;
      }

      return data;

    } catch (error) {
      console.error('Unexpected error fetching person:', error);
      return null;
    }
  }

  /**
   * Get multiple people by Customer.io IDs
   */
  static async getPeople(cioIds: string[]): Promise<Person[]> {
    try {
      const { data, error } = await supabase
        .from('people')
        .select('*')
        .in('cio_id', cioIds);

      if (error) {
        console.error('Error fetching people:', error);
        return [];
      }

      return data || [];

    } catch (error) {
      console.error('Unexpected error fetching people:', error);
      return [];
    }
  }

  /**
   * Get paginated people
   */
  static async getPeoplePaginated(
    page: number = 0,
    pageSize: number = 50
  ): Promise<{ people: Person[]; total: number }> {
    try {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await supabase
        .from('people')
        .select('*', { count: 'exact' })
        .order('last_synced_at', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('Error fetching paginated people:', error);
        return { people: [], total: 0 };
      }

      return { people: data || [], total: count || 0 };

    } catch (error) {
      console.error('Unexpected error fetching paginated people:', error);
      return { people: [], total: 0 };
    }
  }

  /**
   * Sync person activities to database
   */
  static async syncPersonActivities(
    cioId: string,
    activities: Array<{
      type: string;
      name?: string;
      data?: Record<string, any>;
      timestamp: string;
    }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // First, get the person's id for the foreign key
      const { data: person, error: personError } = await supabase
        .from('people')
        .select('id')
        .eq('cio_id', cioId)
        .single();

      if (personError || !person) {
        console.error('Person not found for cio_id:', cioId);
        return { success: false, error: 'Person not found' };
      }

      // Delete old activities for this person
      const { error: deleteError } = await supabase
        .from('people_activities')
        .delete()
        .eq('person_id', person.id);

      if (deleteError) {
        console.error('Error deleting old activities:', deleteError);
        return { success: false, error: deleteError.message };
      }

      // Insert new activities with person_id as primary FK
      const activitiesToInsert = activities.map(activity => ({
        person_id: person.id,
        customer_cio_id: cioId,
        activity_type: activity.type,
        activity_name: activity.name || null,
        activity_data: activity.data || {},
        timestamp: activity.timestamp,
      }));

      const { error: insertError } = await supabase
        .from('people_activities')
        .insert(activitiesToInsert);

      if (insertError) {
        console.error('Error inserting activities:', insertError);
        return { success: false, error: insertError.message };
      }

      return { success: true };

    } catch (error) {
      console.error('Unexpected error syncing activities:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get count of unique people who have accepted a specific competition, discount, or offer
   * Reads from cached competition_interactions, discount_interactions, or offer_interactions table for performance
   */
  static async getAcceptedOfferCount(offerSlug: string): Promise<number> {
    try {
      // Determine which table to query based on offer_id prefix
      let tableName: string;
      if (offerSlug.startsWith('win-')) {
        tableName = 'competition_interactions';
      } else if (offerSlug.startsWith('discount-') || offerSlug.startsWith('free-tickets-')) {
        tableName = 'discount_interactions';
      } else {
        tableName = 'offer_interactions';
      }

      const { count, error } = await supabase
        .from(tableName)
        .select('customer_cio_id', { count: 'exact', head: true })
        .eq('offer_id', offerSlug)
        .eq('offer_status', 'accepted');

      if (error) {
        console.error('Error getting accepted offer count:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('Unexpected error getting accepted offer count:', error);
      return 0;
    }
  }

  /**
   * Get count of unique people who have accepted a specific competition, discount, or offer from TEST table
   * Only counts interactions where customer_cio_id exists in people table
   */
  static async getAcceptedOfferCountTest(offerSlug: string): Promise<number> {
    try {
      // Determine which table to query based on offer_id prefix
      let tableName: string;
      if (offerSlug.startsWith('win-')) {
        tableName = 'competition_interactions_test';
      } else if (offerSlug.startsWith('discount-') || offerSlug.startsWith('free-tickets-')) {
        tableName = 'discount_interactions_test';
      } else {
        tableName = 'offer_interactions_test';
      }

      // Use database function to count only interactions with valid people
      const { data, error } = await supabase.rpc('events_get_accepted_test_interaction_count', {
        p_offer_id: offerSlug,
        p_table_name: tableName
      });

      if (error) {
        console.error('Error getting accepted offer count from test table:', error);
        return 0;
      }

      return data || 0;
    } catch (error) {
      console.error('Unexpected error getting accepted offer count from test table:', error);
      return 0;
    }
  }

  /**
   * Get filtered count of segment people who exist in people table
   * This queries the TEST interaction table (CSV backup) but only counts people that exist in our database
   * Used to compare Customer.io segment counts with our actual people base
   */
  static async getFilteredSegmentPersonCount(offerSlug: string): Promise<number> {
    try {
      // Use the test table which has the historical CSV backup data
      let tableName: string;
      if (offerSlug.startsWith('win-')) {
        tableName = 'competition_interactions_test';
      } else if (offerSlug.startsWith('discount-') || offerSlug.startsWith('free-tickets-')) {
        tableName = 'discount_interactions_test';
      } else {
        tableName = 'offer_interactions_test';
      }

      // Use the database function that filters to only people in our database
      const { data, error } = await supabase.rpc('events_get_test_interaction_entry_count', {
        p_offer_id: offerSlug,
        p_table_name: tableName
      });

      if (error) {
        console.error('Error getting filtered segment count:', error);
        return 0;
      }

      return data || 0;
    } catch (error) {
      console.error('Unexpected error getting filtered segment count:', error);
      return 0;
    }
  }

  /**
   * Get count of unique people who have entered a specific competition (accepted only)
   */
  static async getCompetitionEntriesCount(offerSlug: string): Promise<number> {
    try {
      // Determine which table to query based on offer_id prefix
      let tableName: string;
      if (offerSlug.startsWith('win-')) {
        tableName = 'competition_interactions';
      } else if (offerSlug.startsWith('discount-') || offerSlug.startsWith('free-tickets-')) {
        tableName = 'discount_interactions';
      } else {
        tableName = 'offer_interactions';
      }

      const { count, error } = await supabase
        .from(tableName)
        .select('customer_cio_id', { count: 'exact', head: true })
        .eq('offer_id', offerSlug)
        .eq('offer_status', 'accepted');

      if (error) {
        console.error('Error getting competition entries count:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('Unexpected error getting competition entries count:', error);
      return 0;
    }
  }

  /**
   * Get list of people who have entered a specific competition (accepted only)
   * Returns enriched person profiles from database
   * Each person appears only once even if they have multiple interactions
   */
  static async getCompetitionEntries(offerSlug: string): Promise<any[]> {
    try {
      // Determine which table to query based on offer_id prefix
      let tableName: string;
      if (offerSlug.startsWith('win-')) {
        tableName = 'competition_interactions';
      } else if (offerSlug.startsWith('discount-') || offerSlug.startsWith('free-tickets-')) {
        tableName = 'discount_interactions';
      } else {
        tableName = 'offer_interactions';
      }

      // Get all people who accepted this competition
      const { data: interactions, error } = await supabase
        .from(tableName)
        .select('customer_cio_id, timestamp')
        .eq('offer_id', offerSlug)
        .eq('offer_status', 'accepted')
        .order('timestamp', { ascending: true });

      if (error) {
        console.error('Error getting competition entries:', error);
        return [];
      }

      if (!interactions || interactions.length === 0) {
        return [];
      }

      // Get unique person IDs (in case there are duplicate entries)
      const cioIds = [...new Set(interactions.map(i => i.customer_cio_id))];

      // Fetch person details from database
      const people = await this.getPeople(cioIds);

      // Map to PersonProfile format expected by the UI
      const enrichedPeople = people.map(person => ({
        cio_id: person.cio_id,
        email: person.email || '',
        first_name: person.attributes?.first_name || '',
        last_name: person.attributes?.last_name || '',
        company: person.attributes?.company || '',
        job_title: person.attributes?.job_title || '',
        city: person.attributes?.city || '',
        country: person.attributes?.country || '',
        linkedin_url: person.attributes?.linkedin_url || '',
        continent: person.attributes?.continent || '',
        created_at: person.created_at ? new Date(person.created_at).getTime() / 1000 : undefined
      }));

      return enrichedPeople;

    } catch (error) {
      console.error('Unexpected error getting competition entries:', error);
      return [];
    }
  }

  /**
   * Get list of people who have accepted a specific competition
   * Returns enriched person profiles from database
   */
  static async getAcceptedCompetitionEntries(offerSlug: string): Promise<any[]> {
    try {
      // Get all people who accepted this competition
      const { data: interactions, error } = await supabase
        .from('events_competition_interactions')
        .select('customer_cio_id, timestamp')
        .eq('offer_id', offerSlug)
        .eq('offer_status', 'accepted')
        .order('timestamp', { ascending: true });

      if (error) {
        console.error('Error getting competition entries:', error);
        return [];
      }

      if (!interactions || interactions.length === 0) {
        return [];
      }

      // Get unique person IDs (in case there are duplicates)
      const cioIds = [...new Set(interactions.map(i => i.customer_cio_id))];

      // Fetch person details from database
      const people = await this.getPeople(cioIds);

      // Map to PersonProfile format expected by the UI
      const enrichedPeople = people.map(person => ({
        cio_id: person.cio_id,
        email: person.email || '',
        first_name: person.attributes?.first_name || '',
        last_name: person.attributes?.last_name || '',
        company: person.attributes?.company || '',
        job_title: person.attributes?.job_title || '',
        city: person.attributes?.city || '',
        country: person.attributes?.country || '',
        created_at: person.created_at ? new Date(person.created_at).getTime() / 1000 : undefined
      }));

      return enrichedPeople;

    } catch (error) {
      console.error('Unexpected error getting competition entries:', error);
      return [];
    }
  }

  /**
   * Get activities for a person
   */
  static async getPersonActivities(cioId: string): Promise<PersonActivity[]> {
    try {
      const { data, error } = await supabase
        .from('people_activities')
        .select('*')
        .eq('customer_cio_id', cioId)
        .order('timestamp', { ascending: false });

      if (error) {
        console.error('Error fetching person activities:', error);
        return [];
      }

      return data || [];

    } catch (error) {
      console.error('Unexpected error fetching person activities:', error);
      return [];
    }
  }

  /**
   * Check if person needs sync (older than 5 minutes)
   */
  static async needsSync(cioId: string): Promise<boolean> {
    try {
      const person = await this.getPerson(cioId);

      if (!person || !person.last_synced_at) {
        return true;
      }

      const lastSync = new Date(person.last_synced_at);
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

      return lastSync < fiveMinutesAgo;

    } catch (error) {
      console.error('Error checking sync status:', error);
      return true;
    }
  }

  /**
   * Search people by email
   */
  static async searchPeople(searchTerm: string): Promise<Person[]> {
    try {
      const { data, error } = await supabase
        .from('people')
        .select('*')
        .ilike('email', `%${searchTerm}%`)
        .order('last_synced_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error searching people:', error);
        return [];
      }

      return data || [];

    } catch (error) {
      console.error('Unexpected error searching people:', error);
      return [];
    }
  }

  /**
   * Get a person by exact email address
   */
  static async getPersonByEmail(email: string): Promise<Person | null> {
    try {
      const { data, error } = await supabase
        .from('people')
        .select('*')
        .eq('email', email)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        console.error('Error getting person by email:', error);
        return null;
      }

      return data;

    } catch (error) {
      console.error('Unexpected error getting person by email:', error);
      return null;
    }
  }

  /**
   * Get paginated people with Supabase Auth accounts only
   */
  static async getAuthenticatedPeoplePaginated(
    page: number = 0,
    pageSize: number = 50,
    sortBy?: string,
    sortOrder: 'asc' | 'desc' = 'desc',
    searchTerm?: string
  ): Promise<{ people: Person[]; total: number }> {
    try {
      const offset = page * pageSize;

      // Use the database function for proper JSONB field sorting
      const { data, error } = await supabase.rpc('people_get_authenticated_sorted', {
        p_offset: offset,
        p_limit: pageSize,
        p_sort_by: sortBy || 'created_at',
        p_sort_order: sortOrder,
        p_search_term: searchTerm || null
      });

      if (error) {
        console.error('Error fetching authenticated people:', error);
        return { people: [], total: 0 };
      }

      // Extract total count from first row
      const total = data && data.length > 0 ? (data[0].total_count ?? 0) : 0;

      // Remove total_count from each row
      const people = (data || []).map(({ total_count, ...person }: any) => person);

      return { people, total };

    } catch (error) {
      console.error('Unexpected error fetching authenticated people:', error);
      return { people: [], total: 0 };
    }
  }

  /**
   * Get count of authenticated people with LinkedIn URLs
   */
  static async getAuthenticatedPeopleWithLinkedInCount(): Promise<number> {
    try {
      // Use RPC function to count efficiently with proper JSONB filtering
      const { data, error } = await supabase.rpc('people_count_with_linkedin');

      if (error) {
        console.error('Error counting people with LinkedIn:', error);
        return 0;
      }

      return data || 0;

    } catch (error) {
      console.error('Unexpected error counting people with LinkedIn:', error);
      return 0;
    }
  }

  /**
   * Link a person to their Supabase Auth user ID
   */
  static async linkAuthUser(
    cioId: string,
    authUserId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('people')
        .update({ auth_user_id: authUserId })
        .eq('cio_id', cioId);

      if (error) {
        console.error('Error linking auth user:', error);
        return { success: false, error: error.message };
      }

      return { success: true };

    } catch (error) {
      console.error('Unexpected error linking auth user:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update person data
   */
  static async updatePerson(
    id: number,
    data: Partial<Person>
  ): Promise<{ success: boolean; error?: string; person?: Person }> {
    try {
      const { data: person, error } = await supabase
        .from('people')
        .update(data)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Error updating person:', error);
        return { success: false, error: error.message };
      }

      return { success: true, person };

    } catch (error) {
      console.error('Unexpected error updating person:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Delete person (also deletes from Customer.io)
   * Cascades deletion through people_profiles, event_registrations, event_attendance
   */
  static async deletePerson(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // First, get the person to retrieve cio_id and people_profile_id
      const { data: person, error: fetchError } = await supabase
        .from('people')
        .select('cio_id, email')
        .eq('id', id)
        .single();

      if (fetchError) {
        console.error('Error fetching person for deletion:', fetchError);
        return { success: false, error: fetchError.message };
      }

      // Get people_profile_id for this person
      const { data: peopleProfile } = await supabase
        .from('people_profiles')
        .select('id')
        .eq('person_id', id)
        .maybeSingle();

      // If people profile exists, delete related records first
      if (peopleProfile) {
        // Delete event_attendance records (references people_profiles and event_registrations)
        const { error: attendanceError } = await supabase
          .from('events_attendance')
          .delete()
          .eq('people_profile_id', peopleProfile.id);

        if (attendanceError) {
          console.error('Error deleting event attendance:', attendanceError);
          return { success: false, error: attendanceError.message };
        }

        // Delete event_registrations records
        const { error: registrationsError } = await supabase
          .from('events_registrations')
          .delete()
          .eq('people_profile_id', peopleProfile.id);

        if (registrationsError) {
          console.error('Error deleting event registrations:', registrationsError);
          return { success: false, error: registrationsError.message };
        }

        // Delete people_profile
        const { error: profileError } = await supabase
          .from('people_profiles')
          .delete()
          .eq('id', peopleProfile.id);

        if (profileError) {
          console.error('Error deleting people profile:', profileError);
          return { success: false, error: profileError.message };
        }
      }

      // Delete from people table (trigger will delete auth user)
      const { error: deleteError } = await supabase
        .from('people')
        .delete()
        .eq('id', id);

      if (deleteError) {
        console.error('Error deleting person:', deleteError);
        return { success: false, error: deleteError.message };
      }

      // Delete from Customer.io if we have an email
      if (person?.email) {
        try {
          // Customer.io Track API credentials
          const CUSTOMERIO_SITE_ID = import.meta.env.VITE_CUSTOMERIO_SITE_ID;
          const CUSTOMERIO_API_KEY = import.meta.env.VITE_CUSTOMERIO_API_KEY;

          if (CUSTOMERIO_SITE_ID && CUSTOMERIO_API_KEY) {
            // Use email as identifier instead of cio_id
            const response = await fetch(
              `https://track.customer.io/api/v1/customers/${encodeURIComponent(person.email)}`,
              {
                method: 'DELETE',
                headers: {
                  'Authorization': 'Basic ' + btoa(`${CUSTOMERIO_SITE_ID}:${CUSTOMERIO_API_KEY}`),
                  'Content-Type': 'application/json'
                }
              }
            );

            if (!response.ok) {
              const responseText = await response.text();
              console.error(`Failed to delete from Customer.io: ${response.status} ${response.statusText}`, responseText);
              // Don't fail the overall deletion if Customer.io deletion fails
            }
          } else {
            console.warn('Customer.io credentials not configured - skipping Customer.io deletion');
          }
        } catch (cioError) {
          console.error('Error deleting from Customer.io:', cioError);
          // Don't fail the overall deletion if Customer.io deletion fails
        }
      }

      return { success: true };

    } catch (error) {
      console.error('Unexpected error deleting person:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get people with stored avatars in Supabase storage
   */
  static async getPeopleWithGravatar(): Promise<Person[]> {
    try {
      const allPeople: Person[] = [];
      let page = 0;
      const PAGE_SIZE = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('people')
          .select('*')
          .not('avatar_storage_path', 'is', null)
          .not('auth_user_id', 'is', null)
          .order('created_at', { ascending: false })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) {
          console.error('Error fetching people with stored avatars:', error);
          break;
        }

        if (data && data.length > 0) {
          allPeople.push(...data);
        }

        // Check if there are more people
        if (!data || data.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          page++;
        }
      }

      return allPeople;

    } catch (error) {
      console.error('Unexpected error fetching people with stored avatars:', error);
      return [];
    }
  }

  /**
   * Update person gravatar status
   */
  static async updateGravatarStatus(
    id: number,
    hasGravatar: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase.rpc('people_update_gravatar_status', {
        p_person_id: id,
        p_has_gravatar: hasGravatar
      });

      if (error) {
        console.error('Error updating gravatar status:', error);
        return { success: false, error: error.message };
      }

      return { success: true };

    } catch (error) {
      console.error('Unexpected error updating gravatar status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get avatar URL for a person with fallback logic
   */
  static getAvatarUrl(person: Person, size: number = 80): string | null {
    // If person has stored avatar, use it
    if (person.avatar_storage_path) {
      const { data } = supabase.storage
        .from('media')
        .getPublicUrl(person.avatar_storage_path);
      return data.publicUrl;
    }

    // No avatar available
    return null;
  }

  /**
   * Get fallback Gravatar URL (for display purposes only, not stored)
   */
  static getGravatarFallbackUrl(email: string, size: number = 80): string {
    const trimmedEmail = email.trim().toLowerCase();
    const hash = md5(trimmedEmail);
    return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=mp`;
  }
}
