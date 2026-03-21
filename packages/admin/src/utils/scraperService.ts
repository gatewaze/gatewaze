import { supabase } from '@/lib/supabase';
import { getApiBaseUrl } from '@/config/brands';

export interface Scraper {
  id: number;
  name: string;
  description?: string;
  scraper_type: string;
  object_type: 'events' | 'jobs'; // Type of object this scraper collects
  event_type: string; // For events: 'conference' or 'meetup'. For jobs: company name or category
  base_url: string;
  enabled: boolean;
  account?: string; // Organization/account name for all items from this scraper
  last_run?: string;
  last_success?: string;
  last_error?: string;
  total_items_scraped: number; // Total items scraped (events, jobs, etc.)
  config: Record<string, any>;
  latest_job_status?: string;
  latest_job_id?: number;
  created_at: string;
  updated_at: string;
  // Scheduling fields
  schedule_enabled?: boolean;
  schedule_frequency?: 'none' | '5min' | 'hourly' | 'daily' | 'weekly' | 'custom';
  schedule_time?: string;
  schedule_days?: number[];
  schedule_cron?: string;
  next_scheduled_run?: string;
}

export interface ScraperJob {
  id: number;
  scraper_id: number;
  scraper_name: string;
  scraper_type: string;
  object_type?: 'events' | 'jobs'; // Type of object this scraper collects
  event_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  // Generic item counts (backwards compatible with old column names)
  items_found?: number;
  items_processed?: number;
  items_skipped?: number;
  items_failed?: number;
  // Legacy event-specific names (for backwards compatibility)
  events_found?: number;
  events_processed?: number;
  events_skipped?: number;
  events_failed?: number;
  error_message?: string;
  log_output?: string;
  created_by: string;
}

// Get API base URL dynamically based on environment
const getApiBase = () => {
  const baseUrl = getApiBaseUrl();
  // In development, return the full base URL (e.g., http://localhost:3003)
  // In production, return the full base URL (e.g., https://api.example.com)
  // Ensure the URL is absolute to prevent relative path issues
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    console.error('Invalid API base URL (must be absolute):', baseUrl);
    throw new Error('API base URL must be an absolute URL (http:// or https://)');
  }
  return baseUrl;
};

export class ScraperService {
  /**
   * Check if we're in a production environment
   */
  private static isProduction(): boolean {
    return !import.meta.env.DEV;
  }

  /**
   * Check if scrapers can be scheduled (production only)
   */
  static canScheduleScrapers(): boolean {
    return this.isProduction();
  }

  /**
   * Get all scrapers with their latest job status
   */
  static async getAllScrapers(): Promise<{ data: Scraper[] | null; error: any }> {
    try {
      const { data, error } = await supabase.rpc('scrapers_get_with_status');

      if (error) {
        console.error('Error fetching scrapers:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error in getAllScrapers:', error);
      return { data: null, error };
    }
  }

  /**
   * Create scraper jobs for selected scrapers
   */
  static async createScraperJobs(
    scraperIds: number[],
    createdBy: string = 'admin'
  ): Promise<{ data: any; error: any }> {
    try {
      const { data, error } = await supabase.rpc('scrapers_create_job', {
        scraper_ids: scraperIds,
        created_by_user: createdBy
      });

      if (error) {
        console.error('Error creating scraper jobs:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error in createScraperJobs:', error);
      return { data: null, error };
    }
  }

  /**
   * Start a scraper job
   */
  static async startJob(jobId: number): Promise<{ success: boolean; error: any }> {
    try {
      const response = await fetch(`${getApiBase()}/scrapers/${jobId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to start job' };
      }

      return { success: true, error: null };
    } catch (error) {
      console.error('Error starting job:', error);
      return { success: false, error };
    }
  }

  /**
   * Create a new scraper
   */
  static async createScraper(scraper: Omit<Scraper, 'id' | 'created_at' | 'updated_at' | 'total_items_scraped'>): Promise<{ data: Scraper | null; error: any }> {
    try {
      const { data, error } = await supabase
        .from('scrapers')
        .insert([{
          name: scraper.name,
          description: scraper.description,
          scraper_type: scraper.scraper_type,
          event_type: scraper.event_type,
          base_url: scraper.base_url,
          enabled: scraper.enabled ?? false,
          config: scraper.config || {}
        }])
        .select()
        .single();

      if (error) {
        console.error('Error creating scraper:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error in createScraper:', error);
      return { data: null, error };
    }
  }

  /**
   * Update an existing scraper
   */
  static async updateScraper(scraperId: number, updates: Partial<Scraper>): Promise<{ data: Scraper | null; error: any }> {
    try {
      const { data, error } = await supabase
        .from('scrapers')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', scraperId)
        .select()
        .single();

      if (error) {
        console.error('Error updating scraper:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error in updateScraper:', error);
      return { data: null, error };
    }
  }

  /**
   * Delete a scraper job
   */
  static async deleteJob(jobId: number): Promise<{ success: boolean; error: any }> {
    try {
      const { error } = await supabase
        .from('scrapers_jobs')
        .delete()
        .eq('id', jobId);

      if (error) {
        console.error('Error deleting job:', error);
        return { success: false, error };
      }

      return { success: true, error: null };
    } catch (error) {
      console.error('Error in deleteJob:', error);
      return { success: false, error };
    }
  }

  /**
   * Delete multiple scraper jobs
   */
  static async deleteJobs(jobIds: number[]): Promise<{ success: boolean; error: any; deleted?: number }> {
    try {
      const { error, count } = await supabase
        .from('scrapers_jobs')
        .delete({ count: 'exact' })
        .in('id', jobIds);

      if (error) {
        console.error('Error deleting jobs:', error);
        return { success: false, error, deleted: 0 };
      }

      return { success: true, error: null, deleted: count || 0 };
    } catch (error) {
      console.error('Error in deleteJobs:', error);
      return { success: false, error, deleted: 0 };
    }
  }

  /**
   * Delete all pending jobs
   */
  static async deletePendingJobs(): Promise<{ success: boolean; error: any; deleted?: number }> {
    try {
      const { error, count } = await supabase
        .from('scrapers_jobs')
        .delete({ count: 'exact' })
        .eq('status', 'pending');

      if (error) {
        console.error('Error deleting pending jobs:', error);
        return { success: false, error, deleted: 0 };
      }

      return { success: true, error: null, deleted: count || 0 };
    } catch (error) {
      console.error('Error in deletePendingJobs:', error);
      return { success: false, error, deleted: 0 };
    }
  }

  /**
   * Get scraper job details
   */
  static async getScraperJob(jobId: number): Promise<{ data: ScraperJob | null; error: any }> {
    try {
      const { data, error } = await supabase.rpc('scrapers_get_job', {
        job_id: jobId
      });

      if (error) {
        console.error('Error fetching scraper job:', error);
        return { data: null, error };
      }

      return { data: data?.[0] || null, error: null };
    } catch (error) {
      console.error('Error in getScraperJob:', error);
      return { data: null, error };
    }
  }

  /**
   * Update scraper job progress
   */
  static async updateScraperJob(
    jobId: number,
    updates: {
      status?: string;
      events_found?: number;
      events_processed?: number;
      events_skipped?: number;
      events_failed?: number;
      error_message?: string;
      log_output?: string;
    }
  ): Promise<{ success: boolean; error: any }> {
    try {
      const { data, error } = await supabase.rpc('scrapers_update_job', {
        job_id: jobId,
        new_status: updates.status || null,
        events_found_count: updates.events_found || null,
        events_processed_count: updates.events_processed || null,
        events_skipped_count: updates.events_skipped || null,
        events_failed_count: updates.events_failed || null,
        error_msg: updates.error_message || null,
        log_text: updates.log_output || null
      });

      if (error) {
        console.error('Error updating scraper job:', error);
        return { success: false, error };
      }

      return { success: true, error: null };
    } catch (error) {
      console.error('Error in updateScraperJob:', error);
      return { success: false, error };
    }
  }

  /**
   * Toggle scraper enabled status
   */
  static async toggleScraper(scraperId: number, enabled: boolean): Promise<{ success: boolean; error: any }> {
    try {
      const { data, error } = await supabase
        .from('scrapers')
        .update({
          enabled,
          updated_at: new Date().toISOString()
        })
        .eq('id', scraperId);

      if (error) {
        console.error('Error toggling scraper:', error);
        return { success: false, error };
      }

      return { success: true, error: null };
    } catch (error) {
      console.error('Error in toggleScraper:', error);
      return { success: false, error };
    }
  }

  /**
   * Update scraper configuration
   */
  static async updateScraperConfig(
    scraperId: number,
    config: Record<string, any>
  ): Promise<{ success: boolean; error: any }> {
    try {
      const { data, error } = await supabase
        .from('scrapers')
        .update({
          config,
          updated_at: new Date().toISOString()
        })
        .eq('id', scraperId);

      if (error) {
        console.error('Error updating scraper config:', error);
        return { success: false, error };
      }

      return { success: true, error: null };
    } catch (error) {
      console.error('Error in updateScraperConfig:', error);
      return { success: false, error };
    }
  }

  /**
   * Get recent scraper jobs with pagination and filtering
   */
  static async getRecentJobs(
    limit: number = 20,
    offset: number = 0,
    statusFilter?: string,
    sortColumn?: 'status' | 'started_at' | 'scraper_name',
    sortDirection: 'asc' | 'desc' = 'desc'
  ): Promise<{ data: ScraperJob[] | null; error: any; total?: number }> {
    try {
      let query = supabase
        .from('scrapers_jobs')
        .select(`
          id,
          scraper_id,
          status,
          started_at,
          completed_at,
          items_found,
          items_processed,
          items_skipped,
          items_failed,
          error_message,
          created_by,
          scrapers (
            name,
            scraper_type,
            event_type,
            object_type
          )
        `, { count: 'exact' });

      // Filter by status if provided
      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }

      // Apply sorting based on column
      // Note: We can't sort by scraper_name at the DB level since it's a join
      // So we'll sort client-side for that case
      if (sortColumn === 'status') {
        query = query.order('status', { ascending: sortDirection === 'asc' });
      } else if (sortColumn === 'started_at' || !sortColumn) {
        query = query.order('started_at', { ascending: sortDirection === 'asc' });
      } else {
        // Default sort for scraper_name (will be sorted client-side)
        query = query.order('started_at', { ascending: false });
      }

      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        console.error('Error fetching recent jobs:', error);
        return { data: null, error, total: 0 };
      }

      // Transform the data to match ScraperJob interface
      const transformedData = data?.map(job => {
        const scraperInfo = job.scrapers as any;
        return {
          id: job.id,
          scraper_id: job.scraper_id,
          scraper_name: scraperInfo?.name || 'Unknown Scraper',
          scraper_type: scraperInfo?.scraper_type || 'unknown',
          object_type: scraperInfo?.object_type || 'events',
          event_type: scraperInfo?.event_type || 'unknown',
          status: job.status,
          started_at: job.started_at,
          completed_at: job.completed_at,
          items_found: job.items_found || 0,
          items_processed: job.items_processed || 0,
          items_skipped: job.items_skipped || 0,
          items_failed: job.items_failed || 0,
          error_message: job.error_message,
          log_output: '',
          created_by: job.created_by
        };
      }).filter(job => job.scraper_name !== 'Unknown Scraper') || [];

      // Only sort client-side if sorting by scraper_name (can't do this at DB level)
      let resultData = transformedData;
      if (sortColumn === 'scraper_name') {
        resultData = transformedData.sort((a, b) => {
          const aName = a.scraper_name.toLowerCase();
          const bName = b.scraper_name.toLowerCase();
          if (sortDirection === 'asc') {
            return aName.localeCompare(bName);
          } else {
            return bName.localeCompare(aName);
          }
        });
      }

      return { data: resultData, error: null, total: count || 0 };
    } catch (error) {
      console.error('Error in getRecentJobs:', error);
      return { data: null, error };
    }
  }

  /**
   * Get active jobs from API server
   */
  static async getActiveJobs(): Promise<{ data: any[] | null; error: any }> {
    try {
      const response = await fetch(`${getApiBase()}/scrapers/active`);
      const data = await response.json();

      if (!response.ok) {
        return { data: null, error: data.error || 'Failed to get active jobs' };
      }

      return { data: data.activeJobs || [], error: null };
    } catch (error) {
      console.error('Error getting active jobs:', error);
      return { data: null, error };
    }
  }

  /**
   * Stop a running job
   */
  static async stopJob(jobId: number): Promise<{ success: boolean; error: any }> {
    try {
      const response = await fetch(`${getApiBase()}/scrapers/${jobId}/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to stop job' };
      }

      return { success: true, error: null };
    } catch (error) {
      console.error('Error stopping job:', error);
      return { success: false, error };
    }
  }

  /**
   * Get job details including logs
   */
  static async getJobDetails(jobId: number): Promise<{ data: any | null; error: any }> {
    try {
      const response = await fetch(`${getApiBase()}/scrapers/${jobId}/details`);
      const data = await response.json();

      if (!response.ok) {
        return { data: null, error: data.error || 'Failed to get job details' };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error getting job details:', error);
      return { data: null, error };
    }
  }

  /**
   * Get scraper statistics
   */
  static async getScraperStats(): Promise<{
    data: {
      total_scrapers: number;
      enabled_scrapers: number;
      total_items_scraped: number;
      jobs_last_24h: number;
      successful_jobs_last_24h: number;
    } | null;
    error: any;
  }> {
    try {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      const [scrapersResult, jobsResult] = await Promise.all([
        supabase
          .from('scrapers')
          .select('enabled, total_items_scraped'),
        supabase
          .from('scrapers_jobs')
          .select('status')
          .gte('started_at', twentyFourHoursAgo.toISOString())
      ]);

      if (scrapersResult.error) {
        return { data: null, error: scrapersResult.error };
      }

      if (jobsResult.error) {
        return { data: null, error: jobsResult.error };
      }

      const scrapers = scrapersResult.data || [];
      const jobs = jobsResult.data || [];

      const stats = {
        total_scrapers: scrapers.length,
        enabled_scrapers: scrapers.filter(s => s.enabled).length,
        total_items_scraped: scrapers.reduce((sum, s) => sum + (s.total_items_scraped || 0), 0),
        jobs_last_24h: jobs.length,
        successful_jobs_last_24h: jobs.filter(j => j.status === 'completed').length
      };

      return { data: stats, error: null };
    } catch (error) {
      console.error('Error in getScraperStats:', error);
      return { data: null, error };
    }
  }

}