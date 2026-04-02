import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

export function createRedisConnection(): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function createQueue(name: string) {
  const connection = createRedisConnection();
  return new Queue(name, { connection: connection as never });
}

export function createWorker<T>(
  name: string,
  handler: (job: Job<T>) => Promise<void>,
  concurrency = 5,
) {
  const connection = createRedisConnection();
  return new Worker<T>(name, handler, {
    connection: connection as never,
    concurrency,
  });
}

// Standard job queues
export const emailQueue = createQueue('email');
export const imageQueue = createQueue('image-processing');
