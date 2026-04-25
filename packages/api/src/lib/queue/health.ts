import { getRedisConnection, isRedisConfigured } from './connection.js';
import { listQueues } from './registry.js';
import { queueHealthGauge } from './metrics.js';

export interface QueueHealth {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Lightweight env probe — true if REDIS_URL or REDIS_HOST is set. Does NOT
 * verify connectivity. Kept for fast-path callers that only care whether
 * the queue layer is configured at all (e.g. legacy route guards).
 */
export function isQueueConfigured(): boolean {
  return isRedisConfigured();
}

/**
 * Real health check — issues PING with a 500ms timeout. Used by /health
 * and by enqueue() when `requireConnected: true`.
 */
export async function queueHealth(): Promise<QueueHealth> {
  const started = Date.now();
  if (!isRedisConfigured()) {
    queueHealthGauge.labels('_any').set(0);
    return { ok: false, latencyMs: 0, error: 'not configured' };
  }
  try {
    const conn = getRedisConnection('client');
    const pong = await Promise.race([
      conn.ping(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('ping timeout')), 500),
      ),
    ]);
    const latencyMs = Date.now() - started;
    if (pong !== 'PONG') {
      queueHealthGauge.labels('_any').set(0);
      return { ok: false, latencyMs, error: `unexpected ping response: ${pong}` };
    }
    queueHealthGauge.labels('_any').set(1);
    for (const q of listQueues()) queueHealthGauge.labels(q.name).set(1);
    return { ok: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    queueHealthGauge.labels('_any').set(0);
    return { ok: false, latencyMs, error: (err as Error).message };
  }
}
