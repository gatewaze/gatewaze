/**
 * Meetup Content Scheduler
 *
 * Schedules and coordinates processing of Meetup event page data.
 * Enqueues individual jobs for parallel processing by workers.
 */

import cron from 'node-cron';
import { supabase } from '../supabase-client.js';
import { getQueue, JobTypes } from '../lib/job-queue.js';

export class MeetupContentScheduler {
  constructor(config = {}) {
    this.config = {
      // How many events to process in each batch
      batchSize: config.batchSize || 50,
      // Minimum interval between job enqueues (ms)
      enqueueDelay: config.enqueueDelay || 100,
      ...config,
    };
    this.isRunning = false;
    this.cronJobs = [];
    this.queue = null;
    console.log('🔧 Meetup Content Scheduler initialized');
  }

  /**
   * Start the scheduler
   * - Daily at 4:30 AM: Process newly pending events
   * - Every 6 hours: Retry failed events
   * - Daily at 3:30 AM: Check for content changes
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Meetup Content Scheduler is already running');
      return;
    }

    console.log('🚀 Starting Meetup Content Scheduler...');
    this.isRunning = true;

    // Get queue instance
    this.queue = getQueue();

    // Job 1: Process pending events (daily at 4:30 AM, offset from Luma)
    const pendingEventsJob = cron.schedule('30 4 * * *', async () => {
      await this.processPendingEvents();
    });
    this.cronJobs.push(pendingEventsJob);
    console.log('✅ Meetup pending events job scheduled (daily at 4:30 AM)');

    // Job 2: Retry failed events (every 6 hours, offset by 30 min from Luma)
    const retryFailedJob = cron.schedule('30 */6 * * *', async () => {
      await this.retryFailedEvents();
    });
    this.cronJobs.push(retryFailedJob);
    console.log('✅ Meetup retry failed events job scheduled (every 6 hours at :30)');

    // Job 3: Check for content changes (daily at 3:30 AM)
    const changeDetectionJob = cron.schedule('30 3 * * *', async () => {
      await this.detectChangedEvents();
    });
    this.cronJobs.push(changeDetectionJob);
    console.log('✅ Meetup change detection job scheduled (daily at 3:30 AM)');

    console.log('✅ Meetup Content Scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop() {
    this.cronJobs.forEach((job) => job.stop());
    this.cronJobs = [];
    this.isRunning = false;
    console.log('🛑 Meetup Content Scheduler stopped');
  }

  /**
   * Process events with pending status
   */
  async processPendingEvents() {
    try {
      console.log('📋 Checking for pending Meetup content processing...');

      // Find events that need processing
      const { data: events, error } = await supabase
        .from('events')
        .select('id, event_title')
        .not('meetup_page_data', 'is', null)
        .or('meetup_processing_status.is.null,meetup_processing_status.eq.pending')
        .limit(this.config.batchSize);

      if (error) {
        console.error('Error finding pending Meetup events:', error);
        return;
      }

      if (!events || events.length === 0) {
        console.log('✅ No pending Meetup events to process');
        return;
      }

      console.log(`📝 Found ${events.length} Meetup events to process`);

      // Enqueue individual jobs for each event
      for (const event of events) {
        await this.enqueueContentJob(event.id, event.event_title);

        // Small delay between enqueues to avoid queue spam
        await new Promise((resolve) => setTimeout(resolve, this.config.enqueueDelay));
      }

      console.log(`✅ Enqueued ${events.length} Meetup content processing jobs`);
    } catch (error) {
      console.error('Error processing pending Meetup events:', error);
    }
  }

  /**
   * Retry events that previously failed
   */
  async retryFailedEvents() {
    try {
      console.log('🔄 Checking for failed Meetup events to retry...');

      // Find failed events (limit retries to recent failures)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: events, error } = await supabase
        .from('events')
        .select('id, event_title')
        .not('meetup_page_data', 'is', null)
        .eq('meetup_processing_status', 'failed')
        .gte('updated_at', oneDayAgo)
        .limit(this.config.batchSize);

      if (error) {
        console.error('Error finding failed Meetup events:', error);
        return;
      }

      if (!events || events.length === 0) {
        console.log('✅ No failed Meetup events to retry');
        return;
      }

      console.log(`🔄 Found ${events.length} failed Meetup events to retry`);

      // Reset status to pending and enqueue
      for (const event of events) {
        await supabase.from('events').update({ meetup_processing_status: 'pending' }).eq('id', event.id);

        await this.enqueueContentJob(event.id, event.event_title, { isRetry: true });

        await new Promise((resolve) => setTimeout(resolve, this.config.enqueueDelay));
      }

      console.log(`✅ Enqueued ${events.length} Meetup retry jobs`);
    } catch (error) {
      console.error('Error retrying failed Meetup events:', error);
    }
  }

  /**
   * Detect events with changed content (hash mismatch)
   */
  async detectChangedEvents() {
    try {
      console.log('🔍 Checking for changed Meetup content...');

      // Find completed events to check for changes
      const { data: events, error } = await supabase
        .from('events')
        .select('id, event_title, meetup_page_data, meetup_page_data_hash')
        .not('meetup_page_data', 'is', null)
        .eq('meetup_processing_status', 'completed')
        .limit(this.config.batchSize);

      if (error) {
        console.error('Error finding Meetup events for change detection:', error);
        return;
      }

      if (!events || events.length === 0) {
        console.log('✅ No completed Meetup events to check');
        return;
      }

      let changedCount = 0;
      const crypto = await import('crypto');

      for (const event of events) {
        // Extract description from meetup_page_data
        const description =
          event.meetup_page_data?.props?.pageProps?.event?.description ||
          event.meetup_page_data?.pageProps?.event?.description ||
          event.meetup_page_data?.event?.description;

        if (!description) continue;

        const currentHash = crypto.createHash('md5').update(description).digest('hex');

        if (currentHash !== event.meetup_page_data_hash) {
          console.log(`📝 Content changed for Meetup event: ${event.event_title}`);

          await supabase.from('events').update({ meetup_processing_status: 'pending' }).eq('id', event.id);

          await this.enqueueContentJob(event.id, event.event_title, { isReprocess: true });

          changedCount++;
          await new Promise((resolve) => setTimeout(resolve, this.config.enqueueDelay));
        }
      }

      console.log(`✅ Found ${changedCount} Meetup events with changed content`);
    } catch (error) {
      console.error('Error detecting changed Meetup events:', error);
    }
  }

  /**
   * Enqueue a content processing job
   * @param {string} eventId - Event UUID
   * @param {string} eventTitle - Event title for logging
   * @param {Object} options - Additional job options
   */
  async enqueueContentJob(eventId, eventTitle, options = {}) {
    try {
      if (!this.queue) {
        this.queue = getQueue();
      }

      await this.queue.add(
        JobTypes.MEETUP_CONTENT_PROCESS,
        {
          eventId,
          eventTitle,
          ...options,
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            age: 24 * 3600, // Keep for 24 hours
            count: 1000,
          },
          removeOnFail: {
            age: 7 * 24 * 3600, // Keep failed for 7 days
          },
        }
      );

      console.log(`  📤 Enqueued Meetup job for: ${eventTitle || eventId}`);
    } catch (error) {
      console.error(`Failed to enqueue Meetup job for ${eventId}:`, error);
    }
  }

  /**
   * Manually trigger processing for a specific event
   * @param {string} eventId - Event UUID
   */
  async processEventNow(eventId) {
    const { data: event, error } = await supabase
      .from('events')
      .select('id, event_title')
      .eq('id', eventId)
      .single();

    if (error || !event) {
      throw new Error(`Event not found: ${eventId}`);
    }

    // Reset status and enqueue
    await supabase.from('events').update({ meetup_processing_status: 'pending' }).eq('id', eventId);

    await this.enqueueContentJob(event.id, event.event_title, { manual: true });

    return { queued: true, eventTitle: event.event_title };
  }
}

export default MeetupContentScheduler;
