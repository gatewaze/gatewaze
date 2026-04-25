/**
 * Gatewaze queue layer — single entry point.
 *
 * See spec-job-queue-redis-architecture.md in gatewaze-environments/specs
 * for architecture, defects fixed, and acceptance criteria.
 */

export { logger } from './logger.js';

export {
  getRedisConnection,
  getRedisUrl,
  isRedisConfigured,
  closeAllConnections,
} from './connection.js';

export {
  registerQueue,
  registerHandler,
  startWorker,
  getQueue,
  getQueueOrThrow,
  getQueueModule,
  listQueues,
  getSchemaFor,
  closeAllQueues,
  GLOBAL_DEFAULT_JOB_OPTIONS,
  UnknownQueueError,
  type RegisteredQueueConfig,
  type HandlerEntry,
  type QueueBackoff,
} from './registry.js';

export {
  enqueue,
  QueueValidationError,
  QueueUnavailableError,
  type EnqueueOptions,
  type EnqueueResult,
} from './enqueue.js';

export { queueHealth, isQueueConfigured, type QueueHealth } from './health.js';

export {
  getJobs,
  getJobCounts,
  getAllQueueCounts,
  getJob,
  retryJob,
  removeJob,
  cleanJobs,
  getRepeatableJobs,
  removeRepeatableJob,
} from './admin.js';

export {
  registry as metricsRegistry,
  jobDurationSeconds,
  jobTerminalFailuresTotal,
  queueDepth,
  queueHealthGauge,
  jobEnqueuedTotal,
  metricsHandler,
  startMetricsServer,
  markReady,
  markNotReady,
  readyState,
} from './metrics.js';

export { upsertCrons, pruneCrons, type LoadedCron } from './crons.js';
export { startListener, type ListenHandle } from './listen.js';
export { loadModuleQueues, closeModuleListeners } from './module-loader.js';

export * from './schemas.js';

// -- Built-in queue bootstrap ---------------------------------------------

import { registerQueue } from './registry.js';

/**
 * Register the three built-in queues with default options. Call once,
 * early, from any process that uses the queue layer (API, worker,
 * scheduler). Idempotent.
 */
export function registerBuiltInQueues(): void {
  registerQueue({ name: 'jobs', module: 'core', defaultConcurrency: 2 });
  registerQueue({ name: 'email', module: 'core', defaultConcurrency: 5 });
  registerQueue({ name: 'image', module: 'core', defaultConcurrency: 5 });
}
