import cron from 'node-cron';
import { supabase } from '../supabase-client.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Conditionally import job queue if Redis is available
let jobQueue = null;
if (process.env.REDIS_URL) {
  try {
    const module = await import('../lib/job-queue.js');
    jobQueue = module;
    console.log('✅ Job queue available - jobs will be enqueued to Redis');
  } catch (error) {
    console.log('⚠️ Job queue not available - running jobs in-process');
  }
}

/**
 * Scraper Scheduler Service
 * Checks for scrapers that are due to run based on their schedule
 * and creates scraper jobs for them
 * Also handles periodic Customer.io sync tasks
 */
export class ScraperScheduler {
  constructor(config = {}) {
    this.config = config;
    this.isRunning = false;
    this.cronJob = null;
    this.customerioJobs = [];
    this.supabase = supabase;
    this.runningSyncs = new Set(); // Track running sync jobs to prevent overlaps
    console.log('🔧 Scraper Scheduler initialized');
  }

  /**
   * Start the scheduler
   * Checks every minute for scrapers that need to run
   * Also starts Customer.io sync jobs
   * Only runs in production environment (NODE_ENV=production)
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Scheduler is already running');
      return;
    }

    // Check if we're in production environment
    const isProduction = process.env.NODE_ENV === 'production';

    if (!isProduction) {
      console.log('⏭️  Scraper scheduler disabled (not in production environment)');
      console.log('   Set NODE_ENV=production to enable automatic scraper scheduling');
      console.log('   Manual scraper runs are still available via the admin UI');
      return;
    }

    console.log('🚀 Starting Scraper Scheduler (production mode)...');
    this.isRunning = true;

    // Run immediately on start
    this.checkAndRunDueScrapers();

    // Then check every minute
    this.cronJob = cron.schedule('* * * * *', async () => {
      await this.checkAndRunDueScrapers();
    });

    // Start Customer.io sync jobs
    this.startCustomerioSyncJobs();

    console.log('✅ Scheduler started - checking every minute for due scrapers');
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    // Stop all Customer.io sync jobs
    this.customerioJobs.forEach(job => job.stop());
    this.customerioJobs = [];

    this.isRunning = false;
    console.log('🛑 Scheduler stopped');
  }

  /**
   * Check for scrapers that are due to run and create jobs for them
   */
  async checkAndRunDueScrapers() {
    try {
      // Get scrapers that are due for a run
      const { data: dueScrapers, error } = await this.supabase
        .rpc('get_scrapers_due_for_run');

      if (error) {
        console.error('❌ Error fetching due scrapers:', error);
        return;
      }

      if (!dueScrapers || dueScrapers.length === 0) {
        // No scrapers due - this is normal, don't log
        return;
      }

      console.log(`📋 Found ${dueScrapers.length} scraper(s) due to run`);

      for (const scraper of dueScrapers) {
        await this.runScraper(scraper);
      }
    } catch (error) {
      console.error('❌ Error in checkAndRunDueScrapers:', error);
    }
  }

  /**
   * Create a scraper job and update next scheduled run time
   * If job queue is available, enqueues to Redis. Otherwise starts via API.
   */
  async runScraper(scraper) {
    try {
      console.log(`🎯 Creating scheduled job for scraper: ${scraper.name}`);

      // If job queue is available, enqueue to Redis
      if (jobQueue) {
        // First, create a scraper_job record in the database
        const { data: jobData, error: jobError } = await this.supabase
          .rpc('create_scraper_job', {
            scraper_ids: [scraper.id],
            created_by_user: 'scheduler'
          });

        if (jobError) {
          console.error(`❌ Failed to create scraper job for ${scraper.name}:`, jobError);
          return;
        }

        if (!jobData || jobData.length === 0) {
          console.error(`❌ No job data returned for ${scraper.name}`);
          return;
        }

        const scraperJobId = jobData[0].job_id || jobData[0].id;
        console.log(`✅ Created scraper job ${scraperJobId} for ${scraper.name}`);

        // Fetch additional scraper details if not already available
        let scraperType = scraper.scraper_type;
        let eventType = scraper.event_type;

        if (!scraperType || !eventType) {
          const { data: scraperDetails } = await this.supabase
            .from('scrapers')
            .select('scraper_type, event_type')
            .eq('id', scraper.id)
            .single();

          if (scraperDetails) {
            scraperType = scraperDetails.scraper_type;
            eventType = scraperDetails.event_type;
          }
        }

        // Now enqueue the job with the scraperJobId
        await jobQueue.addJob(jobQueue.JobTypes.SCRAPER_RUN, {
          scraperJobId,
          scraperId: scraper.id,
          scraperName: scraper.name,
          scraperType,
          eventType,
          brand: process.env.BRAND || 'default',
          scheduled: true,
        });
        console.log(`📥 Scraper job enqueued: ${scraper.name} (job ${scraperJobId})`);

        // Calculate and update next scheduled run time
        const nextRun = this.calculateNextRun(scraper);
        if (nextRun) {
          await this.updateNextScheduledRun(scraper.id, nextRun);
        }
        return;
      }

      // Fall back to API-based job creation
      // Create scraper job
      const { data: jobData, error: jobError } = await this.supabase
        .rpc('create_scraper_job', {
          scraper_ids: [scraper.id],
          created_by_user: 'scheduler'
        });

      if (jobError) {
        console.error(`❌ Failed to create job for ${scraper.name}:`, jobError);
        return;
      }

      if (!jobData || jobData.length === 0) {
        console.error(`❌ No job data returned for ${scraper.name}`);
        return;
      }

      const jobId = jobData[0].job_id || jobData[0].id;
      console.log(`✅ Created job for ${scraper.name}, job ID: ${jobId}`);

      // Start the job via API
      try {
        const apiPort = process.env.API_PORT || 3002;
        const response = await fetch(`http://localhost:${apiPort}/api/scrapers/${jobId}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
          const error = await response.json();
          console.error(`❌ Failed to start job ${jobId}:`, error);
        } else {
          console.log(`✅ Started job ${jobId} for ${scraper.name}`);
        }
      } catch (startError) {
        console.error(`❌ Error starting job ${jobId}:`, startError);
      }

      // Calculate and update next scheduled run time
      const nextRun = this.calculateNextRun(scraper);
      if (nextRun) {
        await this.updateNextScheduledRun(scraper.id, nextRun);
      }
    } catch (error) {
      console.error(`❌ Error running scraper ${scraper.name}:`, error);
    }
  }

  /**
   * Calculate next scheduled run time based on frequency
   */
  calculateNextRun(scraper) {
    const now = new Date();

    switch (scraper.schedule_frequency) {
      case '5min':
        return new Date(now.getTime() + 5 * 60 * 1000); // +5 minutes

      case 'hourly':
        return new Date(now.getTime() + 60 * 60 * 1000); // +1 hour

      case 'daily':
        return this.calculateDailyNextRun(now, scraper.schedule_time);

      case 'weekly':
        return this.calculateWeeklyNextRun(now, scraper.schedule_time, scraper.schedule_days);

      case 'custom':
        // For custom cron, we'll calculate based on the expression
        // For now, null it out and let the cron expression handle timing
        return null;

      default:
        return null;
    }
  }

  /**
   * Calculate next run for daily schedule at specific time
   */
  calculateDailyNextRun(now, scheduleTime) {
    if (!scheduleTime) {
      // If no time specified, default to 24 hours from now
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }

    // Parse schedule_time (format: "HH:MM:SS" or "HH:MM")
    const [hours, minutes] = scheduleTime.split(':').map(Number);

    // Create next run date at the specified time today
    const nextRun = new Date(now);
    nextRun.setHours(hours, minutes, 0, 0);

    // If that time has already passed today, schedule for tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    return nextRun;
  }

  /**
   * Calculate next run for weekly schedule on specific days at specific time
   */
  calculateWeeklyNextRun(now, scheduleTime, scheduleDays) {
    if (!scheduleDays || scheduleDays.length === 0) {
      // If no days specified, default to 7 days from now
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    // Parse schedule_time (format: "HH:MM:SS" or "HH:MM")
    const [hours, minutes] = scheduleTime ? scheduleTime.split(':').map(Number) : [9, 0];

    // Get current day of week (0 = Sunday, 6 = Saturday)
    const currentDay = now.getDay();

    // Sort schedule days
    const sortedDays = [...scheduleDays].sort((a, b) => a - b);

    // Find the next scheduled day
    let nextDay = null;

    // First, check if there's a day later this week
    for (const day of sortedDays) {
      if (day > currentDay) {
        nextDay = day;
        break;
      } else if (day === currentDay) {
        // Check if the time hasn't passed yet today
        const todayAtScheduledTime = new Date(now);
        todayAtScheduledTime.setHours(hours, minutes, 0, 0);
        if (todayAtScheduledTime > now) {
          nextDay = day;
          break;
        }
      }
    }

    // If no day found this week, use the first scheduled day next week
    if (nextDay === null) {
      nextDay = sortedDays[0] + 7; // Add 7 to move to next week
    }

    // Calculate days until next run
    const daysUntilRun = nextDay > currentDay ? nextDay - currentDay : nextDay;

    // Create next run date
    const nextRun = new Date(now);
    nextRun.setDate(nextRun.getDate() + daysUntilRun);
    nextRun.setHours(hours, minutes, 0, 0);

    return nextRun;
  }

  /**
   * Update next scheduled run time in database
   */
  async updateNextScheduledRun(scraperId, nextRun) {
    try {
      const { error } = await this.supabase
        .from('scrapers')
        .update({ next_scheduled_run: nextRun.toISOString() })
        .eq('id', scraperId);

      if (error) {
        console.error(`❌ Failed to update next_scheduled_run for scraper ${scraperId}:`, error);
      } else {
        console.log(`📅 Next run for scraper ${scraperId} scheduled for ${nextRun.toISOString()}`);
      }
    } catch (error) {
      console.error(`❌ Error updating next_scheduled_run:`, error);
    }
  }

  /**
   * Calculate and set next run time for a scraper (useful when schedule is updated)
   */
  async initializeNextRun(scraperId) {
    try {
      // Fetch scraper details
      const { data: scraper, error } = await this.supabase
        .from('scrapers')
        .select('id, name, schedule_frequency, schedule_time, schedule_days, schedule_cron')
        .eq('id', scraperId)
        .single();

      if (error || !scraper) {
        console.error(`❌ Failed to fetch scraper ${scraperId}:`, error);
        return;
      }

      // Calculate next run
      const nextRun = this.calculateNextRun(scraper);
      if (nextRun) {
        await this.updateNextScheduledRun(scraperId, nextRun);
        console.log(`📅 Initialized next run for scraper ${scraper.name}: ${nextRun.toISOString()}`);
      }
    } catch (error) {
      console.error(`❌ Error initializing next run for scraper ${scraperId}:`, error);
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkInterval: '1 minute',
      customerioJobs: this.customerioJobs.length,
      runningSyncs: Array.from(this.runningSyncs)
    };
  }

  /**
   * Start Customer.io sync jobs with configurable schedules
   * DISABLED: Customer.io sync jobs are no longer needed
   */
  startCustomerioSyncJobs() {
    console.log('⏭️  Customer.io sync jobs disabled (no longer needed)');
    return;
  }

  /**
   * Run a Customer.io sync command
   * If job queue is available, enqueues to Redis. Otherwise runs in-process.
   */
  async runCustomerioSync(syncType, command) {
    // Check if this sync type is already running
    if (this.runningSyncs.has(syncType)) {
      console.log(`⏭️  Skipping Customer.io ${syncType} sync - already running`);
      return;
    }

    // If job queue is available, enqueue to Redis
    if (jobQueue) {
      const jobTypeMap = {
        'customers': jobQueue.JobTypes.CUSTOMERIO_SYNC_INCREMENTAL,
        'segments': jobQueue.JobTypes.CUSTOMERIO_SYNC_SEGMENTS,
        'activities': jobQueue.JobTypes.CUSTOMERIO_SYNC_ACTIVITIES,
      };

      const jobType = jobTypeMap[syncType];
      if (jobType) {
        await jobQueue.addJob(jobType, {
          brand: process.env.BRAND || 'default',
          syncType,
          scheduled: true,
        });
        console.log(`📥 Customer.io ${syncType} sync enqueued to job queue`);
        return;
      }
    }

    // Fall back to in-process execution
    // Mark as running
    this.runningSyncs.add(syncType);

    // Run sync in background without blocking (fire-and-forget)
    this.executeCustomerioSync(syncType, command)
      .finally(() => {
        // Always remove from running set when done
        this.runningSyncs.delete(syncType);
      });

    console.log(`🚀 Customer.io ${syncType} sync started in background`);
  }

  /**
   * Execute the actual Customer.io sync command
   * This runs in the background and won't block the scheduler
   */
  async executeCustomerioSync(syncType, command) {
    let jobId = null;

    try {
      console.log(`🔄 Executing Customer.io ${syncType} sync...`);

      // Create sync job record in database
      const { data: jobData, error: jobError } = await this.supabase
        .rpc('create_sync_job', {
          p_sync_type: syncType,
          p_metadata: { command, scheduled: true }
        });

      if (jobError) {
        console.error(`❌ Failed to create sync job record:`, jobError);
      } else {
        jobId = jobData;
        console.log(`📝 Created sync job record ID: ${jobId}`);
      }

      const startTime = Date.now();

      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large outputs
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      // Parse output for statistics
      const stats = this.parseCustomerioSyncOutput(stdout);

      if (stdout) {
        console.log(`📊 Customer.io ${syncType} sync output:`, stdout.substring(0, 500));
      }
      if (stderr) {
        console.error(`⚠️ Customer.io ${syncType} sync warnings:`, stderr.substring(0, 500));
      }

      // Update job as completed
      if (jobId) {
        await this.supabase.rpc('update_sync_job', {
          p_job_id: jobId,
          p_status: 'completed',
          p_items_processed: stats.processed || 0,
          p_items_created: stats.created || 0,
          p_items_updated: stats.updated || 0,
          p_items_failed: stats.failed || 0
        });
      }

      console.log(`✅ Customer.io ${syncType} sync completed in ${duration}s`);
      console.log(`   Processed: ${stats.processed}, Created: ${stats.created}, Updated: ${stats.updated}, Failed: ${stats.failed}`);
    } catch (error) {
      console.error(`❌ Customer.io ${syncType} sync failed:`, error.message);

      // Update job as failed
      if (jobId) {
        await this.supabase.rpc('update_sync_job', {
          p_job_id: jobId,
          p_status: 'failed',
          p_error_message: error.message
        });
      }

      if (error.stdout) {
        console.log('Output:', error.stdout.substring(0, 500));
      }
      if (error.stderr) {
        console.error('Error output:', error.stderr.substring(0, 500));
      }
    }
  }

  /**
   * Parse Customer.io sync output to extract statistics
   */
  parseCustomerioSyncOutput(output) {
    const stats = {
      processed: 0,
      created: 0,
      updated: 0,
      failed: 0
    };

    if (!output) return stats;

    // Look for common patterns in sync output
    const processedMatch = output.match(/processed[:\s]+(\d+)/i);
    const createdMatch = output.match(/created[:\s]+(\d+)/i);
    const updatedMatch = output.match(/updated[:\s]+(\d+)/i);
    const failedMatch = output.match(/failed[:\s]+(\d+)/i);

    if (processedMatch) stats.processed = parseInt(processedMatch[1], 10);
    if (createdMatch) stats.created = parseInt(createdMatch[1], 10);
    if (updatedMatch) stats.updated = parseInt(updatedMatch[1], 10);
    if (failedMatch) stats.failed = parseInt(failedMatch[1], 10);

    return stats;
  }
}
