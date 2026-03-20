/**
 * Job Queue Service using BullMQ
 *
 * Provides a centralized job queue for background tasks like scrapers,
 * syncs, and other long-running operations.
 */

import { Queue, QueueEvents } from 'bullmq';

// Redis connection configuration
function getRedisConnection() {
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
      // fall through
    }
  }

  return {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
  };
}

// Job type definitions
export const JobTypes = {
  SCRAPER_RUN: 'scraper:run',
  SCRAPER_RUN_ALL: 'scraper:run-all',
  CUSTOMERIO_SYNC_INCREMENTAL: 'customerio:sync-incremental',
  CUSTOMERIO_SYNC_FULL: 'customerio:sync-full',
  CUSTOMERIO_SYNC_ACTIVITIES: 'customerio:sync-activities',
  CUSTOMERIO_SYNC_SEGMENTS: 'customerio:sync-segments',
  EMBEDDING_GENERATE: 'embedding:generate',
  AVATAR_SYNC: 'avatar:sync',
  GRAVATAR_SYNC: 'gravatar:sync',
  SCREENSHOT_GENERATE: 'screenshot:generate',
  LUMA_CONTENT_PROCESS: 'luma:content-process',
  MEETUP_CONTENT_PROCESS: 'meetup:content-process',
} as const;

// Queue name (single brand)
const QUEUE_NAME = 'jobs-gatewaze';

// Singleton queue and events
let queue: Queue | null = null;
let events: QueueEvents | null = null;

/**
 * Check if Redis/job queue is available
 */
export function isQueueAvailable(): boolean {
  return !!(process.env.REDIS_URL || process.env.REDIS_HOST);
}

/**
 * Get or create the job queue
 */
export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 500, age: 7 * 24 * 3600 },
      },
    });
  }
  return queue;
}

/**
 * Get queue events for monitoring
 */
export function getQueueEvents(): QueueEvents {
  if (!events) {
    events = new QueueEvents(QUEUE_NAME, {
      connection: getRedisConnection(),
    });
  }
  return events;
}

/**
 * Add a job to the queue
 */
export async function addJob(type: string, data: Record<string, unknown>, options: Record<string, unknown> = {}) {
  const q = getQueue();
  const safeType = type.replace(/:/g, '-');

  const job = await q.add(type, {
    ...data,
    enqueuedAt: new Date().toISOString(),
  }, {
    ...options,
    jobId: (options.jobId as string) || `${safeType}-${Date.now()}`,
  });

  console.log(`Job enqueued: ${type} (${job.id})`);
  return job;
}

/**
 * Get all jobs with optional filtering
 */
export async function getJobs(options: {
  status?: string[];
  start?: number;
  end?: number;
} = {}) {
  const q = getQueue();
  const {
    status = ['waiting', 'active', 'completed', 'failed', 'delayed'],
    start = 0,
    end = 100,
  } = options;

  const jobs = await q.getJobs(status as any, start, end);

  return jobs.map(job => ({
    id: job.id,
    name: job.name,
    data: job.data,
    status: job.finishedOn
      ? (job.failedReason ? 'failed' : 'completed')
      : job.processedOn
        ? 'active'
        : job.delay > 0 ? 'delayed' : 'waiting',
    progress: job.progress,
    attempts: job.attemptsMade,
    maxAttempts: (job.opts?.attempts) || 3,
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
export async function getJobCounts() {
  const q = getQueue();
  return await q.getJobCounts();
}

/**
 * Get a specific job by ID
 */
export async function getJob(jobId: string) {
  const q = getQueue();
  const job = await q.getJob(jobId);

  if (!job) return null;

  return {
    id: job.id,
    name: job.name,
    data: job.data,
    status: job.finishedOn
      ? (job.failedReason ? 'failed' : 'completed')
      : job.processedOn
        ? 'active'
        : job.delay > 0 ? 'delayed' : 'waiting',
    progress: job.progress,
    attempts: job.attemptsMade,
    maxAttempts: (job.opts?.attempts) || 3,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    createdAt: job.timestamp,
    returnValue: job.returnvalue,
    logs: await q.getJobLogs(jobId),
  };
}

/**
 * Retry a failed job
 */
export async function retryJob(jobId: string) {
  const q = getQueue();
  const job = await q.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  await job.retry();
  return true;
}

/**
 * Remove a job
 */
export async function removeJob(jobId: string) {
  const q = getQueue();
  const job = await q.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  await job.remove();
  return true;
}

/**
 * Clean old jobs
 */
export async function cleanJobs(options: {
  grace?: number;
  status?: string;
  limit?: number;
} = {}) {
  const q = getQueue();
  const { grace = 24 * 3600 * 1000, status = 'completed', limit = 1000 } = options;
  const removed = await q.clean(grace, limit, status as any);
  return removed.length;
}

/**
 * Get repeatable jobs (scheduled)
 */
export async function getRepeatableJobs() {
  const q = getQueue();
  return await q.getRepeatableJobs();
}

/**
 * Remove a repeatable job
 */
export async function removeRepeatableJob(repeatJobKey: string) {
  const q = getQueue();
  await q.removeRepeatableByKey(repeatJobKey);
  return true;
}

/**
 * Close all queues (for graceful shutdown)
 */
export async function closeAll() {
  const promises: Promise<void>[] = [];
  if (queue) promises.push(queue.close());
  if (events) promises.push(events.close());
  await Promise.all(promises);
  queue = null;
  events = null;
}
