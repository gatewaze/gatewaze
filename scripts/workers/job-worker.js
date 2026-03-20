#!/usr/bin/env node

/**
 * Job Worker
 *
 * Processes background jobs from the BullMQ queue.
 * Each worker runs in its own container and can be scaled independently.
 */

import '../load-env.js';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { JobTypes, getQueue } from '../lib/job-queue.js';
import { supabase } from '../supabase-client.js';

// Import scraper worker logic
import { runScraperJob } from './scraper-job-handler.js';

// Import Slack invitation queue processor
import { processQueue as processSlackQueue } from './slack-invitation-worker.js';

const brand = process.env.BRAND || 'default';
const queueName = `jobs-${brand}`;

console.log(`🔧 Starting worker for ${brand}`);
console.log(`📋 Queue: ${queueName}`);

/**
 * Clean up stale scraper jobs from Redis queue
 * Removes jobs that reference scraper_jobs that no longer exist in the database
 */
async function cleanupStaleScraperJobs() {
  console.log(`🧹 Checking for stale scraper jobs in queue...`);

  try {
    const queue = getQueue(brand);

    // Get all waiting and failed jobs
    const waitingJobs = await queue.getJobs(['waiting', 'failed', 'delayed']);

    if (waitingJobs.length === 0) {
      console.log(`✅ No jobs in queue to check`);
      return;
    }

    console.log(`📋 Found ${waitingJobs.length} jobs to validate`);

    // Collect all scraper job IDs from the queue
    const scraperJobIds = waitingJobs
      .filter(job => job.name === JobTypes.SCRAPER_RUN && job.data?.scraperJobId)
      .map(job => ({ redisJob: job, scraperJobId: job.data.scraperJobId }));

    if (scraperJobIds.length === 0) {
      console.log(`✅ No scraper jobs to validate`);
      return;
    }

    // Query database to find which scraper_jobs exist
    const dbJobIds = scraperJobIds.map(j => j.scraperJobId);
    const { data: existingJobs, error } = await supabase
      .from('scrapers_jobs')
      .select('id')
      .in('id', dbJobIds);

    if (error) {
      console.error(`❌ Error querying scraper_jobs:`, error);
      return;
    }

    const existingJobIds = new Set(existingJobs?.map(j => j.id) || []);

    // Remove jobs that don't exist in the database
    let removedCount = 0;
    for (const { redisJob, scraperJobId } of scraperJobIds) {
      if (!existingJobIds.has(scraperJobId)) {
        try {
          await redisJob.remove();
          removedCount++;
          console.log(`🗑️ Removed stale job: scraper job ${scraperJobId} (Redis job ${redisJob.id})`);
        } catch (removeError) {
          console.error(`❌ Failed to remove job ${redisJob.id}:`, removeError.message);
        }
      }
    }

    if (removedCount > 0) {
      console.log(`✅ Cleaned up ${removedCount} stale scraper jobs`);
    } else {
      console.log(`✅ All queued scraper jobs are valid`);
    }
  } catch (error) {
    console.error(`❌ Error during stale job cleanup:`, error);
  }
}

// Redis connection
const getConnection = () => {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const url = new URL(redisUrl);
      return {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        password: url.password || undefined,
        maxRetriesPerRequest: null,
      };
    } catch {
      // Fall through to default
    }
  }

  return {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
  };
};

// Redis client for pub/sub (log streaming)
let redisPublisher = null;

function getRedisPublisher() {
  if (!redisPublisher) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      redisPublisher = new Redis(redisUrl);
    } else {
      redisPublisher = new Redis({
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      });
    }
    redisPublisher.on('error', (err) => console.error('Redis publisher error:', err));
  }
  return redisPublisher;
}

// Publish log to Redis channel for SSE streaming
async function publishLog(scraperJobId, logData) {
  try {
    const publisher = getRedisPublisher();
    await publisher.publish(`scraper:${scraperJobId}:logs`, JSON.stringify(logData));
  } catch (error) {
    console.error('Error publishing log:', error);
  }
}

// Persist log to database for historical viewing
async function persistLog(scraperJobId, message, logType = 'log', logLevel = 'info', metadata = null) {
  if (!scraperJobId) return;

  try {
    await supabase.rpc('scrapers_insert_job_log', {
      p_job_id: scraperJobId,
      p_log_type: logType,
      p_log_level: logLevel,
      p_message: message,
      p_metadata: metadata
    });
  } catch (error) {
    // Silently fail - table may not exist
  }
}

// Job handlers
const handlers = {
  [JobTypes.SCRAPER_RUN]: async (job) => {
    const { scraperJobId, scraperId, scraperName, scraperType, eventType } = job.data;
    console.log(`🤖 Running scraper job ${scraperJobId}: ${scraperName}`);

    // Create logging functions that publish to Redis AND persist to database
    const logger = {
      log: (message, level = 'info', metadata = null) => {
        const logData = {
          type: 'log',
          level,
          message: `[${new Date().toLocaleTimeString()}] ${message}`,
          timestamp: new Date().toISOString(),
          metadata
        };
        console.log(`[Scraper ${scraperJobId}] ${message}`);
        publishLog(scraperJobId, logData);
        persistLog(scraperJobId, logData.message, 'log', level, metadata);
      },
      progress: (stats) => {
        const progressData = {
          type: 'progress',
          stats,
          timestamp: new Date().toISOString()
        };
        job.updateProgress(stats.percent || 0);
        publishLog(scraperJobId, progressData);
        persistLog(scraperJobId, 'Progress update', 'progress', 'info', stats);
      },
      complete: (success, stats = {}) => {
        const completeData = {
          type: 'complete',
          success,
          stats,
          timestamp: new Date().toISOString()
        };
        publishLog(scraperJobId, completeData);
        persistLog(scraperJobId, success ? 'Job completed successfully' : 'Job failed', 'complete', success ? 'info' : 'error', stats);
      },
      error: (error) => {
        const errorData = {
          type: 'error',
          error: error.message || String(error),
          stack: error.stack,
          timestamp: new Date().toISOString()
        };
        console.error(`[Scraper ${scraperJobId}] Error: ${error.message}`);
        publishLog(scraperJobId, errorData);
        persistLog(scraperJobId, error.message || String(error), 'error', 'error', { stack: error.stack });
      }
    };

    // Run the scraper job
    const result = await runScraperJob(scraperJobId, logger);
    return result;
  },

  [JobTypes.SCRAPER_RUN_ALL]: async (job) => {
    console.log(`🤖 Running all scrapers - not yet implemented via BullMQ`);
    throw new Error('SCRAPER_RUN_ALL not yet implemented');
  },

  [JobTypes.CUSTOMERIO_SYNC_INCREMENTAL]: async (job) => {
    console.log(`📊 Running Customer.io incremental sync`);
    // Dynamic import to avoid loading everything at startup
    const { runIncrementalSync } = await import('../sync-customerio-incremental.js');
    return await runIncrementalSync(job.data);
  },

  [JobTypes.CUSTOMERIO_SYNC_FULL]: async (job) => {
    console.log(`📊 Running Customer.io full sync`);
    const { runFullSync } = await import('../sync-customerio-full.js');
    return await runFullSync(job.data);
  },

  [JobTypes.CUSTOMERIO_SYNC_ACTIVITIES]: async (job) => {
    console.log(`📊 Running Customer.io activities sync`);
    const { runActivitiesSync } = await import('../sync-customerio-activities.js');
    return await runActivitiesSync(job.data);
  },

  [JobTypes.CUSTOMERIO_SYNC_SEGMENTS]: async (job) => {
    console.log(`📊 Running Customer.io segments sync`);
    const { runSegmentsSync } = await import('../sync-customerio-segments.js');
    return await runSegmentsSync(job.data);
  },

  [JobTypes.EMBEDDING_GENERATE]: async (job) => {
    console.log(`🧠 Generating embeddings`);
    const { generateEmbeddings } = await import('../generate-customer-embeddings.js');
    return await generateEmbeddings(job.data);
  },

  [JobTypes.AVATAR_SYNC]: async (job) => {
    console.log(`🖼️ Syncing avatars`);
    const { syncAvatars } = await import('../lib/avatar-sync.js');
    return await syncAvatars(job.data);
  },

  [JobTypes.GRAVATAR_SYNC]: async (job) => {
    console.log(`🖼️ Syncing gravatars`);
    const { syncGravatars } = await import('../sync-gravatar-avatars.ts');
    return await syncGravatars(job.data);
  },

  [JobTypes.SCREENSHOT_GENERATE]: async (job) => {
    const { eventIds, forceRegenerate, onlyMissing, screenshotJobId } = job.data;
    console.log(`📸 Generating screenshots${eventIds ? ` for events: ${eventIds.join(', ')}` : ''}`);

    // Create logging functions that publish to Redis for SSE streaming
    const logger = {
      log: (message, level = 'info', metadata = null) => {
        const logData = {
          type: 'log',
          level,
          message: `[${new Date().toLocaleTimeString()}] ${message}`,
          timestamp: new Date().toISOString(),
          metadata
        };
        console.log(`[Screenshot ${screenshotJobId || job.id}] ${message}`);
        if (screenshotJobId) {
          publishLog(screenshotJobId, logData);
        }
      },
      progress: (stats) => {
        const progressData = {
          type: 'progress',
          stats,
          timestamp: new Date().toISOString()
        };
        job.updateProgress(stats.percent || 0);
        if (screenshotJobId) {
          publishLog(screenshotJobId, progressData);
        }
      },
      complete: (success, stats = {}) => {
        const completeData = {
          type: 'complete',
          success,
          stats,
          timestamp: new Date().toISOString()
        };
        if (screenshotJobId) {
          publishLog(screenshotJobId, completeData);
        }
      },
      error: (error) => {
        const errorData = {
          type: 'error',
          error: error.message || String(error),
          stack: error.stack,
          timestamp: new Date().toISOString()
        };
        console.error(`[Screenshot ${screenshotJobId || job.id}] Error: ${error.message}`);
        if (screenshotJobId) {
          publishLog(screenshotJobId, errorData);
        }
      }
    };

    logger.log('Starting screenshot generation via worker...');

    try {
      // Dynamic import to avoid loading Puppeteer at startup
      const { generateScreenshots } = await import('../generate-screenshots.js');

      const result = await generateScreenshots({
        eventIds: eventIds || null,
        forceRegenerate: forceRegenerate || false,
        onlyMissing: onlyMissing || false,
      });

      logger.complete(true, { message: 'Screenshot generation completed' });
      return result;
    } catch (error) {
      logger.error(error);
      throw error;
    }
  },

  [JobTypes.LUMA_CONTENT_PROCESS]: async (job) => {
    const { eventId, eventTitle, isRetry, isReprocess, manual } = job.data;
    console.log(`📝 Processing Luma content for: ${eventTitle || eventId}`);

    // Create logging function
    const logger = (message) => {
      console.log(`[Luma Content ${eventId}] ${message}`);
    };

    try {
      // Dynamic import to avoid loading at startup
      const { processLumaContent } = await import('./luma-content-handler.js');

      const result = await processLumaContent(eventId, {
        extractSpeakers: true,
        processImages: true,
        forceReprocess: isReprocess || manual || false,
      }, logger);

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      return result;
    } catch (error) {
      console.error(`[Luma Content ${eventId}] Error: ${error.message}`);
      throw error;
    }
  },

  [JobTypes.MEETUP_CONTENT_PROCESS]: async (job) => {
    const { eventId, eventTitle, isRetry, isReprocess, manual } = job.data;
    console.log(`📝 Processing Meetup content for: ${eventTitle || eventId}`);

    // Create logging function
    const logger = (message) => {
      console.log(`[Meetup Content ${eventId}] ${message}`);
    };

    try {
      // Dynamic import to avoid loading at startup
      const { processMeetupContent } = await import('./meetup-content-handler.js');

      const result = await processMeetupContent(eventId, {
        extractSpeakers: true,
        processImages: true,
        forceReprocess: isReprocess || manual || false,
      }, logger);

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      return result;
    } catch (error) {
      console.error(`[Meetup Content ${eventId}] Error: ${error.message}`);
      throw error;
    }
  },
};

// Create worker
const worker = new Worker(
  queueName,
  async (job) => {
    console.log(`\n📥 Processing job: ${job.name} (${job.id})`);
    console.log(`   Data: ${JSON.stringify(job.data).slice(0, 200)}...`);

    const handler = handlers[job.name];
    if (!handler) {
      throw new Error(`Unknown job type: ${job.name}`);
    }

    const startTime = Date.now();
    try {
      const result = await handler(job);
      const duration = Date.now() - startTime;
      console.log(`✅ Job completed: ${job.name} (${job.id}) in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Job failed: ${job.name} (${job.id}) after ${duration}ms`);
      console.error(`   Error: ${error.message}`);

      // If the error has skipRetry flag, remove the job from the queue to prevent retries
      if (error.skipRetry) {
        console.log(`🗑️ Job ${job.id} marked as skipRetry - removing from queue`);
        try {
          await job.remove();
        } catch (removeErr) {
          console.error(`   Failed to remove job: ${removeErr.message}`);
        }
        // Return instead of throwing to prevent retry
        return { skipped: true, reason: error.message };
      }

      throw error;
    }
  },
  {
    connection: getConnection(),
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '1', 10),
    limiter: {
      max: 10,
      duration: 1000,
    },
  }
);

// Event handlers
worker.on('completed', (job, result) => {
  console.log(`✅ Job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(`❌ Job ${job?.id} failed: ${error.message}`);
  if (job) {
    console.error(`   Attempts: ${job.attemptsMade}/${job.opts?.attempts || 3}`);
  }
});

worker.on('error', (error) => {
  console.error('Worker error:', error);
});

worker.on('stalled', (jobId) => {
  console.warn(`⚠️ Job ${jobId} stalled`);
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n📴 Received ${signal}, shutting down worker...`);
  await worker.close();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`✅ Worker started for ${brand}`);
console.log(`   Concurrency: ${process.env.WORKER_CONCURRENCY || 1}`);
console.log(`   Redis: ${process.env.REDIS_URL || 'redis://redis:6379'}`);

// Clean up stale jobs on startup
cleanupStaleScraperJobs().catch(err => console.error('Startup cleanup failed:', err));

// Run periodic cleanup every 5 minutes to catch jobs deleted from database manually
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  cleanupStaleScraperJobs().catch(err => console.error('Periodic cleanup failed:', err));
}, CLEANUP_INTERVAL_MS);
console.log(`🔄 Periodic stale job cleanup scheduled every 5 minutes`);

// Start Slack invitation queue processor if Slack environment variables are present
if (process.env.SLACK_WORKSPACE_URL && process.env.SLACK_ADMIN_EMAIL) {
  console.log(`\n📬 Slack invitation queue processor enabled`);
  console.log(`   Workspace: ${process.env.SLACK_WORKSPACE_URL}`);
  console.log(`   Account: ${process.env.SLACK_ADMIN_EMAIL}`);

  // Process queue every 30 seconds
  const SLACK_QUEUE_INTERVAL_MS = 30 * 1000; // 30 seconds

  // Start immediately
  processSlackQueue().catch(err => console.error('Slack queue processor error:', err));

  // Then run periodically
  setInterval(() => {
    processSlackQueue().catch(err => console.error('Slack queue processor error:', err));
  }, SLACK_QUEUE_INTERVAL_MS);

  console.log(`🔄 Slack invitation queue processor scheduled every 30 seconds`);
} else {
  console.log(`⚠️  Slack invitation queue processor disabled (missing environment variables)`);
}
