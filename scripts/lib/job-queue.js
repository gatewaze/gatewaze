/**
 * Job Queue Service using BullMQ
 *
 * Provides a centralized job queue for background tasks like scrapers,
 * syncs, and other long-running operations.
 */

import { Queue, Worker, QueueEvents } from 'bullmq';

// Redis connection configuration
const getRedisConnection = () => ({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
});

// Parse REDIS_URL if provided (for docker-compose compatibility)
const getConnectionFromUrl = () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return getRedisConnection();

  try {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      password: url.password || undefined,
      maxRetriesPerRequest: null,
    };
  } catch {
    return getRedisConnection();
  }
};

// Job type definitions
export const JobTypes = {
  // Scraper jobs
  SCRAPER_RUN: 'scraper:run',
  SCRAPER_RUN_ALL: 'scraper:run-all',

  // Customer.io sync jobs
  CUSTOMERIO_SYNC_INCREMENTAL: 'customerio:sync-incremental',
  CUSTOMERIO_SYNC_FULL: 'customerio:sync-full',
  CUSTOMERIO_SYNC_ACTIVITIES: 'customerio:sync-activities',
  CUSTOMERIO_SYNC_SEGMENTS: 'customerio:sync-segments',

  // Embedding jobs
  EMBEDDING_GENERATE: 'embedding:generate',

  // Avatar sync jobs
  AVATAR_SYNC: 'avatar:sync',
  GRAVATAR_SYNC: 'gravatar:sync',

  // Screenshot jobs
  SCREENSHOT_GENERATE: 'screenshot:generate',

  // Luma content processing jobs
  LUMA_CONTENT_PROCESS: 'luma:content-process',

  // Meetup content processing jobs
  MEETUP_CONTENT_PROCESS: 'meetup:content-process',

  // Media processing jobs
  MEDIA_PROCESS_ZIP: 'media:process-zip',

  // Bulk speaker extraction enqueued at the end of every scrape run.
  // Handler implemented in
  // premium-gatewaze-modules/modules/scrapers/scripts/workers/speaker-extract-handler.js
  // and dispatched from this worker's handlers map below. Mirrors the
  // canonical entry in packages/api/src/lib/queue/schemas.ts — both
  // registries must stay in sync, otherwise enqueueing the new job type
  // by name fails with the BullMQ Lua error
  // "ERR Lua redis lib command arguments must be strings or integers"
  // because queue.add(undefined, data) is what gets called.
  SCRAPER_SPEAKER_EXTRACT: 'scraper:speaker-extract',
};

// Queue names per brand (using hyphen instead of colon - BullMQ doesn't allow colons)
const getQueueName = (brand) => `jobs-${brand || process.env.BRAND || 'default'}`;

// Singleton queues per brand
const queues = new Map();
const queueEvents = new Map();

/**
 * Get or create a queue for a brand
 */
export function getQueue(brand) {
  const queueName = getQueueName(brand);

  if (!queues.has(queueName)) {
    const queue = new Queue(queueName, {
      connection: getConnectionFromUrl(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          count: 1000,  // Keep last 1000 completed jobs
          age: 24 * 3600,  // Keep for 24 hours
        },
        removeOnFail: {
          count: 500,  // Keep last 500 failed jobs
          age: 7 * 24 * 3600,  // Keep for 7 days
        },
      },
    });
    queues.set(queueName, queue);
  }

  return queues.get(queueName);
}

/**
 * Get queue events for monitoring
 */
export function getQueueEvents(brand) {
  const queueName = getQueueName(brand);

  if (!queueEvents.has(queueName)) {
    const events = new QueueEvents(queueName, {
      connection: getConnectionFromUrl(),
    });
    queueEvents.set(queueName, events);
  }

  return queueEvents.get(queueName);
}

/**
 * Add a job to the queue
 */
export async function addJob(type, data, options = {}) {
  const queue = getQueue(data.brand);

  // Replace colons with hyphens in jobId (BullMQ doesn't allow colons)
  const safeType = type.replace(/:/g, '-');

  const job = await queue.add(type, {
    ...data,
    enqueuedAt: new Date().toISOString(),
  }, {
    ...options,
    jobId: options.jobId || `${safeType}-${Date.now()}`,
  });

  console.log(`📥 Job enqueued: ${type} (${job.id})`);
  return job;
}

/**
 * Add a scheduled/repeating job
 */
export async function addScheduledJob(type, data, cronExpression, options = {}) {
  const queue = getQueue(data.brand);

  // Replace colons with hyphens in jobId (BullMQ doesn't allow colons)
  const safeType = type.replace(/:/g, '-');

  const job = await queue.add(type, {
    ...data,
    scheduled: true,
  }, {
    ...options,
    repeat: {
      pattern: cronExpression,
    },
    jobId: options.jobId || `${safeType}-scheduled`,
  });

  console.log(`⏰ Scheduled job added: ${type} (${cronExpression})`);
  return job;
}

/**
 * Get all jobs with optional filtering
 */
export async function getJobs(brand, options = {}) {
  const queue = getQueue(brand);
  const { status = ['waiting', 'active', 'completed', 'failed', 'delayed'], start = 0, end = 100 } = options;

  const jobs = await queue.getJobs(status, start, end);

  return jobs.map(job => ({
    id: job.id,
    name: job.name,
    data: job.data,
    status: job.finishedOn ? (job.failedReason ? 'failed' : 'completed') :
            job.processedOn ? 'active' :
            job.delay > 0 ? 'delayed' : 'waiting',
    progress: job.progress,
    attempts: job.attemptsMade,
    maxAttempts: job.opts?.attempts || 3,
    failedReason: job.failedReason,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    createdAt: job.timestamp,
    delay: job.delay,
    returnValue: job.returnvalue,
  }));
}

/**
 * Get job counts by status
 */
export async function getJobCounts(brand) {
  const queue = getQueue(brand);
  return await queue.getJobCounts();
}

/**
 * Get a specific job by ID
 */
export async function getJob(brand, jobId) {
  const queue = getQueue(brand);
  const job = await queue.getJob(jobId);

  if (!job) return null;

  return {
    id: job.id,
    name: job.name,
    data: job.data,
    status: job.finishedOn ? (job.failedReason ? 'failed' : 'completed') :
            job.processedOn ? 'active' :
            job.delay > 0 ? 'delayed' : 'waiting',
    progress: job.progress,
    attempts: job.attemptsMade,
    maxAttempts: job.opts?.attempts || 3,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    createdAt: job.timestamp,
    returnValue: job.returnvalue,
    logs: await queue.getJobLogs(jobId),
  };
}

/**
 * Retry a failed job
 */
export async function retryJob(brand, jobId) {
  const queue = getQueue(brand);
  const job = await queue.getJob(jobId);

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  await job.retry();
  console.log(`🔄 Job retried: ${jobId}`);
  return true;
}

/**
 * Remove a job
 */
export async function removeJob(brand, jobId) {
  const queue = getQueue(brand);
  const job = await queue.getJob(jobId);

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  await job.remove();
  console.log(`🗑️ Job removed: ${jobId}`);
  return true;
}

/**
 * Clean old jobs
 */
export async function cleanJobs(brand, options = {}) {
  const queue = getQueue(brand);
  const { grace = 24 * 3600 * 1000, status = 'completed', limit = 1000 } = options;

  const removed = await queue.clean(grace, limit, status);
  console.log(`🧹 Cleaned ${removed.length} ${status} jobs`);
  return removed.length;
}

/**
 * Get repeatable jobs (scheduled)
 */
export async function getRepeatableJobs(brand) {
  const queue = getQueue(brand);
  return await queue.getRepeatableJobs();
}

/**
 * Remove a repeatable job
 */
export async function removeRepeatableJob(brand, repeatJobKey) {
  const queue = getQueue(brand);
  await queue.removeRepeatableByKey(repeatJobKey);
  console.log(`🗑️ Repeatable job removed: ${repeatJobKey}`);
  return true;
}

/**
 * Close all queues (for graceful shutdown)
 */
export async function closeAll() {
  const closePromises = [];

  for (const queue of queues.values()) {
    closePromises.push(queue.close());
  }

  for (const events of queueEvents.values()) {
    closePromises.push(events.close());
  }

  await Promise.all(closePromises);
  queues.clear();
  queueEvents.clear();

  console.log('📴 All queues closed');
}

export default {
  JobTypes,
  getQueue,
  getQueueEvents,
  addJob,
  addScheduledJob,
  getJobs,
  getJobCounts,
  getJob,
  retryJob,
  removeJob,
  cleanJobs,
  getRepeatableJobs,
  removeRepeatableJob,
  closeAll,
};
