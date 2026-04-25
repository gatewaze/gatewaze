import type { JobType } from 'bullmq';
import { getQueueOrThrow, listQueues } from './registry.js';

const DEFAULT_STATUSES: JobType[] = ['waiting', 'active', 'completed', 'failed', 'delayed'];

function queueNameOrDefault(name?: string): string {
  return name ?? 'jobs';
}

export async function getJobs(options: {
  queue?: string;
  status?: JobType[] | string[];
  start?: number;
  end?: number;
} = {}) {
  const q = getQueueOrThrow(queueNameOrDefault(options.queue));
  const statuses = (options.status as JobType[] | undefined) ?? DEFAULT_STATUSES;
  const jobs = await q.getJobs(statuses, options.start ?? 0, options.end ?? 100);
  return jobs.map((job) => ({
    id: job.id,
    name: job.name,
    data: job.data,
    status: job.finishedOn
      ? job.failedReason ? 'failed' : 'completed'
      : job.processedOn
        ? 'active'
        : (job.delay ?? 0) > 0 ? 'delayed' : 'waiting',
    progress: job.progress,
    attempts: job.attemptsMade,
    maxAttempts: job.opts?.attempts ?? 3,
    failedReason: job.failedReason,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    createdAt: job.timestamp,
    delay: job.delay,
    returnValue: job.returnvalue,
    queue: q.name,
  }));
}

export async function getJobCounts(queueName?: string) {
  const q = getQueueOrThrow(queueNameOrDefault(queueName));
  return q.getJobCounts();
}

export async function getAllQueueCounts() {
  const result: Record<string, Awaited<ReturnType<import('bullmq').Queue['getJobCounts']>>> = {};
  for (const cfg of listQueues()) {
    result[cfg.name] = await getQueueOrThrow(cfg.name).getJobCounts();
  }
  return result;
}

export async function getJob(jobId: string, queueName?: string) {
  const q = getQueueOrThrow(queueNameOrDefault(queueName));
  const job = await q.getJob(jobId);
  if (!job) return null;
  return {
    id: job.id,
    name: job.name,
    data: job.data,
    status: job.finishedOn
      ? job.failedReason ? 'failed' : 'completed'
      : job.processedOn
        ? 'active'
        : (job.delay ?? 0) > 0 ? 'delayed' : 'waiting',
    progress: job.progress,
    attempts: job.attemptsMade,
    maxAttempts: job.opts?.attempts ?? 3,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    createdAt: job.timestamp,
    returnValue: job.returnvalue,
    logs: jobId ? await q.getJobLogs(jobId) : undefined,
    queue: q.name,
  };
}

export async function retryJob(jobId: string, queueName?: string) {
  const q = getQueueOrThrow(queueNameOrDefault(queueName));
  const job = await q.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  await job.retry();
  return true;
}

export async function removeJob(jobId: string, queueName?: string) {
  const q = getQueueOrThrow(queueNameOrDefault(queueName));
  const job = await q.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  await job.remove();
  return true;
}

export async function cleanJobs(options: {
  queue?: string;
  grace?: number;
  status?: 'completed' | 'wait' | 'active' | 'paused' | 'failed' | 'delayed' | 'prioritized';
  limit?: number;
} = {}) {
  const q = getQueueOrThrow(queueNameOrDefault(options.queue));
  const removed = await q.clean(
    options.grace ?? 24 * 3600 * 1000,
    options.limit ?? 1000,
    options.status ?? 'completed',
  );
  return removed.length;
}

export async function getRepeatableJobs(queueName?: string) {
  const q = getQueueOrThrow(queueNameOrDefault(queueName));
  return q.getJobSchedulers();
}

export async function removeRepeatableJob(key: string, queueName?: string) {
  const q = getQueueOrThrow(queueNameOrDefault(queueName));
  await q.removeJobScheduler(key);
  return true;
}
