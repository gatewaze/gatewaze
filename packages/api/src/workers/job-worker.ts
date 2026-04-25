import { resolve } from 'path';
import type { Job } from 'bullmq';
import { loadModules } from '@gatewaze/shared/modules';
import config from '../../../../gatewaze.config.js';

import {
  registerBuiltInQueues,
  registerHandler,
  startWorker,
  loadModuleQueues,
  closeModuleListeners,
  closeAllQueues,
  closeAllConnections,
  getRedisConnection,
  logger,
  markReady,
  markNotReady,
  startMetricsServer,
  queueDepth,
  listQueues,
  getQueueOrThrow,
  getQueueModule,
  ScreenshotJobSchema,
  EmailJobSchema,
  ImageProcessJobSchema,
  type ScreenshotJobData,
  type EmailJobData,
  type ImageProcessJobData,
} from '../lib/queue/index.js';
import { getSupabase } from '../lib/supabase.js';

const PROJECT_ROOT = resolve(import.meta.dirname ?? __dirname, '../../../..');
const METRICS_PORT = parseInt(process.env.WORKER_METRICS_PORT ?? '9090', 10);

// -------------------------------------------------------------------------
// Screenshot job — with per-host rate limiting + forceRegenerate support
// -------------------------------------------------------------------------

const hostConcurrency = new Map<string, number>();
const HOST_CONCURRENCY_LIMIT = 3;

async function withHostSlot<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = new URL(url).host;
  while ((hostConcurrency.get(host) ?? 0) >= HOST_CONCURRENCY_LIMIT) {
    await new Promise((r) => setTimeout(r, 100));
  }
  hostConcurrency.set(host, (hostConcurrency.get(host) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const curr = hostConcurrency.get(host) ?? 1;
    if (curr <= 1) hostConcurrency.delete(host);
    else hostConcurrency.set(host, curr - 1);
  }
}

async function handleScreenshotJob(job: Job): Promise<void> {
  const data = job.data as ScreenshotJobData;
  const { eventIds, forceRegenerate, screenshotJobId } = data;

  // Publish logs on `screenshot:<id>:logs` (§4.10) — was `scraper:` previously.
  const publisher = getRedisConnection('client');
  const channel = screenshotJobId ? `screenshot:${screenshotJobId}:logs` : null;

  const publishLog = (payload: Record<string, unknown>) => {
    if (!channel) return;
    publisher.publish(channel, JSON.stringify(payload)).catch(() => undefined);
  };
  const log = (message: string) => {
    logger.info({ job_id: job.id, screenshotJobId }, `[screenshot] ${message}`);
    publishLog({ type: 'log', message, timestamp: new Date().toISOString() });
  };

  log('Starting screenshot generation...');

  const supabase = getSupabase();
  let query = supabase
    .from('events')
    .select('event_id, event_title, event_link, event_logo, screenshot_generated')
    .eq('is_live_in_production', true);
  if (eventIds && eventIds.length > 0) query = query.in('event_id', eventIds);

  const { data: events, error } = await query;
  if (error) throw new Error(`Failed to fetch events: ${error.message}`);
  if (!events || events.length === 0) {
    log('No events to process');
    publishLog({ type: 'complete', success: true, timestamp: new Date().toISOString() });
    return;
  }

  const toProcess = forceRegenerate
    ? events
    : events.filter((e: { screenshot_generated?: boolean }) => !e.screenshot_generated);
  if (toProcess.length === 0) {
    log('All events already have screenshots; forceRegenerate is false');
    publishLog({ type: 'complete', success: true, timestamp: new Date().toISOString() });
    return;
  }

  log(`Processing ${toProcess.length} event(s) (skipped ${events.length - toProcess.length} already-generated)`);

  let completed = 0;
  for (const event of toProcess) {
    try {
      log(`Processing: ${event.event_title}`);
      let imageBuffer: Buffer | null = null;

      if (event.event_link) {
        try {
          const pageRes = await withHostSlot(event.event_link, () =>
            fetch(event.event_link, {
              headers: { 'User-Agent': 'Gatewaze-Screenshot/1.0' },
              signal: AbortSignal.timeout(15_000),
            }),
          );
          const html = await pageRes.text();
          const ogMatch =
            html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
          if (ogMatch?.[1]) {
            const ogUrl = ogMatch[1]
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"');
            const imgRes = await withHostSlot(ogUrl, () =>
              fetch(ogUrl, { signal: AbortSignal.timeout(10_000) }),
            );
            if (imgRes.ok) imageBuffer = Buffer.from(await imgRes.arrayBuffer());
          }
        } catch {
          // fall through to logo
        }
      }

      if (!imageBuffer && event.event_logo) {
        try {
          const logoRes = await withHostSlot(event.event_logo, () =>
            fetch(event.event_logo, { signal: AbortSignal.timeout(10_000) }),
          );
          if (logoRes.ok) imageBuffer = Buffer.from(await logoRes.arrayBuffer());
        } catch {
          // no image available
        }
      }

      if (imageBuffer) {
        const filePath = `event-previews/${event.event_id}.jpg`;
        const { error: uploadErr } = await supabase.storage
          .from('media')
          .upload(filePath, imageBuffer, {
            upsert: true,
            contentType: 'image/jpeg',
            cacheControl: '3600',
          });

        if (uploadErr) {
          log(`Upload failed for ${event.event_title}: ${uploadErr.message}`);
        } else {
          await supabase
            .from('events')
            .update({
              screenshot_generated: true,
              screenshot_url: filePath,
              screenshot_generated_at: new Date().toISOString(),
            })
            .eq('event_id', event.event_id);
          log(`Completed: ${event.event_title}`);
        }
      } else {
        log(`No image source for: ${event.event_title}`);
      }

      completed++;
      publishLog({
        type: 'progress',
        stats: { percent: Math.round((completed / toProcess.length) * 100) },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log(`Failed: ${event.event_title} - ${(err as Error).message}`);
      completed++;
    }
  }

  log(`Screenshot generation completed. Processed ${toProcess.length} event(s).`);
  publishLog({ type: 'complete', success: true, timestamp: new Date().toISOString() });
}

async function handleEmailJob(job: Job): Promise<void> {
  const data = job.data as EmailJobData;
  const supabase = getSupabase();
  const { error } = await supabase.functions.invoke('email-send', { body: data });
  if (error) {
    logger.error({ job_id: job.id, err: error.message }, 'email job failed');
    throw error;
  }
  logger.info({ job_id: job.id, to: data.to }, 'email sent');
}

async function handleImageJob(job: Job): Promise<void> {
  const data = job.data as ImageProcessJobData;
  const supabase = getSupabase();
  const { error } = await supabase.functions.invoke('media-process-image', { body: data });
  if (error) {
    logger.error({ job_id: job.id, err: error.message }, 'image job failed');
    throw error;
  }
  logger.info({ job_id: job.id, eventId: data.eventId }, 'image processed');
}

// -------------------------------------------------------------------------
// Periodic queue-depth sampler
// -------------------------------------------------------------------------

function startDepthSampler(): () => void {
  const interval = setInterval(async () => {
    try {
      for (const cfg of listQueues()) {
        const q = getQueueOrThrow(cfg.name);
        const counts = await q.getJobCounts();
        for (const [state, count] of Object.entries(counts)) {
          queueDepth.labels(cfg.name, state, getQueueModule(cfg.name)).set(count as number);
        }
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'queue-depth sampler error');
    }
  }, 15_000);
  interval.unref?.();
  return () => clearInterval(interval);
}

// -------------------------------------------------------------------------
// Bootstrap — deterministic order, no race conditions (§4.3)
// -------------------------------------------------------------------------

async function main(): Promise<void> {
  const metricsServer = startMetricsServer(METRICS_PORT);
  logger.info({ port: METRICS_PORT }, 'metrics server listening');

  registerBuiltInQueues();

  // Built-in handlers — register BEFORE starting workers.
  registerHandler('jobs', { name: 'screenshot:generate', handler: handleScreenshotJob, schema: ScreenshotJobSchema });
  registerHandler('email', { name: 'email', handler: handleEmailJob, schema: EmailJobSchema });
  registerHandler('email', { name: 'send-reminder-emails', handler: handleEmailJob, schema: EmailJobSchema });
  registerHandler('image', { name: 'image-processing', handler: handleImageJob, schema: ImageProcessJobSchema });

  // Module handlers + module queues (and their LISTEN channels).
  const modules = await loadModules(config as never, PROJECT_ROOT);
  const moduleHandles = await loadModuleQueues(modules);

  // Start workers for built-in queues after all handlers are registered.
  startWorker('jobs');
  startWorker('email');
  startWorker('image');

  const stopDepthSampler = startDepthSampler();
  markReady();
  logger.info('worker ready');

  const shutdown = async (signal: string) => {
    markNotReady(`shutting down (${signal})`);
    logger.info({ signal }, 'worker shutting down');
    stopDepthSampler();
    await closeModuleListeners(moduleHandles);
    await closeAllQueues();
    await closeAllConnections();
    await metricsServer.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'worker bootstrap failed');
  process.exit(1);
});
