import { queueHealth, isQueueConfigured } from '../lib/queue/index.js';
import { labeledRouter } from '../lib/router-registry.js';

export const healthRouter = labeledRouter('public');

healthRouter.get('/health', async (_req, res) => {
  const queue = isQueueConfigured()
    ? await queueHealth()
    : { ok: false, latencyMs: 0, error: 'not configured' };

  const overall = queue.ok ? 'ok' : 'degraded';

  res.json({
    status: overall,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
    checks: {
      queue,
    },
  });
});
