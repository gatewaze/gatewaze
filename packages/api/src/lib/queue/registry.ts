import { Queue, QueueEvents, Worker, type Job, type JobsOptions } from 'bullmq';
import type { z } from 'zod';
import { getRedisConnection } from './connection.js';
import { logger } from './logger.js';
import { jobDurationSeconds, jobTerminalFailuresTotal } from './metrics.js';
import { PassthroughSchema, builtInJobSchemas } from './schemas.js';

// BullMQ's `connection` option accepts `ConnectionOptions | Redis | Cluster`,
// but ioredis is a transitive dep of bullmq — if the direct ioredis in
// this package resolves to a different minor version, the Redis instance
// type appears structurally incompatible to tsc. It's fine at runtime;
// cast through unknown to silence the version-skew error.
type QueueConnection = never;

const brand = process.env.BRAND ?? 'default';
const bullPrefix = `bull:${brand}`;

export type CustomBackoff = {
  type: 'custom';
  /** ms per attempt — settings[i] is the delay before attempt i+1. */
  settings: number[];
};

export type QueueBackoff =
  | { type: 'fixed' | 'exponential'; delay: number }
  | CustomBackoff;

export interface RegisteredQueueConfig {
  name: string;
  /** Module id for labelling. Built-ins use 'core'. */
  module: string;
  defaultJobOptions?: JobsOptions & { backoff?: QueueBackoff };
  defaultConcurrency?: number;
}

export interface HandlerEntry {
  name: string;
  handler: (job: Job) => Promise<unknown>;
  schema?: z.ZodTypeAny;
}

interface QueueEntry {
  config: RegisteredQueueConfig;
  queue: Queue;
  queueEvents: QueueEvents;
  handlers: Map<string, HandlerEntry>;
  worker?: Worker;
}

const queues = new Map<string, QueueEntry>();

/**
 * Global defaults applied to every queue unless it overrides.
 */
export const GLOBAL_DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 1000, age: 24 * 3600 },
  removeOnFail: { count: 500, age: 7 * 24 * 3600 },
};

function resolveDefaultJobOptions(
  cfg: RegisteredQueueConfig,
): JobsOptions {
  const base = { ...GLOBAL_DEFAULT_JOB_OPTIONS, ...(cfg.defaultJobOptions ?? {}) };
  const backoff = cfg.defaultJobOptions?.backoff;
  if (backoff && backoff.type === 'custom') {
    // BullMQ needs a named backoff strategy for custom behaviour;
    // we map 'custom' to { type: 'backoff-<queue>', delay: 0 }.
    base.backoff = { type: `backoff-${cfg.name}`, delay: 0 } as never;
  }
  return base;
}

function customBackoffSettings(cfg: RegisteredQueueConfig): number[] | null {
  const b = cfg.defaultJobOptions?.backoff;
  if (b && b.type === 'custom') return b.settings;
  return null;
}

/**
 * Register a queue (Queue + QueueEvents). Idempotent.
 */
export function registerQueue(cfg: RegisteredQueueConfig): Queue {
  const existing = queues.get(cfg.name);
  if (existing) return existing.queue;

  const connection = getRedisConnection('client') as unknown as QueueConnection;
  const queue = new Queue(cfg.name, {
    connection,
    prefix: bullPrefix,
    defaultJobOptions: resolveDefaultJobOptions(cfg),
  });
  const queueEvents = new QueueEvents(cfg.name, {
    connection: getRedisConnection('subscriber') as unknown as QueueConnection,
    prefix: bullPrefix,
  });

  queues.set(cfg.name, { config: cfg, queue, queueEvents, handlers: new Map() });
  logger.info({ queue: cfg.name, module: cfg.module }, 'queue registered');
  return queue;
}

export function registerHandler(queueName: string, entry: HandlerEntry): void {
  const qe = queues.get(queueName);
  if (!qe) throw new Error(`Cannot register handler for unknown queue "${queueName}"`);
  if (qe.handlers.has(entry.name)) {
    throw new Error(`Duplicate handler "${entry.name}" on queue "${queueName}"`);
  }
  qe.handlers.set(entry.name, entry);
}

/**
 * Construct the Worker for a registered queue. Call ONLY after all
 * handlers are registered, to avoid the race where a job dequeues
 * before its handler is installed (§3.3).
 */
export function startWorker(queueName: string): Worker {
  const qe = queues.get(queueName);
  if (!qe) throw new Error(`Cannot start worker for unknown queue "${queueName}"`);
  if (qe.worker) return qe.worker;

  const cfg = qe.config;
  const concurrency = resolveConcurrency(cfg);

  const settings = customBackoffSettings(cfg);
  const backoffStrategy = settings
    ? (attemptsMade: number) => {
        // BullMQ attempts are 1-indexed once the job fails.
        const idx = Math.max(0, attemptsMade - 1);
        return settings[Math.min(idx, settings.length - 1)];
      }
    : undefined;

  const worker = new Worker(
    queueName,
    async (job: Job) => {
      const start = process.hrtime.bigint();
      const entry = qe.handlers.get(job.name);
      if (!entry) {
        throw new Error(`No handler registered for job "${job.name}" on queue "${queueName}"`);
      }
      if (entry.schema) {
        const parsed = entry.schema.safeParse(job.data);
        if (!parsed.success) {
          throw new Error(`Schema validation failed for ${queueName}/${job.name}: ${parsed.error.message}`);
        }
      }
      try {
        // Give module worker handlers a minimal runtime ctx so they can chain follow-up jobs
        // (phase pipelines) and open Redis pub/sub. Previously the worker passed nothing (only the
        // API context had enqueueJob), so handlers that awaited ctx?.enqueueJob silently no-op'd.
        // Existing single-arg handlers ignore the extra argument.
        const handlerCtx = {
          enqueueJob: async (qn: string, jn: string, data: Record<string, unknown>, opts?: JobsOptions) => {
            const e = queues.get(qn);
            if (!e) return { id: undefined as string | undefined };
            // opts (e.g. a deterministic jobId) let callers make re-enqueue idempotent — a recovery
            // reconciler can safely re-drive a run's phase without spawning a duplicate job.
            const j = await e.queue.add(jn, data, opts);
            return { id: j.id };
          },
          getRedisConnection,
          // Scoped to THIS handler's own queue, not an arbitrary name-based lookup — a handler can
          // inspect its own in-flight jobs (e.g. a recovery reconciler distinguishing a live job from
          // an orphaned Redis hash before re-enqueuing) without gaining visibility into other modules'
          // queues.
          getQueue: () => qe.queue,
        };
        const result = await (entry.handler as (j: Job, c: unknown) => Promise<unknown>)(job, handlerCtx);
        const durSec = Number(process.hrtime.bigint() - start) / 1e9;
        jobDurationSeconds
          .labels(queueName, job.name, 'completed', cfg.module)
          .observe(durSec);
        return result;
      } catch (err) {
        const durSec = Number(process.hrtime.bigint() - start) / 1e9;
        jobDurationSeconds
          .labels(queueName, job.name, 'failed', cfg.module)
          .observe(durSec);
        throw err;
      }
    },
    {
      connection: getRedisConnection('bclient') as unknown as QueueConnection,
      prefix: bullPrefix,
      concurrency,
      // Long-running handlers (e.g. the software-engineer agent sessions, 10–20 min) must not be
      // falsely marked "stalled". BullMQ's default lockDuration is 30s: a handler that outlives it
      // without a lock renewal is treated as dead and retried, wedging the pipeline. The lock is
      // auto-renewed every lockDuration/2, so a generous duration (default 5 min → renew every 2.5
      // min) tolerates event-loop pressure while keeping worker-death recovery bounded to that
      // window. maxStalledCount>1 adds tolerance before a genuinely-stuck job is failed.
      lockDuration: intEnv('WORKER_LOCK_DURATION_MS', 300_000),
      stalledInterval: intEnv('WORKER_STALLED_INTERVAL_MS', 300_000),
      maxStalledCount: intEnv('WORKER_MAX_STALLED_COUNT', 2),
      settings: backoffStrategy ? { backoffStrategy } : undefined,
    },
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    const attempts = job.attemptsMade;
    const max = job.opts.attempts ?? 3;
    const isTerminal = attempts >= max;
    if (isTerminal) {
      jobTerminalFailuresTotal.labels(queueName, job.name, cfg.module).inc();
      logger.error(
        {
          queue: queueName,
          name: job.name,
          job_id: job.id,
          attempts,
          failed_reason: err.message,
          module: cfg.module,
        },
        'job terminal failure',
      );
    } else {
      logger.warn(
        { queue: queueName, name: job.name, job_id: job.id, attempts, err: err.message },
        'job attempt failed, will retry',
      );
    }
  });

  worker.on('error', (err) => {
    logger.error({ queue: queueName, err: err.message }, 'worker error');
  });

  qe.worker = worker;
  logger.info({ queue: queueName, module: cfg.module, concurrency }, 'worker started');
  return worker;
}

function resolveConcurrency(cfg: RegisteredQueueConfig): number {
  // Built-in envs for the three core queues.
  if (cfg.name === 'jobs') return intEnv('WORKER_CONCURRENCY_JOBS', cfg.defaultConcurrency ?? 2);
  if (cfg.name === 'email') return intEnv('WORKER_CONCURRENCY_EMAIL', cfg.defaultConcurrency ?? 5);
  if (cfg.name === 'image') return intEnv('WORKER_CONCURRENCY_IMAGE', cfg.defaultConcurrency ?? 5);
  // Module queues: WORKER_CONCURRENCY_<MODULE>_<QUEUE>.
  const modKey = cfg.module.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  const qKey = cfg.name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  return intEnv(`WORKER_CONCURRENCY_${modKey}_${qKey}`, cfg.defaultConcurrency ?? 2);
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getQueue(name: string): Queue | undefined {
  return queues.get(name)?.queue;
}

export function getQueueOrThrow(name: string): Queue {
  const q = getQueue(name);
  if (!q) throw new UnknownQueueError(name);
  return q;
}

export function listQueues(): RegisteredQueueConfig[] {
  return Array.from(queues.values()).map((q) => q.config);
}

export function getQueueModule(name: string): string {
  return queues.get(name)?.config.module ?? 'core';
}

export function getSchemaFor(queueName: string, jobName: string): z.ZodTypeAny {
  const qe = queues.get(queueName);
  const registered = qe?.handlers.get(jobName)?.schema;
  if (registered) return registered;
  // Fall back to built-in schema registry for the shared `jobs` queue.
  if (queueName === 'jobs' && builtInJobSchemas[jobName]) return builtInJobSchemas[jobName];
  return PassthroughSchema;
}

export class UnknownQueueError extends Error {
  constructor(queueName: string) {
    super(`Unknown queue "${queueName}". Known queues: ${Array.from(queues.keys()).join(', ') || '(none)'}`);
    this.name = 'UnknownQueueError';
  }
}

/**
 * Close all queues, queue-events, and workers. Use on graceful shutdown.
 */
export async function closeAllQueues(): Promise<void> {
  const entries = Array.from(queues.values());
  await Promise.all(
    entries.map(async (qe) => {
      try {
        if (qe.worker) await qe.worker.close();
        await qe.queueEvents.close();
        await qe.queue.close();
      } catch (err) {
        logger.warn(
          { queue: qe.config.name, err: (err as Error).message },
          'error closing queue',
        );
      }
    }),
  );
  queues.clear();
}
