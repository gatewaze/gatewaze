/**
 * Screenshot API Routes
 *
 * Provides endpoints for generating event card screenshots.
 * Actual generation happens via job queue workers or external services.
 */

import { Router, type Request, type Response } from 'express';
import { getSupabase } from '../lib/supabase.js';
import { addJob, isQueueAvailable, JobTypes } from '../lib/job-queue.js';

export const screenshotsRouter = Router();

// Health check
screenshotsRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'screenshot-api',
    queueAvailable: isQueueAvailable(),
    timestamp: new Date().toISOString(),
  });
});

// Fire-and-forget screenshot generation (enqueues job and returns immediately)
screenshotsRouter.post('/generate', async (req: Request, res: Response) => {
  const { eventIds, type, forceRegenerate, forceBrowserless } = req.body;

  if (!isQueueAvailable()) {
    res.status(503).json({
      success: false,
      error: 'Screenshot generation requires Redis job queue. Set REDIS_URL to enable.',
    });
    return;
  }

  try {
    const screenshotJobId = `screenshot-${Date.now()}`;
    const job = await addJob(JobTypes.SCREENSHOT_GENERATE, {
      eventIds: eventIds || null,
      forceRegenerate: forceRegenerate || false,
      forceBrowserless: forceBrowserless || false,
      screenshotJobId,
    });

    res.json({
      success: true,
      message: `Screenshot job enqueued (Job ID: ${job.id})`,
      jobId: job.id,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to enqueue screenshot job',
    });
  }
});

// Screenshot generation streaming endpoint
screenshotsRouter.post('/generate-stream', async (req: Request, res: Response) => {
  const { eventIds, type, forceRegenerate, forceBrowserless } = req.body;

  // Set headers for Server-Sent Events
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

  if (!isQueueAvailable()) {
    sendEvent('error', {
      message: 'Screenshot generation requires Redis job queue',
      details: 'Set REDIS_URL environment variable to enable background job processing',
    });
    res.end();
    return;
  }

  try {
    const screenshotJobId = `screenshot-${Date.now()}`;

    sendEvent('progress', { line: 'Enqueuing screenshot job to worker...', progress: 10 });

    const Redis = (await import('ioredis')).default;
    const subscriber = new Redis(process.env.REDIS_URL!);
    const channel = `scraper:${screenshotJobId}:logs`;

    let isComplete = false;
    let progress = 20;

    function cleanup() {
      if (isComplete) return;
      isComplete = true;
      subscriber.unsubscribe(channel).catch(() => {});
      subscriber.quit().catch(() => {});
    }

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
            sendEvent('progress', { line: `Progress: ${logData.stats?.percent || 0}%`, progress });
            break;
          case 'complete':
            sendEvent('complete', { message: 'Screenshot generation completed!', progress: 100, success: logData.success });
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
        console.error('Error parsing log message:', e);
      }
    });

    const job = await addJob(JobTypes.SCREENSHOT_GENERATE, {
      eventIds: eventIds || null,
      forceRegenerate: forceRegenerate || false,
      forceBrowserless: forceBrowserless || false,
      screenshotJobId,
    });

    sendEvent('progress', { line: `Screenshot job enqueued (Job ID: ${job.id})`, progress: 15 });

    // Timeout after 5 minutes
    setTimeout(() => {
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

    req.on('close', () => {
      cleanup();
    });
  } catch (error: any) {
    sendEvent('error', { message: 'Failed to start screenshot generation', details: error.message });
    res.end();
  }
});
