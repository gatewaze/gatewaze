/**
 * Screenshot API Routes
 *
 * Provides endpoints for generating event card screenshots.
 * Actual generation happens via job queue workers or external services.
 */

import { type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../lib/supabase.js';
import {
  enqueue,
  isQueueConfigured,
  JobTypes,
  getRedisConnection,
} from '../lib/queue/index.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';

export const screenshotsRouter = labeledRouter('jwt');
screenshotsRouter.use(requireJwt());

// Health check
screenshotsRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'screenshot-api',
    queueAvailable: isQueueConfigured(),
    timestamp: new Date().toISOString(),
  });
});

// Fire-and-forget screenshot generation (enqueues job and returns immediately)
screenshotsRouter.post('/generate', async (req: Request, res: Response) => {
  const { eventIds, forceRegenerate, forceBrowserless } = req.body;

  if (!isQueueConfigured()) {
    res.status(503).json({
      success: false,
      error: 'Screenshot generation requires Redis job queue. Set REDIS_URL to enable.',
    });
    return;
  }

  try {
    const screenshotJobId = uuidv4();
    const result = await enqueue('jobs', JobTypes.SCREENSHOT_GENERATE, {
      eventIds: eventIds || null,
      forceRegenerate: forceRegenerate || false,
      forceBrowserless: forceBrowserless || false,
      screenshotJobId,
    });

    res.json({
      success: true,
      message: `Screenshot job enqueued (Job ID: ${result.jobId})`,
      jobId: result.jobId,
      screenshotJobId,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message || 'Failed to enqueue screenshot job',
    });
  }
});

// Screenshot generation streaming endpoint (SSE)
screenshotsRouter.post('/generate-stream', async (req: Request, res: Response) => {
  const { eventIds, forceRegenerate, forceBrowserless } = req.body;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    if (res.destroyed) return false;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch {
      return false;
    }
  };

  sendEvent('progress', { line: 'Starting screenshot generation...', progress: 0 });

  if (!isQueueConfigured()) {
    sendEvent('error', {
      message: 'Screenshot generation requires Redis job queue',
      details: 'Set REDIS_URL environment variable to enable background job processing',
    });
    res.end();
    return;
  }

  try {
    const screenshotJobId = uuidv4();
    sendEvent('progress', { line: 'Enqueuing screenshot job to worker...', progress: 10 });

    // Dedicated subscriber — SSE streams are long-lived, we want our own
    // pub/sub connection so closing this one does not affect others.
    const subscriber = getRedisConnection('subscriber').duplicate();
    // Pub/sub namespace fix (§4.10): was `scraper:${id}:logs`, now `screenshot:${id}:logs`.
    const channel = `screenshot:${screenshotJobId}:logs`;

    let isComplete = false;
    let progress = 20;

    const cleanup = () => {
      if (isComplete) return;
      isComplete = true;
      subscriber.unsubscribe(channel).catch(() => undefined);
      subscriber.quit().catch(() => undefined);
    };

    await subscriber.subscribe(channel);

    subscriber.on('message', (ch: string, message: string) => {
      if (ch !== channel || isComplete) return;
      try {
        const logData = JSON.parse(message);
        switch (logData.type) {
          case 'log':
            progress = Math.min(progress + 1, 90);
            sendEvent('progress', { line: logData.message, progress });
            break;
          case 'progress':
            if (logData.stats?.percent) {
              progress = Math.min(20 + logData.stats.percent * 0.7, 90);
            }
            sendEvent('progress', { line: `Progress: ${logData.stats?.percent ?? 0}%`, progress });
            break;
          case 'complete':
            sendEvent('complete', {
              message: 'Screenshot generation completed!',
              progress: 100,
              success: logData.success,
            });
            cleanup();
            res.end();
            break;
          case 'error':
            sendEvent('error', { message: 'Screenshot generation failed', details: logData.error });
            cleanup();
            res.end();
            break;
        }
      } catch (e) {
        // malformed payload — skip
      }
    });

    const result = await enqueue('jobs', JobTypes.SCREENSHOT_GENERATE, {
      eventIds: eventIds || null,
      forceRegenerate: forceRegenerate || false,
      forceBrowserless: forceBrowserless || false,
      screenshotJobId,
    });

    sendEvent('progress', { line: `Screenshot job enqueued (Job ID: ${result.jobId})`, progress: 15 });

    // Timeout after 5 minutes.
    const timeout = setTimeout(() => {
      if (!isComplete) {
        sendEvent('complete', {
          message: 'Screenshot job is running in background. Check job status for results.',
          progress: 100,
          success: true,
          background: true,
        });
        cleanup();
        res.end();
      }
    }, 5 * 60 * 1000);
    timeout.unref?.();

    req.on('close', () => cleanup());
  } catch (error) {
    sendEvent('error', {
      message: 'Failed to start screenshot generation',
      details: (error as Error).message,
    });
    res.end();
  }
});
