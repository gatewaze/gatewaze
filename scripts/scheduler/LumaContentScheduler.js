/**
 * Luma Content Scheduler
 *
 * Schedules and coordinates processing of Luma event page data.
 * Enqueues individual jobs for parallel processing by workers.
 */

import cron from 'node-cron';
import { supabase } from '../supabase-client.js';
import { getQueue, JobTypes } from '../lib/job-queue.js';

export class LumaContentScheduler {
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
    console.log('🔧 Luma Content Scheduler initialized');
  }

  /**
   * Start the scheduler
   * - Daily at 4 AM: Process newly pending events
   * - Every 6 hours: Retry failed events
   * - Daily at 3 AM: Check for content changes
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Luma Content Scheduler is already running');
      return;
    }

    console.log('🚀 Starting Luma Content Scheduler...');
    this.isRunning = true;

    // Get queue instance
    this.queue = getQueue();

    // Job 1: Process pending events (daily at 4 AM)
    const pendingEventsJob = cron.schedule('0 4 * * *', async () => {
      await this.processPendingEvents();
    });
    this.cronJobs.push(pendingEventsJob);
    console.log('✅ Pending events job scheduled (daily at 4 AM)');

    // Job 2: Retry failed events (every 6 hours)
    const retryFailedJob = cron.schedule('0 */6 * * *', async () => {
      await this.retryFailedEvents();
    });
    this.cronJobs.push(retryFailedJob);
    console.log('✅ Retry failed events job scheduled (every 6 hours)');

    // Job 3: Check for content changes (daily at 3 AM)
    const changeDetectionJob = cron.schedule('0 3 * * *', async () => {
      await this.detectChangedEvents();
    });
    this.cronJobs.push(changeDetectionJob);
    console.log('✅ Change detection job scheduled (daily at 3 AM)');

    console.log('✅ Luma Content Scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop() {
    this.cronJobs.forEach((job) => job.stop());
    this.cronJobs = [];
    this.isRunning = false;
    console.log('🛑 Luma Content Scheduler stopped');
  }

  /**
   * Process events with pending status
   */
  async processPendingEvents() {
    try {
      console.log('📋 Checking for pending Luma content processing...');

      // Find events that need processing
      // Use FOR UPDATE SKIP LOCKED pattern for horizontal scaling
      const { data: events, error } = await supabase
        .from('events')
        .select('id, event_title')
        .not('luma_page_data', 'is', null)
        .or('luma_processing_status.is.null,luma_processing_status.eq.pending')
        .limit(this.config.batchSize);

      if (error) {
        console.error('Error finding pending events:', error);
        return;
      }

      if (!events || events.length === 0) {
        console.log('✅ No pending events to process');
        return;
      }

      console.log(`📝 Found ${events.length} events to process`);

      // Enqueue individual jobs for each event
      for (const event of events) {
        await this.enqueueContentJob(event.id, event.event_title);

        // Small delay between enqueues to avoid queue spam
        await new Promise((resolve) => setTimeout(resolve, this.config.enqueueDelay));
      }

      console.log(`✅ Enqueued ${events.length} content processing jobs`);
    } catch (error) {
      console.error('Error processing pending events:', error);
    }
  }

  /**
   * Retry events that previously failed
   */
  async retryFailedEvents() {
    try {
      console.log('🔄 Checking for failed events to retry...');

      // Find failed events (limit retries to recent failures)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: events, error } = await supabase
        .from('events')
        .select('id, event_title')
        .not('luma_page_data', 'is', null)
        .eq('luma_processing_status', 'failed')
        .gte('updated_at', oneDayAgo)
        .limit(this.config.batchSize);

      if (error) {
        console.error('Error finding failed events:', error);
        return;
      }

      if (!events || events.length === 0) {
        console.log('✅ No failed events to retry');
        return;
      }

      console.log(`🔄 Found ${events.length} failed events to retry`);

      // Reset status to pending and enqueue
      for (const event of events) {
        await supabase.from('events').update({ luma_processing_status: 'pending' }).eq('id', event.id);

        await this.enqueueContentJob(event.id, event.event_title, { isRetry: true });

        await new Promise((resolve) => setTimeout(resolve, this.config.enqueueDelay));
      }

      console.log(`✅ Enqueued ${events.length} retry jobs`);
    } catch (error) {
      console.error('Error retrying failed events:', error);
    }
  }

  /**
   * Detect events with changed content (hash mismatch)
   */
  async detectChangedEvents() {
    try {
      console.log('🔍 Checking for changed Luma content...');

      // This query finds events where the stored hash doesn't match current content
      // We need to compute hash in JS since PostgreSQL MD5 may differ
      const { data: events, error } = await supabase
        .from('events')
        .select('id, event_title, luma_page_data, luma_page_data_hash')
        .not('luma_page_data', 'is', null)
        .eq('luma_processing_status', 'completed')
        .limit(this.config.batchSize);

      if (error) {
        console.error('Error finding events for change detection:', error);
        return;
      }

      if (!events || events.length === 0) {
        console.log('✅ No completed events to check');
        return;
      }

      let changedCount = 0;
      const crypto = await import('crypto');

      for (const event of events) {
        const descriptionMirror =
          event.luma_page_data?.pageProps?.initialData?.data?.description_mirror ||
          event.luma_page_data?.pageProps?.data?.description_mirror;

        if (!descriptionMirror) continue;

        const currentHash = crypto.createHash('md5').update(JSON.stringify(descriptionMirror)).digest('hex');

        if (currentHash !== event.luma_page_data_hash) {
          console.log(`📝 Content changed for event: ${event.event_title}`);

          await supabase.from('events').update({ luma_processing_status: 'pending' }).eq('id', event.id);

          await this.enqueueContentJob(event.id, event.event_title, { isReprocess: true });

          changedCount++;
          await new Promise((resolve) => setTimeout(resolve, this.config.enqueueDelay));
        }
      }

      console.log(`✅ Found ${changedCount} events with changed content`);
    } catch (error) {
      console.error('Error detecting changed events:', error);
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
        JobTypes.LUMA_CONTENT_PROCESS,
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

      console.log(`  📤 Enqueued job for: ${eventTitle || eventId}`);
    } catch (error) {
      console.error(`Failed to enqueue job for ${eventId}:`, error);
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
    await supabase.from('events').update({ luma_processing_status: 'pending' }).eq('id', eventId);

    await this.enqueueContentJob(event.id, event.event_title, { manual: true });

    return { queued: true, eventTitle: event.event_title };
  }
}

export default LumaContentScheduler;
