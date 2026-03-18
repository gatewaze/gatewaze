import cron from 'node-cron';
import { supabase } from '../supabase-client.js';

/**
 * Embedding Scheduler Service
 * Monitors database changes and generates embeddings for customers and events
 * Runs periodic full syncs to ensure all embeddings are up to date
 *
 * Customers: Profile-based embeddings for similarity search
 * Events: Description-based embeddings for AI-powered search
 */
export class EmbeddingScheduler {
  constructor(config = {}) {
    this.config = config;
    this.isRunning = false;
    this.cronJobs = [];
    this.supabase = supabase;
    console.log('🔧 Embedding Scheduler initialized');
  }

  /**
   * Start the scheduler
   * - Every 15 minutes: Generate embeddings for recently updated customers
   * - Every 6 hours: Generate embeddings for customers missing embeddings
   * - Every 24 hours: Regenerate embeddings for customers with outdated model versions
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Embedding Scheduler is already running');
      return;
    }

    console.log('🚀 Starting Embedding Scheduler...');
    this.isRunning = true;

    // Job 1: Process recently updated customers (every 15 minutes)
    const recentUpdatesJob = cron.schedule('*/15 * * * *', async () => {
      await this.processRecentUpdates();
    });
    this.cronJobs.push(recentUpdatesJob);
    console.log('✅ Recent updates job scheduled (every 15 minutes)');

    // Job 2: Find and process customers missing embeddings (every 6 hours)
    const missingEmbeddingsJob = cron.schedule('0 */6 * * *', async () => {
      await this.processMissingEmbeddings();
    });
    this.cronJobs.push(missingEmbeddingsJob);
    console.log('✅ Missing embeddings job scheduled (every 6 hours)');

    // Job 3: Regenerate outdated embeddings (daily at 2 AM)
    const outdatedEmbeddingsJob = cron.schedule('0 2 * * *', async () => {
      await this.regenerateOutdatedEmbeddings();
    });
    this.cronJobs.push(outdatedEmbeddingsJob);
    console.log('✅ Outdated embeddings job scheduled (daily at 2 AM)');

    // Job 4: Process event embedding queue (every 5 minutes)
    const eventEmbeddingsJob = cron.schedule('*/5 * * * *', async () => {
      await this.processEventEmbeddingQueue();
    });
    this.cronJobs.push(eventEmbeddingsJob);
    console.log('✅ Event embeddings job scheduled (every 5 minutes)');

    // Run initial checks on startup
    this.processMissingEmbeddings();
    this.processEventEmbeddingQueue();

    console.log('✅ Embedding Scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop() {
    this.cronJobs.forEach(job => job.stop());
    this.cronJobs = [];
    this.isRunning = false;
    console.log('🛑 Embedding Scheduler stopped');
  }

  /**
   * Process customers that were recently updated
   * Generates embeddings for customers modified in the last 30 minutes
   */
  async processRecentUpdates() {
    try {
      // Find customers updated in last 30 minutes that don't have current embeddings
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      const { data: recentlyUpdated, error } = await this.supabase.rpc(
        'get_customers_needing_embeddings',
        { since_timestamp: thirtyMinutesAgo }
      );

      if (error) {
        console.error('❌ Error fetching recently updated customers:', error);
        return;
      }

      if (!recentlyUpdated || recentlyUpdated.length === 0) {
        // Normal case - no updates needed
        return;
      }

      console.log(`📊 Found ${recentlyUpdated.length} recently updated customers needing embeddings`);
      await this.generateEmbeddingsForCustomers(recentlyUpdated.map(c => c.id));
    } catch (error) {
      console.error('❌ Error in processRecentUpdates:', error);
    }
  }

  /**
   * Process customers that are missing embeddings entirely
   * Runs in batches to avoid overwhelming the system
   */
  async processMissingEmbeddings() {
    try {
      // First get all customer IDs that already have embeddings
      const { data: existingEmbeddings, error: embeddingsError } = await this.supabase
        .from('customer_embeddings')
        .select('customer_id');

      if (embeddingsError) {
        console.error('❌ Error fetching existing embeddings:', embeddingsError);
        return;
      }

      // Build the exclusion list
      const excludeIds = existingEmbeddings?.map(e => e.customer_id) || [];

      // Find customers without embeddings
      let query = this.supabase
        .from('customers')
        .select('id')
        .limit(500); // Process max 500 at a time

      // Only add the not.in filter if there are IDs to exclude
      if (excludeIds.length > 0) {
        query = query.not('id', 'in', `(${excludeIds.join(',')})`);
      }

      const { data: customersWithoutEmbeddings, error } = await query;

      if (error) {
        console.error('❌ Error fetching customers without embeddings:', error);
        return;
      }

      if (!customersWithoutEmbeddings || customersWithoutEmbeddings.length === 0) {
        console.log('✅ All customers have embeddings');
        return;
      }

      console.log(`📊 Found ${customersWithoutEmbeddings.length} customers missing embeddings`);
      await this.generateEmbeddingsForCustomers(customersWithoutEmbeddings.map(c => c.id));
    } catch (error) {
      console.error('❌ Error in processMissingEmbeddings:', error);
    }
  }

  /**
   * Regenerate embeddings that are using an outdated model version
   * This is useful when you upgrade to a new embedding model
   */
  async regenerateOutdatedEmbeddings() {
    try {
      const currentModelVersion = 'text-embedding-3-small';

      // Find embeddings with outdated model versions
      const { data: outdatedEmbeddings, error } = await this.supabase
        .from('customer_embeddings')
        .select('customer_id')
        .neq('model_version', currentModelVersion)
        .limit(1000); // Process max 1000 per day

      if (error) {
        console.error('❌ Error fetching outdated embeddings:', error);
        return;
      }

      if (!outdatedEmbeddings || outdatedEmbeddings.length === 0) {
        console.log('✅ All embeddings use current model version');
        return;
      }

      console.log(`📊 Found ${outdatedEmbeddings.length} embeddings with outdated model versions`);
      await this.generateEmbeddingsForCustomers(outdatedEmbeddings.map(e => e.customer_id));
    } catch (error) {
      console.error('❌ Error in regenerateOutdatedEmbeddings:', error);
    }
  }

  /**
   * Generate embeddings for a list of customer IDs
   * Calls the generate-embeddings Edge Function in batches
   */
  async generateEmbeddingsForCustomers(customerIds) {
    if (!customerIds || customerIds.length === 0) {
      return;
    }

    // Smaller batch size to avoid Edge Function timeouts (150s limit)
    const batchSize = 20;
    let totalProcessed = 0;
    let totalErrors = 0;

    for (let i = 0; i < customerIds.length; i += batchSize) {
      const batch = customerIds.slice(i, i + batchSize);

      try {
        const { data, error } = await this.supabase.functions.invoke('generate-embeddings', {
          body: {
            customer_ids: batch,
            batch_size: 10  // Internal batch size for OpenAI API calls
          }
        });

        if (error) throw error;

        totalProcessed += data.customers_processed;
        totalErrors += data.errors.length;

        if (data.errors.length > 0) {
          console.log(`  ⚠️  ${data.errors.length} errors in batch ${Math.floor(i / batchSize) + 1}`);
        }

        console.log(`  ✅ Processed ${data.customers_processed} customers`);
      } catch (error) {
        console.error(`  ❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error.message);
        totalErrors += batch.length;
      }

      // Rate limiting - wait 2 seconds between batches to avoid overloading
      if (i + batchSize < customerIds.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`📊 Embedding generation complete: ${totalProcessed} processed, ${totalErrors} errors`);
  }

  /**
   * Process events in the embedding queue
   * Events are automatically queued by database trigger on insert/update
   */
  async processEventEmbeddingQueue() {
    try {
      // Get pending events from the queue
      const { data: pendingEvents, error } = await this.supabase.rpc(
        'get_pending_event_embeddings',
        { max_count: 50 }
      );

      if (error) {
        console.error('❌ Error fetching pending event embeddings:', error);
        return;
      }

      if (!pendingEvents || pendingEvents.length === 0) {
        // Normal case - no events to process
        return;
      }

      console.log(`📊 Found ${pendingEvents.length} events needing embeddings`);
      const eventIds = pendingEvents.map(e => e.event_id);

      await this.generateEmbeddingsForEvents(eventIds);
    } catch (error) {
      console.error('❌ Error in processEventEmbeddingQueue:', error);
    }
  }

  /**
   * Generate embeddings for a list of event IDs
   * Calls the generate-embeddings Edge Function in batches
   */
  async generateEmbeddingsForEvents(eventIds) {
    if (!eventIds || eventIds.length === 0) {
      return;
    }

    console.log(`🎯 Generating embeddings for ${eventIds.length} events...`);

    // Smaller batch size to avoid Edge Function timeouts
    const batchSize = 20;
    let totalProcessed = 0;
    let totalErrors = 0;
    const processedIds = [];
    const failedIds = [];

    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batch = eventIds.slice(i, i + batchSize);

      try {
        const { data, error } = await this.supabase.functions.invoke('generate-embeddings', {
          body: {
            event_ids: batch,
            batch_size: 10  // Internal batch size for OpenAI API calls
          }
        });

        if (error) throw error;

        totalProcessed += data.events_processed;
        totalErrors += data.errors.length;

        // Only mark events as processed if they were actually processed
        if (data.events_processed > 0) {
          processedIds.push(...batch);
          console.log(`  ✅ Processed ${data.events_processed} events`);
        } else if (data.errors.length > 0) {
          // If no events processed but errors, mark as failed
          console.log(`  ⚠️  ${data.errors.length} errors in batch ${Math.floor(i / batchSize) + 1}`);
          data.errors.forEach(err => console.log(`    - ${err}`));
          failedIds.push(...batch);
        } else {
          // No events processed and no errors - likely API key issue or empty batch
          console.log(`  ⚠️  0 events processed with no errors - check OPENAI_API_KEY configuration`);
          // Don't mark as processed, leave in queue for retry
        }
      } catch (error) {
        console.error(`  ❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error.message);
        totalErrors += batch.length;
        failedIds.push(...batch);
      }

      // Rate limiting - wait 2 seconds between batches
      if (i + batchSize < eventIds.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Mark successfully processed events in the queue
    if (processedIds.length > 0) {
      await this.supabase.rpc('mark_event_embeddings_processed', {
        p_event_ids: processedIds,
        p_success: true
      });
    }

    // Mark failed events in the queue with error message
    if (failedIds.length > 0) {
      await this.supabase.rpc('mark_event_embeddings_processed', {
        p_event_ids: failedIds,
        p_success: false,
        p_error_message: 'Embedding generation failed'
      });
    }

    console.log(`📊 Event embedding generation complete: ${totalProcessed} processed, ${totalErrors} errors`);
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: this.cronJobs.length,
      jobs: [
        { name: 'Recent Customer Updates', schedule: 'Every 15 minutes' },
        { name: 'Missing Customer Embeddings', schedule: 'Every 6 hours' },
        { name: 'Outdated Customer Embeddings', schedule: 'Daily at 2 AM' },
        { name: 'Event Embedding Queue', schedule: 'Every 5 minutes' }
      ]
    };
  }
}
