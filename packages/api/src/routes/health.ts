import { Router } from 'express';
import { queueHealth, isQueueConfigured } from '../lib/queue/index.js';

export const healthRouter = Router();

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
