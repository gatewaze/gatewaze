import IORedis, { type Redis, type RedisOptions } from 'ioredis';
import { logger } from './logger.js';

type ConnectionRole = 'client' | 'subscriber' | 'bclient';

const connections: Partial<Record<ConnectionRole, Redis>> = {};

export function getRedisUrl(): string | null {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  if (process.env.REDIS_HOST) {
    const port = process.env.REDIS_PORT ?? '6379';
    const pass = process.env.REDIS_PASSWORD ? `:${encodeURIComponent(process.env.REDIS_PASSWORD)}@` : '';
    return `redis://${pass}${process.env.REDIS_HOST}:${port}`;
  }
  return null;
}

function baseOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  };
}

/**
 * Returns a shared ioredis client for the given role. Creates it on first
 * call; subsequent calls return the same instance. BullMQ requires
 * distinct connections per role (`client`, `subscriber`, `bclient`) —
 * we honour that while still sharing across queues within the same role.
 */
export function getRedisConnection(role: ConnectionRole = 'client'): Redis {
  const existing = connections[role];
  if (existing) return existing;

  const url = getRedisUrl();
  if (!url) {
    throw new Error(
      'Redis is not configured. Set REDIS_URL or REDIS_HOST to enable the queue layer.',
    );
  }

  const conn = new IORedis(url, baseOptions());
  conn.on('error', (err) => logger.error({ err: err.message, role }, 'redis connection error'));
  conn.on('reconnecting', () => logger.warn({ role }, 'redis reconnecting'));
  conn.on('ready', () => logger.info({ role }, 'redis connected'));

  connections[role] = conn;
  return conn;
}

/**
 * Cheap env-var presence probe. Does NOT verify connectivity — use
 * `queueHealth()` for that.
 */
export function isRedisConfigured(): boolean {
  return !!getRedisUrl();
}

export async function closeAllConnections(): Promise<void> {
  const entries = Object.entries(connections) as [ConnectionRole, Redis][];
  await Promise.all(
    entries.map(async ([role, conn]) => {
      try {
        await conn.quit();
      } catch (err) {
        logger.warn({ role, err: (err as Error).message }, 'redis quit failed, forcing disconnect');
        conn.disconnect();
      }
      delete connections[role];
    }),
  );
}
