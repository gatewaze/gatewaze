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
 * Real health check — issues PING with a 2s timeout. Used by /health
 * and by enqueue() when `requireConnected: true`.
 *
 * 2s, not 500ms: cross-node RTT in production LKE clusters comfortably
 * exceeds 500ms even when the cluster is otherwise healthy (observed
 * ~590-700ms steady-state during the v1.2.0 aaif rollout). The kubelet
 * readinessProbe has timeoutSeconds=5 and failureThreshold=3, so the
 * 2s budget leaves plenty of headroom while still catching a genuinely
 * wedged Redis. Override via QUEUE_HEALTH_TIMEOUT_MS if your cluster
 * needs a tighter window.
 */
const QUEUE_HEALTH_TIMEOUT_MS = parseInt(
  process.env.QUEUE_HEALTH_TIMEOUT_MS ?? '2000',
  10,
);

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
        setTimeout(() => reject(new Error('ping timeout')), QUEUE_HEALTH_TIMEOUT_MS),
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
