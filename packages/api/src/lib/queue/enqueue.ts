import { v4 as uuidv4 } from 'uuid';
import type { ZodTypeAny } from 'zod';
import { getQueueOrThrow, getQueueModule, getSchemaFor, UnknownQueueError } from './registry.js';
import { getRedisConnection } from './connection.js';
import { logger } from './logger.js';
import { jobEnqueuedTotal } from './metrics.js';

export class QueueValidationError extends Error {
  readonly issues: unknown;
  constructor(message: string, issues: unknown) {
    super(message);
    this.name = 'QueueValidationError';
    this.issues = issues;
  }
}

export class QueueUnavailableError extends Error {
  constructor(reason: string) {
    super(`Queue unavailable: ${reason}`);
    this.name = 'QueueUnavailableError';
  }
}

export { UnknownQueueError };

export interface EnqueueOptions {
  /** Opt-in dedup — if set, becomes the jobId (BullMQ dedups by jobId). */
  idempotencyKey?: string;
  priority?: number;
  /** Delay in ms. */
  delay?: number;
  /** Override queue default. */
  attempts?: number;
  /** Override queue default backoff. `custom` uses per-attempt ms array. */
  backoff?:
    | { type: 'fixed' | 'exponential'; delay: number }
    | { type: 'custom'; settings: number[] };
  /** If true, PING Redis before enqueueing and throw QueueUnavailableError on failure. */
  requireConnected?: boolean;
}

export interface EnqueueResult {
  jobId: string;
  queuedAt: string;
}

/**
 * Typed enqueue helper. Validates `data` against the registered schema
 * (or the per-call override `schema`) before adding to the queue.
 *
 * Job IDs are UUIDs unless `idempotencyKey` is set.
 */
export async function enqueue<T extends ZodTypeAny>(
  queueName: string,
  jobName: string,
  data: unknown,
  schema?: T,
  opts: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const queue = getQueueOrThrow(queueName);
  const effectiveSchema = schema ?? getSchemaFor(queueName, jobName);
  const parsed = effectiveSchema.safeParse(data);
  if (!parsed.success) {
    throw new QueueValidationError(
      `Payload validation failed for ${queueName}/${jobName}: ${parsed.error.message}`,
      parsed.error.issues,
    );
  }

  if (opts.requireConnected) {
    try {
      // Same QUEUE_HEALTH_TIMEOUT_MS budget as queue/health.ts (default 2s);
      // 500ms was tighter than cross-node RTT on production LKE.
      const timeoutMs = parseInt(process.env.QUEUE_HEALTH_TIMEOUT_MS ?? '2000', 10);
      const conn = getRedisConnection('client');
      const pong = await Promise.race([
        conn.ping(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('ping timeout')), timeoutMs),
        ),
      ]);
      if (pong !== 'PONG') throw new Error(`unexpected ping response: ${pong}`);
    } catch (err) {
      throw new QueueUnavailableError((err as Error).message);
    }
  }

  const jobId = opts.idempotencyKey ?? uuidv4();
  const queuedAt = new Date().toISOString();
  const payload = { ...parsed.data, enqueuedAt: queuedAt };

  const jobsOpts: Parameters<typeof queue.add>[2] = {
    jobId,
    priority: opts.priority,
    delay: opts.delay,
    attempts: opts.attempts,
  };

  if (opts.backoff) {
    if (opts.backoff.type === 'custom') {
      // Per-call custom backoff uses the queue-level backoff strategy
      // namespace. We piggy-back on the registered strategy if the
      // settings match; otherwise we fall back to the delay of the
      // first setting. Callers needing true per-call custom backoff
      // should declare the queue with the strategy.
      jobsOpts.backoff = { type: 'exponential', delay: opts.backoff.settings[0] ?? 5000 };
    } else {
      jobsOpts.backoff = { type: opts.backoff.type, delay: opts.backoff.delay };
    }
  }

  const job = await queue.add(jobName, payload, jobsOpts);

  jobEnqueuedTotal.labels(queueName, jobName, getQueueModule(queueName)).inc();
  logger.info(
    { queue: queueName, name: jobName, job_id: job.id, module: getQueueModule(queueName) },
    'job enqueued',
  );

  return { jobId: job.id ?? jobId, queuedAt };
}
